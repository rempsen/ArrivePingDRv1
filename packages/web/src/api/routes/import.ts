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
import { requireAdmin, tenantId } from "../middleware/auth";
import { auth } from "../auth";
import { isSuperadmin } from "../lib/permissions";
import { attachMembership, isMember, findUserByEmail } from "../lib/memberships";
import { trySendJoinCompanyInvite } from "../lib/join-invite";
import { queueWelcomes } from "../../services/welcome";
import { isUndeliverableEmail } from "../../shared/sample-contact";
import { email as emailField } from "../lib/validate";
import { toCsv, toXlsx, fileResponse } from "./export";
import type { AppEnv } from "../env";

type SessionUser = { id: string; role?: string };

export type ImportType = "customer" | "admin" | "rider";
const IMPORT_TYPES: ImportType[] = ["customer", "admin", "rider"];

const IMPORT_LABEL: Record<ImportType, string> = {
  customer: "Customers",
  admin: "Dispatchers",
  rider: "Technicians",
};

/** Template columns per entity type — writable fields only, nothing the
 *  server derives itself (no id, status, rating, completedJobs, etc). */
const TEMPLATE_COLUMNS: Record<ImportType, { key: string; label: string; example: string }[]> = {
  customer: [
    { key: "firstName", label: "First Name", example: "Jane" },
    { key: "lastName", label: "Last Name", example: "Doe" },
    { key: "email", label: "Email", example: "jane.doe@example.com" },
    { key: "phone", label: "Phone", example: "+1 555 123 4567" },
    { key: "company", label: "Company", example: "Acme Co." },
    { key: "website", label: "Website", example: "https://acme.com" },
    { key: "address", label: "Address", example: "123 Main St" },
    { key: "city", label: "City", example: "Toronto" },
    { key: "region", label: "Province / State", example: "ON" },
    { key: "postalCode", label: "Postal / ZIP", example: "M5V 2T6" },
    { key: "country", label: "Country", example: "Canada" },
    { key: "customerType", label: "Account Type (one_time or repeat)", example: "repeat" },
  ],
  admin: [
    { key: "firstName", label: "First Name", example: "Sam" },
    { key: "lastName", label: "Last Name", example: "Lee" },
    { key: "email", label: "Email", example: "sam.lee@example.com" },
    { key: "phone", label: "Phone", example: "+1 555 987 6543" },
  ],
  rider: [
    { key: "name", label: "Full Name", example: "Alex Chen" },
    { key: "email", label: "Email", example: "alex.chen@example.com" },
    { key: "phone", label: "Phone", example: "+1 555 222 3333" },
    { key: "skillClass", label: "Skill Class", example: "General" },
    { key: "vehicle", label: "Vehicle", example: "Van" },
    { key: "licensePlate", label: "License Plate", example: "ABC123" },
    { key: "licenseNumber", label: "License Number", example: "D1234-56789" },
    { key: "address", label: "Address", example: "456 Elm St" },
    { key: "payRatePerHour", label: "Pay Rate / Hour", example: "28" },
    { key: "skills", label: "Skills (comma separated)", example: "HVAC, Plumbing" },
  ],
};

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
};

const squash = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * One uploaded row with its columns renamed to the template's keys, whatever
 * the file called them. A column the template doesn't have is dropped; when
 * two columns mean the same thing, the first non-empty one wins. A row with a
 * first and last name but no full name gets one, so a technician list split
 * into two name columns imports with names too.
 */
export function normalizeImportRow(type: ImportType, raw: Record<string, string>): Record<string, string> {
  const lookup = new Map<string, string>();
  for (const col of TEMPLATE_COLUMNS[type]) {
    lookup.set(squash(col.key), col.key);
    lookup.set(squash(col.label), col.key);
  }
  // Only the fields this import has (plus the name parts a full name is built
  // from), so a column meant for another kind of import doesn't make a row.
  const allowed = new Set([...TEMPLATE_COLUMNS[type].map((c) => c.key), "name", "firstName", "lastName"]);
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
  if (out.customerType) out.customerType = /repeat|recurring|regular|member/i.test(out.customerType) ? "repeat" : "one_time";
  return out;
}

/** The template's own example row, filled in for each type: never imported if left in. */
export function isTemplateExample(type: ImportType, row: Record<string, string>): boolean {
  const cols = TEMPLATE_COLUMNS[type];
  const email = cols.find((c) => c.key === "email")?.example;
  return !!email && (row.email || "").toLowerCase() === email.toLowerCase();
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

/** Minimal CSV reader matching what toCsv() in export.ts writes: comma-
 *  separated, double-quote wrapped when a value has a comma/quote/newline,
 *  `""` for a literal quote inside a quoted field. */
function parseCsv(text: string): Record<string, string>[] {
  const clean = text.replace(/^﻿/, "");
  const lines = clean.split(/\r\n|\n|\r/).filter((l) => l.length > 0);
  if (!lines.length) return [];
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
  const headers = parseLine(lines[0]!).map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseLine(lines[i]!);
    if (cells.every((c) => !c.trim())) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = (cells[idx] ?? "").trim(); });
    rows.push(row);
  }
  return rows;
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

