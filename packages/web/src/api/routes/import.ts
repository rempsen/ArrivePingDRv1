/**
 * Bulk import for the Directory (customers, dispatchers) and the Technicians
 * roster — "Import CSV" / "Import Excel" / "Download template" on those pages.
 *
 * Deliberate choice on passwords: a spreadsheet of 200 people can't reasonably
 * carry a password per row, and typing one in on their behalf would mean an
 * admin (or this server) knows a stranger's password. So every brand-new row
 * gets an unguessable, never-surfaced random password — the record exists and
 * is fully usable (job history, invoices, assignment) but nobody can sign in
 * with it. New technicians and office staff are then emailed a welcome with a
 * link to set their own password (services/welcome.ts), as a hand-added
 * person is; customers get nothing until their first job. An email row that already has an ArrivePing
 * login elsewhere is never touched here either — same "invited" flow as the
 * single Add form and POST /riders use.
 */
import { Hono } from "hono";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { eq } from "drizzle-orm";
import { sdb } from "../database";
import * as schema from "../database/schema";
import { tdb } from "../database/tenant";
import { officeCan, requireAdmin, tenantId } from "../middleware/auth";
import { auth } from "../auth";
import { isSuperadmin } from "../lib/permissions";
import { attachMembership, isMember, findUserByEmail } from "../lib/memberships";
import { trySendJoinCompanyInvite } from "../lib/join-invite";
import { queueWelcomes } from "../../services/welcome";
import { isUndeliverableEmail } from "../../shared/sample-contact";
import { email as emailField } from "../lib/validate";
import {
  assignToProperty,
  createProperty,
  DirectoryError,
  directoryVocabFor,
  propertyIdForName,
  staffIdForLabel,
  updateProperty,
  type PlaceWords,
} from "../../services/directory";
import { IMPORT_FIELDS, type ImportColumn, type ImportType } from "../../shared/import-profile";
import { toCsv, toXlsx, fileResponse } from "./export";
import type { AppEnv } from "../env";

type SessionUser = { id: string; role?: string };

export type { ImportType };
const IMPORT_TYPES: ImportType[] = ["customer", "admin", "rider", "property"];

/**
 * Other names a column goes by in the spreadsheets people already have (an
 * export from another field-service tool, a CRM or a hand-kept list), keyed
 * by the template column they mean. Matching ignores case, spaces and
 * punctuation, so "E-mail Address", "email_address" and "Email Address" are
 * one name. Each template column's own key and label always match too.
 */
const COLUMN_ALIASES: Record<string, string[]> = {
  firstName: ["first", "first name", "given name", "fname", "contact first name"],
  lastName: ["last", "last name", "surname", "family name", "lname", "contact last name"],
  name: [
    "name", "full name", "customer name", "client name", "contact name", "contact", "display name",
    "customer", "client", "technician", "technician name", "employee", "employee name", "staff name",
    "resident", "resident name", "tenant", "tenant name", "owner", "owner name",
  ],
  email: ["email", "email address", "e mail", "mail", "primary email", "customer email", "contact email", "work email"],
  phone: [
    "phone", "phone number", "mobile", "mobile phone", "mobile number", "cell", "cell phone", "cell number",
    "telephone", "tel", "primary phone", "main phone", "contact phone", "phone 1",
  ],
  company: ["company", "company name", "business", "business name", "organization", "organisation"],
  website: ["website", "web site", "url", "web"],
  address: [
    "address", "street", "street address", "address 1", "address line 1", "service address", "property address", "site address",
  ],
  city: ["city", "town", "municipality"],
  region: ["region", "province", "state", "province state", "state province", "prov"],
  postalCode: ["postal code", "postal", "postcode", "zip", "zip code", "postal zip", "zip postal code", "postal zip code"],
  country: ["country"],
  customerType: ["customer type", "account type", "type"],
  skillClass: ["skill class", "trade", "skill level"],
  vehicle: ["vehicle", "truck", "van"],
  licensePlate: ["license plate", "licence plate", "plate", "plate number"],
  licenseNumber: ["license number", "licence number", "drivers license", "drivers licence", "driver license", "driver licence"],
  payRatePerHour: ["pay rate per hour", "pay rate", "hourly rate", "wage", "rate per hour"],
  skills: ["skills", "skill"],
  property: [
    "property", "property name", "building", "building name", "community", "community name", "complex", "site", "site name",
    "development", "team", "team name",
  ],
  unit: ["unit", "unit number", "unit no", "apt", "apt number", "apartment", "apartment number", "suite", "suite number", "door", "lot", "lot number", "lot no"],
  manager: ["manager", "property manager", "manager email", "manager name", "assigned to", "pm", "superintendent", "account manager", "coach", "head coach"],
  notes: ["notes", "note", "comments", "comment"],
};

