/* ---------------------------------------------------------------------------
 * Google Drive upload helper.
 *
 * Given a connected `integrations` row (provider=google_drive), upload a file
 * into the tenant's Drive. We keep everything inside a single dedicated folder
 * ("ArrivePing Backups") so exports are tidy and easy to find. Because we requested
 * the `drive.file` scope, the app can ONLY see/manage files IT created — it can
 * never read the user's other Drive content. Least-privilege by design.
 *
 * Token freshness: callers pass the integration row; if the access token is
 * expired (or about to), refresh it via the OAuth framework and persist the new
 * tokens before uploading.
 * ------------------------------------------------------------------------- */
import { eq } from "drizzle-orm";
import * as schema from "../api/database/schema";
import { tdb } from "../api/database/tenant";
import { refreshTokens } from "./oauth";

const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
export const DEFAULT_BACKUP_FOLDER = "ArrivePing Backups";

type IntegrationRow = typeof schema.integrations.$inferSelect;

/**
 * Return a valid (non-expired) access token for this integration, refreshing &
 * persisting if needed. Throws if the connection can't be refreshed.
 */
async function freshAccessToken(row: IntegrationRow): Promise<string> {
  const skewMs = 60_000; // refresh a minute early to avoid edge expiry
  const expired =
    row.expiresAt instanceof Date
      ? row.expiresAt.getTime() - skewMs < Date.now()
      : false;
  if (!expired && row.accessToken) return row.accessToken;
  if (!row.refreshToken) {
    // No refresh token and the access token is stale → force a reconnect.
    if (row.accessToken) return row.accessToken;
    throw new Error("drive_not_connected");
  }
  try {
    const t = await refreshTokens("google_drive", row.refreshToken);
    await tdb(row.companyId).update(
      schema.integrations,
      {
        accessToken: t.accessToken,
        refreshToken: t.refreshToken || row.refreshToken,
        expiresAt: t.expiresAt ? new Date(t.expiresAt) : row.expiresAt,
        scope: t.scope || row.scope,
        lastSyncAt: new Date(),
      },
      eq(schema.integrations.id, row.id),
    );
    return t.accessToken;
  } catch (e: any) {
    // "invalid_grant" means Google has permanently revoked this refresh token —
    // most commonly because the OAuth app is still in Google's unverified
    // "Testing" publishing status, where Google auto-expires refresh tokens
    // after just 7 days regardless of use. No amount of retrying fixes this;
    // the user must reconnect (re-consent) to get a fresh token. Mark the
    // integration accordingly so the UI can prompt for reconnect instead of
    // silently failing on every export attempt.
    const msg = String(e?.message || "");
    if (msg.includes("invalid_grant")) {
      await tdb(row.companyId).update(
        schema.integrations,
        { status: "error" },
        eq(schema.integrations.id, row.id),
      );
      throw new Error("drive_reauth_required");
    }
    throw e;
  }
}


/** Escape single quotes for use inside a Drive `q=` query string. */
function escQ(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Find (or create) a single folder named `name` under `parentId` (or Drive root
 * when parentId is undefined). Returns the folder's Drive file id.
 */
async function ensureFolder(
  accessToken: string,
  name: string,
  parentId?: string,
): Promise<string> {
  const parentClause = parentId ? ` and '${escQ(parentId)}' in parents` : "";
  const q = encodeURIComponent(
    `name='${escQ(name)}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentClause}`,
  );
  const r = await fetch(`${DRIVE_FILES}?q=${q}&fields=files(id,name)&spaces=drive`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const j = (await r.json()) as { files?: { id: string }[] };
  if (r.ok && j.files && j.files.length > 0) return j.files[0].id;

  // Create it.
  const cr = await fetch(`${DRIVE_FILES}?fields=id`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
  const cj = (await cr.json()) as { id?: string; error?: any };
  if (!cr.ok || !cj.id)
    throw new Error(cj.error?.message || "drive_folder_create_failed");
  return cj.id;
}

/**
 * Resolve a folder PATH (e.g. ["ArrivePing Backups", "work-orders", "2026-06"]),
 * creating each segment as needed. Returns the id of the deepest folder.
 */
async function ensureFolderPath(
  accessToken: string,
  segments: string[],
): Promise<string> {
  let parent: string | undefined = undefined;
  for (const seg of segments) {
    if (!seg) continue;
    parent = await ensureFolder(accessToken, seg, parent);
  }
  if (!parent) throw new Error("drive_folder_path_empty");
  return parent;
}

export interface DriveUploadResult {
  fileId: string;
  name: string;
  webViewLink: string;
  folder: string;
  folderPath: string;
  folderLink: string;
}

/**
 * Upload a buffer/string to the tenant's Drive. Files are organized under a
 * folder PATH: <rootFolder>/<subfolders...>. Each segment is created on demand.
 * Uses a multipart upload so we can set metadata (name + parent) + content in
 * one call.
 */
export async function uploadToDrive(
  row: IntegrationRow,
  opts: {
    name: string;
    mimeType: string;
    content: Buffer | string;
    /** Folder segments under Drive root, e.g. ["ArrivePing Backups","work-orders","2026-06"]. */
    folderPath?: string[];
  },
): Promise<DriveUploadResult> {
  const accessToken = await freshAccessToken(row);
  const segments =
    opts.folderPath && opts.folderPath.length
      ? opts.folderPath
      : [DEFAULT_BACKUP_FOLDER];
  const folderId = await ensureFolderPath(accessToken, segments);

  const boundary = `nvc360${crypto.randomUUID().replace(/-/g, "")}`;
  const metadata = JSON.stringify({ name: opts.name, parents: [folderId] });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    ),
    Buffer.from(
      `--${boundary}\r\nContent-Type: ${opts.mimeType}\r\n\r\n`,
    ),
    Buffer.isBuffer(opts.content) ? opts.content : Buffer.from(opts.content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const r = await fetch(
    `${DRIVE_UPLOAD}?uploadType=multipart&fields=id,name,webViewLink`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  const j = (await r.json()) as {
    id?: string;
    name?: string;
    webViewLink?: string;
    error?: any;
  };
  if (!r.ok || !j.id)
    throw new Error(j.error?.message || "drive_upload_failed");
  return {
    fileId: j.id,
    name: j.name || opts.name,
    webViewLink: j.webViewLink || `https://drive.google.com/file/d/${j.id}/view`,
    folder: segments[0],
    folderPath: segments.join("/"),
    folderLink: `https://drive.google.com/drive/folders/${folderId}`,
  };
}