async function parseXlsx(buf: Buffer): Promise<Record<string, string>[]> {
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
  let headers: string[] = [];
  const rows: Record<string, string>[] = [];
  ws.eachRow((row, rowNumber) => {
    const raw = (row.values as any[]).slice(1);
    const cells = raw.map((v) => {
      if (v == null) return "";
      if (typeof v === "object" && "text" in v) return String((v as any).text ?? "");
      if (typeof v === "object" && "result" in v) return String((v as any).result ?? "");
      return String(v);
    });
    if (rowNumber === 1) { headers = cells.map((h) => h.trim()); return; }
    if (cells.every((c) => !c.trim())) return;
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = (cells[i] ?? "").trim(); });
    rows.push(obj);
  });
  return rows;
}

async function parseUpload(file: File): Promise<Record<string, string>[]> {
  const name = (file.name || "").toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return parseXlsx(buf);
  return parseCsv(buf.toString("utf8"));
}

/* -------------------------------- rows -> accounts ------------------------ */

type RowResult =
  | { ok: true; status: "created"; userId: string }
  /** Already had a login elsewhere; `emailed` = the invitation email actually went out. */
  | { ok: true; status: "invited"; emailed: boolean }
  | { ok: false; reason: string };

const PALETTE = ["#06b6d4", "#22c55e", "#f59e0b", "#a855f7", "#ef4444", "#3b82f6"];
const randomColor = () => PALETTE[Math.floor(Math.random() * PALETTE.length)];

/** customer or dispatcher row */
async function importPersonRow(
  row: Record<string, string>,
  opts: { role: "customer" | "admin"; companyId: string; invitedBy: string | null },
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
    if (await isMember(existing.id, cid)) return { ok: false, reason: "Already in your account" };
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
    return { ok: true, status: "invited", emailed };
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
  return { ok: true, status: "created", userId: u.id };
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
  .get("/template/:type", requireAdmin, async (c) => {
    const type = c.req.param("type");
    if (!isImportType(type)) return c.json({ message: "Unknown import type" }, 400);
    const format = (c.req.query("format") || "csv").toLowerCase();
    const cols = TEMPLATE_COLUMNS[type];
    const exampleRow = Object.fromEntries(cols.map((col) => [col.key, col.example]));
    const stamp = Date.now();
    const slug = type === "rider" ? "technicians" : type === "admin" ? "dispatchers" : "customers";
    if (format === "xlsx") {
      const buf = await toXlsx([exampleRow], cols, `${IMPORT_LABEL[type]} template`, `${IMPORT_LABEL[type]} import template`);
      return fileResponse(buf, `${slug}-import-template-${stamp}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    }
    const csv = toCsv([exampleRow], cols.map((c) => c.key));
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

    let rows: Record<string, string>[];
    try {
      rows = await parseUpload(file);
    } catch {
      return c.json({ message: "Could not read that file — check it's a valid CSV or Excel export" }, 400);
    }
    // Keep each row's line in the file (the header is line 1) for the failure list.
    const lines = rows
      .map((r, i) => ({ line: i + 2, row: normalizeImportRow(type, r) }))
      .filter((x) => Object.keys(x.row).length && !isTemplateExample(type, x.row));
    if (!lines.length) return c.json({ message: "No rows found in that file. Check that the first row holds the column names, such as Name, Email and Phone." }, 400);
    if (lines.length > 500) return c.json({ message: "Import is limited to 500 rows at a time" }, 400);

    const cid = tenantId(c);
    const results: { row: number; email: string; ok: boolean; status?: string; reason?: string; emailed?: boolean }[] = [];
    const newPeople: string[] = [];
    for (const { line, row } of lines) {
      const result =
        type === "rider"
          ? await importRiderRow(row, { companyId: cid, invitedBy: me.id })
          : await importPersonRow(row, { role: type, companyId: cid, invitedBy: me.id });
      // A row without an email gets a placeholder address nobody can receive.
      if (result.ok && result.status === "created" && row.email && !isUndeliverableEmail(row.email)) newPeople.push(result.userId);
      results.push({
        row: line,
        email: row.email || "",
        ok: result.ok,
        ...(result.ok ? { status: result.status } : { reason: result.reason }),
        ...(result.ok && result.status === "invited" ? { emailed: result.emailed } : {}),
      });
    }

    const created = results.filter((r) => r.ok && r.status === "created").length;
    const invited = results.filter((r) => r.ok && r.status === "invited").length;
    // Added as invited, but the invitation email didn't go out (no email
    // provider, or it failed): the admin needs to resend those.
    const invitesNotEmailed = results.filter((r) => r.ok && r.status === "invited" && !r.emailed).length;
    const failed = results.filter((r) => !r.ok);
    // New technicians and office staff get their welcome email (set-password
    // link) one by one in the background; customers get nothing until a job.
    const welcoming = type === "customer" ? 0 : newPeople.length;
    if (welcoming) queueWelcomes(cid, newPeople, me.id);
    return c.json(
      {
        total: lines.length,
        created,
        invited,
        invitesNotEmailed,
        welcoming,
        failedCount: failed.length,
        failed: failed.map((r) => ({ row: r.row, email: r.email, reason: r.reason })),
      },
      200,
    );
  });