const squash = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * One uploaded row with its columns renamed to the template's keys, whatever
 * the file called them. A column the template doesn't have is dropped; when
 * two columns mean the same thing, the first non-empty one wins. A row with a
 * first and last name but no full name gets one, so a technician list split
 * into two name columns imports with names too.
 */
export function normalizeImportRow(
  type: ImportType,
  raw: Record<string, string>,
  /**
   * The tenant's template (import-profile.ts): its labels ("Community", "Lot")
   * match too; with places off, a customer file's Property / Unit columns are
   * left alone rather than making places nobody set up.
   */
  opts: { columns?: ImportColumn[]; placesEnabled?: boolean } = {},
): Record<string, string> {
  const placesOff = opts.placesEnabled === false && type === "customer";
  const lookup = new Map<string, string>();
  for (const col of [...(opts.columns ?? []), ...IMPORT_FIELDS[type]]) {
    if (placesOff && (col.key === "property" || col.key === "unit")) continue;
    if (!lookup.has(squash(col.key))) lookup.set(squash(col.key), col.key);
    if (!lookup.has(squash(col.label))) lookup.set(squash(col.label), col.key);
  }
  // Only the fields this import has (plus the name parts a full name is built
  // from), so a column meant for another kind of import doesn't make a row.
  const allowed = new Set([...IMPORT_FIELDS[type].map((c) => c.key), "name", "firstName", "lastName", ...(type === "property" ? ["property"] : [])]);
  if (placesOff) {
    allowed.delete("property");
    allowed.delete("unit");
  }
  for (const [key, names] of Object.entries(COLUMN_ALIASES)) {
    if (!allowed.has(key)) continue;
    for (const n of names) if (!lookup.has(squash(n))) lookup.set(squash(n), key);
  }
  const out: Record<string, string> = {};
  for (const [header, value] of Object.entries(raw)) {
    const key = lookup.get(squash(header));
    const v = (value ?? "").trim();
    if (key && v && !out[key]) out[key] = v;
  }
  if (!out.name && (out.firstName || out.lastName)) out.name = [out.firstName, out.lastName].filter(Boolean).join(" ");
  // In a property import, a "Property" or "Building" column is the name.
  if (type === "property") {
    if (!out.name && out.property) out.name = out.property;
    delete out.property;
  }
  if (out.customerType) out.customerType = /repeat|recurring|regular|member/i.test(out.customerType) ? "repeat" : "one_time";
  return out;
}

/** The template's own example row, filled in for each type: never imported if left in. */
export function isTemplateExample(type: ImportType, row: Record<string, string>): boolean {
  const cols = IMPORT_FIELDS[type];
  const key = type === "property" ? "manager" : "email";
  const example = cols.find((c) => c.key === key)?.example;
  return !!example && (row[key] || "").toLowerCase() === example.toLowerCase();
}

function isImportType(v: string): v is ImportType {
  return (IMPORT_TYPES as string[]).includes(v);
}

/** A password nobody is ever shown or told — see the file header. */
function unguessablePassword(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`;
}

/**
 * A row with no email, or no name, is still worth importing — the tenant
 * fills the gap in later from the person's profile rather than losing the
 * row entirely. When email is missing, give it a private, guaranteed-unique
 * placeholder address (same pattern as the anonymous-lead fallback in
 * public-forms.ts) so the user table's unique-email constraint, and every
 * "does this person already have a login" check downstream, still work.
 */
function placeholderEmail(companyId: string, kind: "customer" | "dispatcher" | "technician"): string {
  return `${kind}-${crypto.randomUUID().slice(0, 8)}@${companyId}.import.local`;
}

/* -------------------------------- parsing -------------------------------- */

/** One data row and its line in the file (1-based), for the failure list. */
export type ParsedRow = { line: number; row: Record<string, string> };

/**
 * Turn a sheet's lines into rows keyed by its header row. The header is the
 * first line with two or more different values, so a title line above it
 * (the Excel templates have "Residents import template" merged across row 1,
 * which reads back as one value repeated) is skipped instead of becoming the
 * column names. A one-column file falls back to its first line.
 */
export function rowsFromGrid(grid: { line: number; cells: string[] }[]): ParsedRow[] {
  const lines = grid.filter((g) => g.cells.some((c) => c.trim()));
  if (!lines.length) return [];
  const distinct = (cells: string[]) => new Set(cells.map((c) => c.trim()).filter(Boolean)).size;
  const h = Math.max(0, lines.slice(0, 10).findIndex((g) => distinct(g.cells) >= 2));
  const headers = lines[h]!.cells.map((c) => c.trim());
  return lines.slice(h + 1).map((g) => {
    const row: Record<string, string> = {};
    headers.forEach((name, i) => { if (name) row[name] = (g.cells[i] ?? "").trim(); });
    return { line: g.line, row };
  });
}

/** Minimal CSV reader matching what toCsv() in export.ts writes: comma-
 *  separated, double-quote wrapped when a value has a comma/quote/newline,
 *  `""` for a literal quote inside a quoted field. */
export function parseCsv(text: string): ParsedRow[] {
  const clean = text.replace(/^﻿/, "");
  const lines = clean.split(/\r\n|\n|\r/);
  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
        } else cur += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  return rowsFromGrid(lines.map((l, i) => ({ line: i + 1, cells: parseLine(l) })));
}

/**
 * Some exporters (seen from at least one customer's CRM export) write every
 * SpreadsheetML tag behind a namespace prefix — `<x:workbook xmlns:x="...">`,
 * `<x:worksheet ...>`, etc — instead of the unprefixed default-namespace form
 * every mainstream tool (Excel, Google Sheets, LibreOffice, openpyxl) uses.
 * That's legal OOXML/XML, but ExcelJS's part parser matches bare tag names
 * and silently comes back with an empty `workbook.sheets`, which surfaces
 * upstream as "Could not read that file". Rather than reject a file that
 * genuinely is a valid Excel export, unzip it, strip whichever prefix is
 * bound to the main spreadsheet namespace from every element in every XML
 * part, and re-zip before handing it to ExcelJS.
 */
async function stripSpreadsheetNamespacePrefix(buf: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buf);
  const nsRe = /xmlns:([A-Za-z0-9_]+)="http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main"/;
  let changed = false;
  for (const name of Object.keys(zip.files)) {
    const entry = zip.files[name];
    if (!entry || entry.dir || !name.endsWith(".xml")) continue;
    const text = await entry.async("string");
    const m = text.match(nsRe);
    if (!m) continue;
    const prefix = m[1];
    const fixed = text.replace(new RegExp(`</?${prefix}:`, "g"), (tag) => (tag.startsWith("</") ? "</" : "<"));
    if (fixed !== text) {
      zip.file(name, fixed);
      changed = true;
    }
  }
  if (!changed) return buf;
  return zip.generateAsync({ type: "nodebuffer" });
}

export async function parseXlsx(buf: Buffer): Promise<ParsedRow[]> {
  let wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as any);
  } catch {
    // Fall back to the namespace-prefix repair above; if the file is
    // genuinely unreadable this rethrows and the caller's generic
    // "Could not read that file" message still applies. Retry on a fresh
    // Workbook instance — the failed load above may have left `wb` partially
    // populated.
    const fixed = await stripSpreadsheetNamespacePrefix(buf);
    wb = new ExcelJS.Workbook();
    await wb.xlsx.load(fixed as any);
  }
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const grid: { line: number; cells: string[] }[] = [];
  ws.eachRow((row, rowNumber) => {
    // row.values is 1-based with holes for empty cells; Array.from fills them.
    const raw = Array.from((row.values as any[]).slice(1));
    const cells = raw.map((v) => {
      if (v == null) return "";
      if (typeof v === "object" && "text" in v) return String((v as any).text ?? "");
      if (typeof v === "object" && "result" in v) return String((v as any).result ?? "");
      return String(v);
    });
    grid.push({ line: rowNumber, cells });
  });
  return rowsFromGrid(grid);
}

async function parseUpload(file: File): Promise<ParsedRow[]> {
  const name = (file.name || "").toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return parseXlsx(buf);
  return parseCsv(buf.toString("utf8"));
}

/* -------------------------------- rows -> accounts ------------------------ */

type RowResult =
  | { ok: true; status: "created"; userId: string; warning?: string }
  /** Already had a login elsewhere; `emailed` = the invitation email actually went out. */
  | { ok: true; status: "invited"; emailed: boolean; warning?: string }
  /** Already here: a customer row moved them to its property and unit; a property row updated it. */
  | { ok: true; status: "updated"; warning?: string }
  | { ok: false; reason: string };

/**
 * A customer row's Property and Unit columns: put the person at that named
 * property (created if it's new). Never fails the row: the account is
 * already made, so a problem comes back as a warning on an imported row.
 */
async function placeAtProperty(companyId: string, userId: string, row: Record<string, string>, w: PlaceWords): Promise<string | undefined> {
  if (!row.property) return undefined;
  try {
    const propertyId = await propertyIdForName(companyId, row.property, true, w);
    if (!propertyId) return undefined;
    // No Unit cell keeps the unit they have (a re-import that only adds places).
    await assignToProperty(companyId, { userIds: [userId], propertyId, unit: row.unit }, w);
    return undefined;
  } catch (e) {
    return e instanceof DirectoryError ? e.message : `Couldn't set their ${w.place}`;
  }
}

const PALETTE = ["#06b6d4", "#22c55e", "#f59e0b", "#a855f7", "#ef4444", "#3b82f6"];
const randomColor = () => PALETTE[Math.floor(Math.random() * PALETTE.length)];

/** customer or dispatcher row */
async function importPersonRow(
  row: Record<string, string>,
  /** canEdit: may change existing client records (clients:edit), not just add them. */
  opts: { role: "customer" | "admin"; companyId: string; invitedBy: string | null; canEdit?: boolean; words: PlaceWords },
): Promise<RowResult> {
  const rawEmail = (row.email || "").trim();
  let email: string;
  if (rawEmail) {
    const parsed = emailField().safeParse(rawEmail);
    if (!parsed.success) return { ok: false, reason: "Invalid email" };
    email = parsed.data;
  } else {
    email = placeholderEmail(opts.companyId, opts.role === "customer" ? "customer" : "dispatcher");
  }

  const firstName = (row.firstName || "").trim();
  const lastName = (row.lastName || "").trim();
  const name =
    (row.name || [firstName, lastName].filter(Boolean).join(" ")).trim() ||
    (row.company || "").trim() ||
    `Unnamed ${opts.role === "customer" ? "customer" : "dispatcher"}`;

  const cid = opts.companyId;
  const role = opts.role;
  const existing = await findUserByEmail(email);

  if (existing) {
    if (await isMember(existing.id, cid)) {
      // Re-importing a resident list is how 2,500 existing residents get
      // their property and unit: update those, never anything else.
      if (role === "customer" && row.property) {
        if (!opts.canEdit) return { ok: false, reason: `Already in your account. Changing their ${opts.words.place} needs permission to edit clients.` };
        const warning = await placeAtProperty(cid, existing.id, row, opts.words);
        return warning ? { ok: false, reason: warning } : { ok: true, status: "updated" };
      }
      return { ok: false, reason: "Already in your account" };
    }
    const { membership } = await attachMembership({
      userId: existing.id,
      companyId: cid,
      role,
      status: "invited",
      invitedBy: opts.invitedBy,
    });
    const emailed = await trySendJoinCompanyInvite({
      email: existing.email,
      name: existing.name,
      companyId: cid,
      membershipId: membership!.id,
    });
    const warning = role === "customer" ? await placeAtProperty(cid, existing.id, row, opts.words) : undefined;
    return { ok: true, status: "invited", emailed, warning };
  }

  try {
    await auth.api.signUpEmail({
      body: { name, email, password: unguessablePassword(), role, phone: row.phone || "" } as any,
    });
  } catch (e: any) {
    return { ok: false, reason: e?.message || "Could not create account" };
  }
  const u = await findUserByEmail(email);
  if (!u) return { ok: false, reason: "Could not create account" };
  await sdb
    .update(schema.user)
    .set({
      role,
      phone: row.phone || "",
      companyId: cid,
      name,
      firstName: firstName || null,
      lastName: lastName || null,
      company: row.company || null,
      website: row.website || null,
      address: row.address || null,
      city: row.city || null,
      region: row.region || null,
      postalCode: row.postalCode || null,
      country: row.country || null,
      customerType: role === "customer" ? (row.customerType === "repeat" ? "repeat" : "one_time") : null,
    })
    .where(eq(schema.user.id, u.id));
  await attachMembership({ userId: u.id, companyId: cid, role, status: "active", invitedBy: opts.invitedBy });
  const warning = role === "customer" ? await placeAtProperty(cid, u.id, row, opts.words) : undefined;
  return { ok: true, status: "created", userId: u.id, warning };
}

/** property row: create it, or update the one with that name. */
async function importPropertyRow(row: Record<string, string>, opts: { companyId: string; canEdit: boolean; words: PlaceWords }): Promise<RowResult> {
  const w = opts.words;
  const name = (row.name || "").trim();
  if (!name) return { ok: false, reason: `A ${w.place} name is required` };
  const cid = opts.companyId;
  let warning: string | undefined;
  let managerId: string | null | undefined;
  if (row.manager) {
    managerId = await staffIdForLabel(cid, row.manager);
    if (!managerId) warning = `No team member matches "${row.manager}", so it has no ${w.manager} yet`;
  }
  try {
    const existingId = await propertyIdForName(cid, name, false, w);
    if (existingId) {
      if (!opts.canEdit) return { ok: false, reason: `There's already a ${w.place} called "${name}". Changing it needs permission to edit clients.` };
      const patch: { address?: string; notes?: string; managerId?: string | null } = {};
      if (row.address) patch.address = row.address;
      if (row.notes) patch.notes = row.notes;
      if (managerId) patch.managerId = managerId;
      if (Object.keys(patch).length) await updateProperty(cid, existingId, patch, w);
      return { ok: true, status: "updated", warning };
    }
    const r = await createProperty(cid, { name, address: row.address, notes: row.notes, managerId: managerId ?? null }, w);
    return { ok: true, status: "created", userId: r.id, warning };
  } catch (e) {
    return { ok: false, reason: e instanceof DirectoryError ? e.message : `Could not save that ${w.place}` };
  }
}

/** technician row */
async function importRiderRow(
  row: Record<string, string>,
  opts: { companyId: string; invitedBy: string | null },
): Promise<RowResult> {
  const rawEmail = (row.email || "").trim();
  let email: string;
  if (rawEmail) {
    const parsed = emailField().safeParse(rawEmail);
    if (!parsed.success) return { ok: false, reason: "Invalid email" };
    email = parsed.data;
  } else {
    email = placeholderEmail(opts.companyId, "technician");
  }
  const name = (row.name || "").trim() || "Unnamed technician";

  const cid = opts.companyId;
  const phone = row.phone || "";
  const skillClass = row.skillClass || "General";
  const vehicle = row.vehicle || "Van";
  const licensePlate = row.licensePlate || "";
  const licenseNumber = row.licenseNumber || "";
  const address = row.address || "";
  const payRatePerHour = Number(row.payRatePerHour) || 0;
  const skills = row.skills || "";

  const existing = await findUserByEmail(email);
  const t = tdb(cid);

  if (existing) {
    if (await isMember(existing.id, cid)) return { ok: false, reason: "Already on your team" };
    const { membership } = await attachMembership({
      userId: existing.id,
      companyId: cid,
      role: "rider",
      staffType: "technician",
      status: "invited",
      invitedBy: opts.invitedBy,
    });
    const emailed = await trySendJoinCompanyInvite({
      email: existing.email,
      name: existing.name,
      companyId: cid,
      membershipId: membership!.id,
    });
    await t.insert(schema.riders, {
      userId: existing.id,
      phone: phone || existing.phone || "",
      skillClass, vehicle, color: randomColor(), licensePlate, licenseNumber, address,
      notes: "", skills, payRatePerHour, status: "available",
    });
    return { ok: true, status: "invited", emailed };
  }

  try {
    await auth.api.signUpEmail({
      body: { name, email, password: unguessablePassword(), role: "rider", phone } as any,
    });
  } catch (e: any) {
    return { ok: false, reason: e?.message || "Could not create account" };
  }
  const u = await findUserByEmail(email);
  if (!u) return { ok: false, reason: "Could not create account" };
  await sdb.update(schema.user).set({ role: "rider", phone, companyId: cid }).where(eq(schema.user.id, u.id));
  await attachMembership({ userId: u.id, companyId: cid, role: "rider", staffType: "technician", status: "active", invitedBy: opts.invitedBy });
  await t.insert(schema.riders, {
    userId: u.id, phone, skillClass, vehicle, color: randomColor(), licensePlate, licenseNumber, address,
    notes: "", skills, payRatePerHour, status: "available",
  });
  return { ok: true, status: "created", userId: u.id };
}

/* --------------------------------- routes --------------------------------- */

export const importRoutes = new Hono<AppEnv>()
  // GET /api/import/template/:type?format=csv|xlsx
  // GET /api/import/profile: which imports this tenant has, named in its words,
  // and the columns each template carries (shared/import-profile.ts).
  .get("/profile", requireAdmin, async (c) => {
    const { profile } = await directoryVocabFor(tenantId(c));
    return c.json({ profile }, 200);
  })
  .get("/template/:type", requireAdmin, async (c) => {
    const type = c.req.param("type");
    if (!isImportType(type)) return c.json({ message: "Unknown import type" }, 400);
    const { profile, vocab } = await directoryVocabFor(tenantId(c));
    if (!profile.types.includes(type)) return c.json({ message: `Turn on ${vocab.places} in Settings → Directory to import them.` }, 400);
    const format = (c.req.query("format") || "csv").toLowerCase();
    // The tenant's own template: its columns, its words (residents get Property
    // and Unit; an HVAC company's customers get Company and Address).
    const cols = profile.columns[type];
    const exampleRow = Object.fromEntries(cols.map((col) => [col.key, col.example]));
    const stamp = Date.now();
    const slug = profile.slug[type];
    const label = profile.label[type];
    if (format === "xlsx") {
      const buf = await toXlsx([exampleRow], cols, `${label} template`, `${label} import template`);
      return fileResponse(buf, `${slug}-import-template-${stamp}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    }
    // Readable headers ("First Name", "Unit"); the import reads labels and keys alike.
    const csv = toCsv([exampleRow], cols.map((col) => col.key), cols.map((col) => col.label));
    return fileResponse(csv, `${slug}-import-template-${stamp}.csv`, "text/csv; charset=utf-8");
  })
  // POST /api/import/:type  multipart form-data { file }
  .post("/:type", requireAdmin, async (c) => {
    const type = c.req.param("type");
    if (!isImportType(type)) return c.json({ message: "Unknown import type" }, 400);
    const me = c.get("user") as SessionUser;
    if (type === "admin" && !isSuperadmin(me.role))
      return c.json({ message: "Only a superadmin can bulk-import dispatchers" }, 403);

    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return c.json({ message: "No file uploaded" }, 400);
    if (file.size > 5 * 1024 * 1024) return c.json({ message: "File is too large (max 5MB)" }, 400);

    let rows: ParsedRow[];
    try {
      rows = await parseUpload(file);
    } catch {
      return c.json({ message: "Could not read that file — check it's a valid CSV or Excel export" }, 400);
    }
    const cid = tenantId(c);
    const setup = await directoryVocabFor(cid);
    if (!setup.profile.types.includes(type)) return c.json({ message: `Turn on ${setup.vocab.places} in Settings → Directory to import them.` }, 400);
    const columns = setup.profile.columns[type];
    // Keep each row's line in the file (after any title line and the header) for the failure list.
    const lines = rows
      .map((r) => ({ line: r.line, row: normalizeImportRow(type, r.row, { columns, placesEnabled: setup.profile.placesEnabled }) }))
      .filter((x) => Object.keys(x.row).length && !isTemplateExample(type, x.row));
    if (!lines.length) return c.json({ message: "No rows found in that file. Check that it has a row of column names, such as Name, Email and Phone, with people listed below it." }, 400);
    if (lines.length > 500) return c.json({ message: "Import is limited to 500 rows at a time" }, 400);

    // Creating needs clients:create (office-access.ts); a row that changes an
    // existing resident's property, or an existing property, also needs edit.
    const canEdit = type === "rider" || type === "admin" ? true : await officeCan(c.get("user") as { role?: string; permissions?: string | null }, "clients:edit");
    const results: { row: number; email: string; ok: boolean; status?: string; reason?: string; emailed?: boolean; warning?: string }[] = [];
    const newPeople: string[] = [];
    for (const { line, row } of lines) {
      const result =
        type === "rider"
          ? await importRiderRow(row, { companyId: cid, invitedBy: me.id })
          : type === "property"
            ? await importPropertyRow(row, { companyId: cid, canEdit, words: setup.words })
            : await importPersonRow(row, { role: type, companyId: cid, invitedBy: me.id, canEdit, words: setup.words });
      // A row without an email gets a placeholder address nobody can receive.
      if (type !== "property" && result.ok && result.status === "created" && row.email && !isUndeliverableEmail(row.email)) newPeople.push(result.userId);
      results.push({
        row: line,
        // Properties have no email: the row is named by the property instead.
        email: type === "property" ? row.name || "" : row.email || "",
        ok: result.ok,
        ...(result.ok ? { status: result.status, warning: result.warning } : { reason: result.reason }),
        ...(result.ok && result.status === "invited" ? { emailed: result.emailed } : {}),
      });
    }

    const created = results.filter((r) => r.ok && r.status === "created").length;
    const updated = results.filter((r) => r.ok && r.status === "updated").length;
    const warnings = results.filter((r) => r.ok && r.warning).map((r) => ({ row: r.row, email: r.email, message: r.warning! }));
    const invited = results.filter((r) => r.ok && r.status === "invited").length;
    // Added as invited, but the invitation email didn't go out (no email
    // provider, or it failed): the admin needs to resend those.
    const invitesNotEmailed = results.filter((r) => r.ok && r.status === "invited" && !r.emailed).length;
    const failed = results.filter((r) => !r.ok);
    // New technicians and office staff get their welcome email (set-password
    // link) one by one in the background; customers get nothing until a job.
    const welcoming = type === "customer" || type === "property" ? 0 : newPeople.length;
    if (welcoming) queueWelcomes(cid, newPeople, me.id);
    return c.json(
      {
        total: lines.length,
        created,
        updated,
        warnings,
        invited,
        invitesNotEmailed,
        welcoming,
        failedCount: failed.length,
        failed: failed.map((r) => ({ row: r.row, email: r.email, reason: r.reason })),
      },
      200,
    );
  });
