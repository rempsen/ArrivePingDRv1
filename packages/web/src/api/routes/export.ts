import { usersForCompany } from "../lib/memberships";
import { Hono } from "hono";
import { sdb } from "../database";
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";
import { requireAuth, tenantId } from "../middleware/auth";
import { tdb, type TenantDb } from "../database/tenant";
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { slugifyName, fetchRouteBasemap, fetchSiteBasemap, type JobRoutePoint } from "../lib/export-map";
import { companyTimeZone } from "../../services/company-tz";
import { fmtInZone } from "../../shared/tz";
import type { AppEnv } from "../env";

export { slugifyName, fetchRouteBasemap, fetchSiteBasemap };
export type { JobRoutePoint };

/* ------------------------------- CSV -------------------------------- */
export function toCsv(rows: Record<string, any>[], columns?: string[]): string {
  if (!rows.length) return columns?.length ? columns.join(",") + "\n" : "";
  const cols = columns?.length ? columns : Object.keys(rows[0]);
  const esc = (v: any) => {
    if (v == null) return "";
    if (v instanceof Date) return v.toISOString();
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = cols.join(",");
  const body = rows.map((r) => cols.map((c) => esc(r[c])).join(",")).join("\n");
  return head + "\n" + body;
}

/* ------------------------------ XLSX -------------------------------- */
export async function toXlsx(
  rows: Record<string, any>[],
  columns: { key: string; label: string; kind?: string }[],
  sheetName = "Report",
  title?: string,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ArrivePing";
  const ws = wb.addWorksheet(sheetName.replace(/[\\/?*[\]:]/g, " ").slice(0, 28) || "Report");

  // column widths
  columns.forEach((c, i) => { ws.getColumn(i + 1).width = Math.max(12, c.label.length + 4); });

  if (title) {
    ws.mergeCells(1, 1, 1, Math.max(columns.length, 1));
    const t = ws.getCell(1, 1);
    t.value = title;
    t.font = { bold: true, size: 14, color: { argb: "FF0EA5C9" } };
    ws.getRow(1).height = 22;
  }
  const headerRowIdx = title ? 2 : 1;

  const headRow = ws.getRow(headerRowIdx);
  columns.forEach((c, i) => {
    const cell = headRow.getCell(i + 1);
    cell.value = c.label;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
    cell.alignment = { vertical: "middle" };
  });

  rows.forEach((r, ri) => {
    const row = ws.getRow(headerRowIdx + 1 + ri);
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.value = r[c.key] ?? "";
      if (c.kind === "money") cell.numFmt = '"$"#,##0.00';
      else if (c.kind === "pct") cell.numFmt = '0.0"%"';
      else if (c.kind === "num") cell.numFmt = "#,##0.##";
    });
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/* ------------------------------- PDF -------------------------------- */
/** A raw 36-char UUID eats a whole table column and tells nobody anything —
 *  shorten it the same way the single-job PDF's "JOB xxxxxxx" number does
 *  (strip dashes, first 8 chars, upper-case) so an "id" column stays
 *  meaningful without hogging width. CSV/XLSX still get the real id. */
function shortId(v: string): string {
  const s = String(v).replace(/-/g, "");
  return s.length > 8 ? s.slice(0, 8).toUpperCase() : s.toUpperCase();
}

/** Shrink `text` with a trailing ellipsis until it actually fits `maxWidth`
 *  at this font/size — replaces the old fixed "slice at 26 chars" rule,
 *  which is exactly what produced overlapping/garbled rows: a 26-char
 *  slice is far wider than a narrow money or status column, so neighboring
 *  cells' text painted on top of each other. Measuring real glyph width
 *  per column is what actually keeps every cell inside its own lane. */
function fitText(text: string, font: { widthOfTextAtSize(text: string, size: number): number }, size: number, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  const ellipsis = "…";
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = text.slice(0, mid) + ellipsis;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + ellipsis : ellipsis;
}

/** Raw-table PDF used for the "Raw data exports" (Jobs/Installers/Customers/
 *  Invoices) and for ad-hoc dashboard report exports. Shares the same
 *  branded-header / footer treatment as buildJobPdf below so every PDF a
 *  tenant downloads — single job sheet or bulk table — carries their own
 *  logo and brand color instead of looking like a generic system dump. */
export async function toPdf(
  rows: Record<string, any>[],
  columns: { key: string; label: string; kind?: string; width?: number }[],
  title: string,
  subtitle?: string,
  /** Tenant's IANA zone. Without it a date cell renders on the server's UTC
   *  clock, so an evening job prints on the next calendar day. */
  tz?: string | null,
  brand?: JobBrand | null,
  baseUrl?: string,
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  // Letter landscape runs out of room past ~8 columns even with weighted
  // widths — every label starts truncating hard. Tabloid landscape (11x17")
  // gives ~70% more usable width for wide tables (Work Orders, Technicians)
  // and still prints on one physical sheet, same idea as buildJobPdf using
  // portrait letter because its layout is single-column detail cards.
  const wide = columns.length > 8;
  const pageW = wide ? 1224 : 792, pageH = wide ? 792 : 612; // landscape tabloid or letter
  const margin = 32;
  const usableW = pageW - margin * 2;
  const brandColor = hexRgb(brand?.brandColor);
  const ink = rgb(0.1, 0.12, 0.15);
  const muted = rgb(0.45, 0.5, 0.56);
  // More than ~9 columns on a landscape page needs a smaller row font to
  // stay legible rather than cramming full-size text into slivers.
  const rowSize = wide ? (columns.length > 13 ? 7.5 : 8) : 8;
  const headSize = Math.min(rowSize, 7.5);
  const rowH = rowSize + 7;

  // Column widths are weighted, not equal — an address or client name needs
  // far more room than a status or priority flag. Unweighted columns
  // (dashboard report exports) default to 1, so old callers behave the same.
  const DEFAULT_WEIGHTS: Record<string, number> = {
    id: 0.7, title: 1.4, service: 1.15, client: 1.15, name: 1.15,
    clientPhone: 0.95, phone: 0.95, technician: 1.15, status: 0.8,
    priority: 0.75, address: 1.7, scheduledAt: 0.95, price: 0.85,
    amount: 0.85, tax: 0.75, total: 0.85, paymentStatus: 0.95,
    method: 0.85, createdAt: 0.95, paidAt: 0.95, email: 1.3,
    vehicle: 0.95, skillClass: 0.85, skills: 1.2, rating: 0.7,
    completedJobs: 0.8, number: 0.9,
  };
  const weights = columns.map((c) => c.width ?? DEFAULT_WEIGHTS[c.key] ?? 1);
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
  const colWidths = weights.map((w) => (usableW * w) / totalWeight);
  const colX = colWidths.reduce<number[]>((acc, w, i) => {
    acc.push(i === 0 ? margin : acc[i - 1] + colWidths[i - 1]);
    return acc;
  }, []);
  const PAD = 5;

  const fmt = (v: any, kind?: string) => {
    if (v == null || v === "") return "";
    if (kind === "money") return "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (kind === "pct") return `${Number(v).toFixed(1)}%`;
    if (kind === "num") return Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
    if (kind === "date") { const d = new Date(v); return isNaN(+d) ? String(v) : fmtInZone(d, tz, { year: "numeric", month: "numeric", day: "numeric" }); }
    if (kind === "id") return shortId(String(v));
    return String(v);
  };

  let page = doc.addPage([pageW, pageH]);
  let y = pageH - margin;
  // Same encoding-crash protection as buildJobPdf below: standard fonts only
  // support WinAnsi, so any emoji/unsupported character in row data (e.g. a
  // customer name) would otherwise throw and 500 the whole bulk export.
  const dt = (text: string, opts: Parameters<typeof page.drawText>[1]) => {
    try {
      page.drawText(text, opts);
    } catch {
      const ascii = Array.from(text).filter((ch) => (ch.codePointAt(0) ?? 0) <= 0x7f).join("").trim();
      page.drawText(ascii || "(unsupported character)", opts);
    }
  };
  const drawRight = (text: string, yy: number, size: number, f = font, color = muted) => {
    const w = f.widthOfTextAtSize(text, size);
    dt(text, { x: pageW - margin - w, y: yy, size, font: f, color });
  };

  // --- branded header (logo or tenant name, brand-colored rule, title) ---
  let logoImg: any = null;
  if (brand?.logo) {
    try {
      const resp = await fetch(absoluteUrl(brand.logo, baseUrl || ""));
      if (resp.ok) {
        const buf = Buffer.from(await resp.arrayBuffer());
        const ct = resp.headers.get("content-type") || "";
        logoImg = ct.includes("png") ? await doc.embedPng(buf) : await doc.embedJpg(buf);
      }
    } catch { /* no logo — header just skips it */ }
  }
  const headerTop = y;
  let headerH = 20;
  if (logoImg) {
    const maxH = 28, maxW = 130;
    const scale = Math.min(maxW / logoImg.width, maxH / logoImg.height, 1);
    const w = logoImg.width * scale, h = logoImg.height * scale;
    page.drawImage(logoImg, { x: margin, y: headerTop - h, width: w, height: h });
    headerH = h;
  } else if (brand?.name) {
    dt(brand.name, { x: margin, y: headerTop - 13, size: 12, font: bold, color: ink });
    headerH = 18;
  }
  const generatedOn = new Date().toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
  drawRight(`Generated ${generatedOn}`, headerTop - headerH / 2 - 3, 7.5, font, muted);
  y -= Math.max(headerH, 18) + 12;
  page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 2, color: brandColor });
  y -= 18;

  dt(title, { x: margin, y: y - 2, size: 15, font: bold, color: brandColor });
  y -= 20;
  if (subtitle) { dt(subtitle, { x: margin, y, size: 9, font, color: muted }); y -= 14; }
  y -= 4;

  const drawTableHeader = () => {
    page.drawRectangle({ x: margin, y: y - 16, width: usableW, height: 18, color: rgb(0.06, 0.09, 0.16) });
    columns.forEach((c, i) => {
      dt(fitText(c.label, bold, headSize, colWidths[i] - PAD * 2), { x: colX[i] + PAD, y: y - 12, size: headSize, font: bold, color: rgb(1, 1, 1) });
    });
    y -= 20;
  };
  drawTableHeader();

  const drawFooter = (p: typeof page, pageNum: number, pageCount: number) => {
    const footerY = 22;
    p.drawLine({ start: { x: margin, y: footerY + 10 }, end: { x: pageW - margin, y: footerY + 10 }, thickness: 0.5, color: rgb(0.88, 0.9, 0.93) });
    const left = [brand?.name, title].filter(Boolean).join(" · ");
    if (left) p.drawText(fitText(left, font, 7, usableW / 2), { x: margin, y: footerY, size: 7, font, color: muted });
    const pageLabel = `Page ${pageNum} of ${pageCount}`;
    const pw = font.widthOfTextAtSize(pageLabel, 7);
    p.drawText(pageLabel, { x: pageW - margin - pw, y: footerY, size: 7, font, color: muted });
  };

  rows.forEach((r, ri) => {
    if (y < margin + rowH + 10) {
      page = doc.addPage([pageW, pageH]);
      y = pageH - margin;
      drawTableHeader();
    }
    if (ri % 2 === 0) page.drawRectangle({ x: margin, y: y - (rowH - 2), width: usableW, height: rowH, color: rgb(0.96, 0.97, 0.98) });
    columns.forEach((c, i) => {
      const isNumeric = c.kind === "money" || c.kind === "num" || c.kind === "pct";
      const text = fitText(fmt(r[c.key], c.kind), font, rowSize, colWidths[i] - PAD * 2);
      const x = isNumeric
        ? colX[i] + colWidths[i] - PAD - font.widthOfTextAtSize(text, rowSize)
        : colX[i] + PAD;
      dt(text, { x, y: y - rowH + 5, size: rowSize, font, color: ink });
    });
    y -= rowH;
  });

  // Stamp every page with a footer — matching buildJobPdf's per-page footer
  // treatment so a raw table export reads as the same document family as a
  // single job sheet, rather than a generic system dump.
  const allPages = doc.getPages();
  allPages.forEach((p, i) => drawFooter(p, i + 1, allPages.length));

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

/* ----------------------- single-job detail PDF ---------------------- */
/** Internal (office/dispatch/driver) job sheet: label/value details + a
 *  per-unit work & pay breakdown. NEVER given to the client — it exposes
 *  tech-pay rates. Charge-only invoice for the client lives elsewhere. */
export type JobUnitLine = {
  name: string;
  unit: string;
  qty: number;
  unitPrice: number; // customer charge per unit
  unitCost: number;  // tech pay per unit
  price: number;     // line customer charge
  cost: number;      // line tech pay
};
export type JobPhoto = { url: string; caption?: string };
export type JobBrand = { name?: string; logo?: string; brandColor?: string };

/** "#0ea5e9" -> pdf-lib rgb(). Falls back to the app's default brand cyan on
 *  anything unparsable so a bad/missing tenant color never breaks the PDF. */
function hexRgb(hex?: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  const h = m ? m[1] : "0ea5e9";
  return rgb(
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  );
}

/** Resolve a stored file URL (often a relative "/api/public/file/..." or
 *  "/uploads/..." path — fine for a browser, meaningless to server-side
 *  fetch()) to an absolute URL so the PDF builder can actually download and
 *  embed it. Uses the CURRENT request's own origin rather than a
 *  separately-configured base-URL env var, so this is correct in every
 *  environment (local dev, sandbox preview, production) without needing to
 *  keep an env var in sync with wherever the app actually happens to be
 *  running — the file-serving proxy route lives on this same server. */
function absoluteUrl(url: string, baseUrl: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base = baseUrl.replace(/\/$/, "");
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

/* --------------------- tenant-aware export filenames ---------------------- */

/** Filename prefix for every export: the TENANT's name, not "nvc360".
 *  Downloads land in one folder across companies, so the company has to be in
 *  the name or a BMD Materials report is indistinguishable from any other
 *  tenant's. Falls back to "nvc360" only when the tenant has no name set. */
export async function tenantFilePrefix(companyId: string): Promise<string> {
  try {
    const row = await tdb(companyId).selectOne(schema.companySettings);
    return slugifyName(row?.name) || "nvc360";
  } catch {
    return "nvc360";
  }
}

export async function buildJobPdf(
  details: { field: string; value: any; group?: string }[],
  unitLines: JobUnitLine[],
  title: string,
  subtitle?: string,
  photos?: JobPhoto[],
  brand?: JobBrand | null,
  route?: JobRoutePoint[],
  baseUrl?: string,
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pageW = 612, pageH = 792; // portrait letter
  const margin = 40;
  const usableW = pageW - margin * 2;
  const brandColor = hexRgb(brand?.brandColor);
  const ink = rgb(0.1, 0.12, 0.15);
  const muted = rgb(0.45, 0.5, 0.56);
  const money = (v: any) => `${Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const num = (v: any) => Number(v || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
  // Standard PDF fonts (Helvetica/HelveticaBold) only support WinAnsi
  // encoding. It actually covers plenty of "fancy" punctuation (em-dash,
  // ellipsis, curly quotes) just fine — the real crash risk is emoji and
  // other characters outside WinAnsi entirely, which throw at draw time
  // ("WinAnsi cannot encode ...") and previously took down the WHOLE export
  // with a 500 the moment any job photo caption (or other free-text field)
  // contained one. Try the real text first (keeps existing punctuation
  // working exactly as before); only on an actual encoding failure fall
  // back to stripping to plain ASCII and retry, so one bad character can
  // never crash the export.
  const dt = (text: string, opts: Parameters<typeof page.drawText>[1]) => {
    try {
      page.drawText(text, opts);
    } catch {
      const ascii = Array.from(text).filter((ch) => (ch.codePointAt(0) ?? 0) <= 0x7f).join("").trim();
      page.drawText(ascii || "(unsupported character)", opts);
    }
  };
  /** Small colored square + bold label — the section-header treatment used
   *  throughout, so each block reads as a distinct card like the in-app
   *  report page instead of one long undifferentiated dump. */
  const sectionHeader = (label: string) => {
    page.drawRectangle({ x: margin, y: y - 10, width: 9, height: 9, color: brandColor });
    dt(label, { x: margin + 15, y: y - 8, size: 11, font: bold, color: ink });
    y -= 8;
    page.drawLine({ start: { x: margin, y: y - 6 }, end: { x: pageW - margin, y: y - 6 }, thickness: 0.75, color: rgb(0.88, 0.9, 0.93) });
    y -= 18;
  };

  let page = doc.addPage([pageW, pageH]);
  let y = pageH - margin;
  const ensure = (need: number) => {
    if (y < margin + need) { page = doc.addPage([pageW, pageH]); y = pageH - margin; }
  };

  // --- branded header ---
  // Right-aligned helper — every "print this flush against the right margin"
  // spot (generated-on stamp, footer page numbers) needs its own width
  // measurement, so one small helper instead of repeating widthOfTextAtSize
  // + subtraction at each call site.
  const drawRight = (text: string, yy: number, size: number, f = font, color = muted) => {
    const w = f.widthOfTextAtSize(text, size);
    dt(text, { x: pageW - margin - w, y: yy, size, font: f, color });
  };
  const generatedOn = new Date().toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });

  let logoImg: any = null;
  if (brand?.logo) {
    try {
      const resp = await fetch(absoluteUrl(brand.logo, baseUrl || ""));
      if (resp.ok) {
        const buf = Buffer.from(await resp.arrayBuffer());
        const ct = resp.headers.get("content-type") || "";
        logoImg = ct.includes("png") ? await doc.embedPng(buf) : await doc.embedJpg(buf);
      }
    } catch { /* no logo — header just skips it */ }
  }
  const headerTop = y;
  // A logo image is almost always a full wordmark already (scraped from the
  // tenant's own site) — printing the tenant name a second time next to it
  // just doubles up the same text. Only fall back to a plain text lockup
  // when there is no logo to show at all.
  let headerH = 20;
  if (logoImg) {
    const maxH = 34, maxW = 150;
    const scale = Math.min(maxW / logoImg.width, maxH / logoImg.height, 1);
    const w = logoImg.width * scale, h = logoImg.height * scale;
    page.drawImage(logoImg, { x: margin, y: headerTop - h, width: w, height: h });
    headerH = h;
  } else if (brand?.name) {
    dt(brand.name, { x: margin, y: headerTop - 14, size: 13, font: bold, color: ink });
    headerH = 20;
  }
  // Right side of the header: a small "generated on" stamp, invoice-style —
  // gives the report a document-of-record feel instead of a raw data dump.
  drawRight(`Generated ${generatedOn}`, headerTop - headerH / 2 - 3, 7.5, font, muted);
  y -= Math.max(headerH, 20) + 14;
  page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 2, color: brandColor });
  y -= 22;

  dt("JOB REPORT", { x: margin, y, size: 8, font: bold, color: muted });
  y -= 15;
  dt(title, { x: margin, y: y - 4, size: 17, font: bold, color: brandColor });
  y -= 24;
  if (subtitle) { dt(String(subtitle).slice(0, 90), { x: margin, y, size: 9, font, color: muted }); y -= 16; }
  // "Internal copy" as a bordered callout rather than a bare line of red
  // text — reads as a deliberate document notice, not an error message.
  const noticeText = "INTERNAL COPY — includes technician pay. Not for the customer.";
  const noticeW = bold.widthOfTextAtSize(noticeText, 8) + 16;
  page.drawRectangle({
    x: margin, y: y - 15, width: noticeW, height: 18,
    color: rgb(0.99, 0.94, 0.93), borderColor: rgb(0.86, 0.55, 0.48), borderWidth: 0.75,
  });
  dt(noticeText, { x: margin + 8, y: y - 10, size: 8, font: bold, color: rgb(0.7, 0.22, 0.15) });
  y -= 30;

  // --- details, grouped into named sections (carried via each row's
  // `group`) instead of one 29-row undifferentiated list. Falls back to a
  // single "Job Details" section if the caller didn't tag groups. ---
  const GROUP_TITLE: Record<string, string> = {
    summary: "Job Overview",
    detail: "Financials & Time Tracking",
  };
  const groups: { key: string; rows: typeof details }[] = [];
  for (const r of details) {
    const key = r.group || "details";
    let g = groups.find((x) => x.key === key);
    if (!g) { g = { key, rows: [] }; groups.push(g); }
    g.rows.push(r);
  }
  const labelW = 150;
  groups.forEach((g) => {
    ensure(40);
    sectionHeader(GROUP_TITLE[g.key] || "Job Details");
    g.rows.forEach((r, ri) => {
      ensure(20);
      if (ri % 2 === 0) page.drawRectangle({ x: margin, y: y - 11, width: usableW, height: 14, color: rgb(0.96, 0.97, 0.98) });
      dt(String(r.field).slice(0, 32), { x: margin + 4, y: y - 8, size: 8, font: bold, color: rgb(0.25, 0.3, 0.36) });
      const val = String(r.value ?? "");
      dt(val.length > 70 ? val.slice(0, 68) + "…" : val, { x: margin + labelW, y: y - 8, size: 8, font, color: ink });
      y -= 14;
    });
    y -= 16;
  });

  // --- route section ---
  // Primary: a REAL street-level basemap (Google Static Maps, scale=2) with the
  // driven GPS track drawn on it per phase — street names, scale bar, context,
  // i.e. actually usable as proof of where the tech drove.
  // Fallback (no API key / fetch failed): the old vector sketch of the path,
  // which has no streets but still shows the trip shape. Never fail the export
  // over a map.
  let drewRouteMap = false;
  if (route && route.length > 1) {
    const mapPng = await fetchRouteBasemap(route, subtitle).catch(() => null);
    if (mapPng) {
      let mapImg: any = null;
      try { mapImg = await doc.embedPng(mapPng); } catch { mapImg = null; }
      if (mapImg) {
        const w = usableW;
        const h = (mapImg.height / mapImg.width) * w;
        ensure(h + 46);
        sectionHeader("Route Driven");
        const top = y;
        page.drawImage(mapImg, { x: margin, y: top - h, width: w, height: h });
        page.drawRectangle({ x: margin, y: top - h, width: w, height: h, borderColor: rgb(0.82, 0.85, 0.88), borderWidth: 0.75 });
        y = top - h - 12;
        dt("A = start   B = finish   Blue = en route   Amber = on site   Green = return", { x: margin, y, size: 7.5, font, color: muted });
        y -= 20;
        drewRouteMap = true;
      }
    }
    // close-in view of the stop itself (street-level detail the overview can't show)
    if (drewRouteMap) {
      const sitePng = await fetchSiteBasemap(route).catch(() => null);
      if (sitePng) {
        let siteImg: any = null;
        try { siteImg = await doc.embedPng(sitePng); } catch { siteImg = null; }
        if (siteImg) {
          const w = usableW;
          const h = (siteImg.height / siteImg.width) * w;
          ensure(h + 46);
          sectionHeader("Job Site — Street Detail");
          const top = y;
          page.drawImage(siteImg, { x: margin, y: top - h, width: w, height: h });
          page.drawRectangle({ x: margin, y: top - h, width: w, height: h, borderColor: rgb(0.82, 0.85, 0.88), borderWidth: 0.75 });
          y = top - h - 12;
          dt("Zoomed to the on-site GPS position (red pin = stop, amber = movement while on site).", { x: margin, y, size: 7.5, font, color: muted });
          y -= 20;
        }
      }
    }
  }
  if (route && route.length > 1 && !drewRouteMap) {
    ensure(190);
    sectionHeader("Route Driven");
    const boxH = 150;
    const boxY = y - boxH;
    page.drawRectangle({ x: margin, y: boxY, width: usableW, height: boxH, color: rgb(0.07, 0.09, 0.14) });
    const lats = route.map((p) => p.lat), lngs = route.map((p) => p.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const pad = 14;
    const spanLat = Math.max(maxLat - minLat, 0.0005);
    const spanLng = Math.max(maxLng - minLng, 0.0005);
    const toXY = (lat: number, lng: number) => ({
      x: margin + pad + ((lng - minLng) / spanLng) * (usableW - pad * 2),
      y: boxY + pad + ((lat - minLat) / spanLat) * (boxH - pad * 2),
    });
    const PHASE_COLOR: Record<string, ReturnType<typeof rgb>> = {
      enroute: rgb(0.06, 0.65, 0.91),
      onsite: rgb(0.96, 0.62, 0.04),
      return: rgb(0.13, 0.77, 0.37),
    };
    for (let i = 1; i < route.length; i++) {
      const a = toXY(route[i - 1].lat, route[i - 1].lng);
      const b = toXY(route[i].lat, route[i].lng);
      page.drawLine({ start: a, end: b, thickness: 2.5, color: PHASE_COLOR[route[i].phase] ?? rgb(0.6, 0.65, 0.7) });
    }
    const start = toXY(route[0].lat, route[0].lng);
    const end = toXY(route[route.length - 1].lat, route[route.length - 1].lng);
    page.drawCircle({ x: start.x, y: start.y, size: 6, color: rgb(0.06, 0.65, 0.91), borderColor: rgb(1, 1, 1), borderWidth: 1.5 });
    page.drawCircle({ x: end.x, y: end.y, size: 6, color: rgb(0.94, 0.27, 0.27), borderColor: rgb(1, 1, 1), borderWidth: 1.5 });
    y = boxY - 10;
    dt("● En route   ● On site   ● Return   A = start   B = finish", { x: margin, y, size: 7.5, font, color: muted });
    y -= 20;
  }

  // --- per-unit breakdown table ---
  if (unitLines.length) {
    ensure(60);
    sectionHeader("Per-Unit Work & Pay");
    const cols = [
      { label: "Description", w: 0.30, align: "l" as const },
      { label: "Unit", w: 0.10, align: "l" as const },
      { label: "Qty", w: 0.08, align: "r" as const },
      { label: "Charge/u", w: 0.13, align: "r" as const },
      { label: "Pay/u", w: 0.13, align: "r" as const },
      { label: "Line charge", w: 0.13, align: "r" as const },
      { label: "Line pay", w: 0.13, align: "r" as const },
    ];
    const xAt = (i: number) => margin + cols.slice(0, i).reduce((s, c) => s + c.w * usableW, 0);
    const drawCell = (text: string, i: number, yy: number, f = font, color = ink) => {
      const c = cols[i];
      const cx = xAt(i);
      const cw = c.w * usableW;
      if (c.align === "r") {
        const tw = f.widthOfTextAtSize(text, 8);
        dt(text, { x: cx + cw - tw - 4, y: yy, size: 8, font: f, color });
      } else {
        const max = c.label === "Description" ? 30 : 12;
        dt(text.length > max ? text.slice(0, max - 1) + "…" : text, { x: cx + 4, y: yy, size: 8, font: f, color });
      }
    };
    const drawHead = () => {
      page.drawRectangle({ x: margin, y: y - 15, width: usableW, height: 17, color: rgb(0.06, 0.09, 0.16) });
      cols.forEach((c, i) => drawCell(c.label, i, y - 11, bold, rgb(1, 1, 1)));
      y -= 19;
    };
    drawHead();
    let totCharge = 0, totPay = 0;
    unitLines.forEach((l, ri) => {
      ensure(20);
      if (y < margin + 24) { drawHead(); }
      if (ri % 2 === 0) page.drawRectangle({ x: margin, y: y - 13, width: usableW, height: 15, color: rgb(0.96, 0.97, 0.98) });
      const payOnly = Number(l.price || 0) <= 0;
      drawCell(l.name + (payOnly ? " (pay-only)" : ""), 0, y - 10);
      drawCell(l.unit || "", 1, y - 10);
      drawCell(num(l.qty), 2, y - 10);
      drawCell(payOnly ? "—" : money(l.unitPrice), 3, y - 10);
      drawCell(money(l.unitCost), 4, y - 10, font, rgb(0.72, 0.45, 0.05));
      drawCell(payOnly ? "—" : money(l.price), 5, y - 10);
      drawCell(money(l.cost), 6, y - 10, bold, rgb(0.72, 0.45, 0.05));
      totCharge += Number(l.price || 0);
      totPay += Number(l.cost || 0);
      y -= 15;
    });
    // totals row
    ensure(20);
    page.drawRectangle({ x: margin, y: y - 14, width: usableW, height: 16, color: rgb(0.92, 0.95, 0.97) });
    drawCell("Totals", 0, y - 10, bold);
    drawCell(money(totCharge), 5, y - 10, bold);
    drawCell(money(totPay), 6, y - 10, bold, rgb(0.72, 0.45, 0.05));
    y -= 18;
  }

  // --- photos section: a real thumbnail grid (2 per row), not a wall of
  // links — absoluteUrl() fixes the relative-path bug that silently
  // prevented every photo from actually embedding before. ---
  if (photos && photos.length > 0) {
    ensure(40);
    sectionHeader("Field Photos");
    const cols2 = 2;
    const gap = 12;
    const cellW = (usableW - gap) / cols2;
    const cellH = 140;
    let col = 0;
    for (const ph of photos) {
      if (col === 0) ensure(cellH + 24);
      const cx = margin + col * (cellW + gap);
      try {
        const resp = await fetch(absoluteUrl(ph.url, baseUrl || ""));
        if (!resp.ok) throw new Error("fetch failed");
        const buf = Buffer.from(await resp.arrayBuffer());
        const ct = resp.headers.get("content-type") || "";
        const img = ct.includes("png") ? await doc.embedPng(buf) : await doc.embedJpg(buf);
        const scale = Math.min(cellW / img.width, cellH / img.height, 1);
        const w = img.width * scale, h = img.height * scale;
        page.drawRectangle({ x: cx, y: y - cellH, width: cellW, height: cellH, color: rgb(0.94, 0.95, 0.96) });
        page.drawImage(img, { x: cx + (cellW - w) / 2, y: y - cellH + (cellH - h) / 2, width: w, height: h });
      } catch {
        page.drawRectangle({ x: cx, y: y - cellH, width: cellW, height: cellH, color: rgb(0.94, 0.95, 0.96) });
        dt("Photo unavailable", { x: cx + 10, y: y - cellH / 2, size: 8, font, color: muted });
      }
      if (ph.caption) dt(ph.caption.slice(0, 60), { x: cx, y: y - cellH - 12, size: 7.5, font, color: muted });
      col++;
      if (col >= cols2) { col = 0; y -= cellH + 24; }
    }
    if (col !== 0) y -= cellH + 24;
  }

  // --- footer on every page: brand name + page count, so a printed or
  // re-shuffled multi-page report can still be identified and reordered. ---
  const allPages = doc.getPages();
  allPages.forEach((p, i) => {
    const footerY = 24;
    p.drawLine({ start: { x: margin, y: footerY + 10 }, end: { x: pageW - margin, y: footerY + 10 }, thickness: 0.5, color: rgb(0.88, 0.9, 0.93) });
    const left = [brand?.name, "Internal job report"].filter(Boolean).join(" · ");
    if (left) p.drawText(left, { x: margin, y: footerY, size: 7, font, color: muted });
    const pageLabel = `Page ${i + 1} of ${allPages.length}`;
    const pw = font.widthOfTextAtSize(pageLabel, 7);
    p.drawText(pageLabel, { x: pageW - margin - pw, y: footerY, size: 7, font, color: muted });
  });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

/* ------------------------- dataset definitions ---------------------- */

export const DATASET_COLUMNS: Record<string, { key: string; label: string; kind?: string }[]> = {
  "work-orders": [
    { key: "id", label: "ID", kind: "id" }, { key: "title", label: "Title" }, { key: "service", label: "Service" },
    { key: "client", label: "Client" }, { key: "clientPhone", label: "Phone" }, { key: "technician", label: "Technician" },
    { key: "status", label: "Status" }, { key: "priority", label: "Priority" }, { key: "address", label: "Address" },
    { key: "scheduledAt", label: "Scheduled", kind: "date" }, { key: "price", label: "Price", kind: "money" },
    { key: "paymentStatus", label: "Payment" }, { key: "createdAt", label: "Created", kind: "date" },
  ],
  technicians: [
    { key: "id", label: "ID", kind: "id" }, { key: "name", label: "Name" }, { key: "email", label: "Email" },
    { key: "phone", label: "Phone" }, { key: "vehicle", label: "Vehicle" }, { key: "skillClass", label: "Class" },
    { key: "skills", label: "Skills" }, { key: "status", label: "Status" }, { key: "rating", label: "Rating", kind: "num" },
    { key: "completedJobs", label: "Jobs", kind: "num" },
  ],
  clients: [
    { key: "id", label: "ID", kind: "id" }, { key: "name", label: "Name" }, { key: "email", label: "Email" },
    { key: "phone", label: "Phone" }, { key: "createdAt", label: "Created", kind: "date" },
  ],
  invoices: [
    { key: "number", label: "Invoice" }, { key: "amount", label: "Amount", kind: "money" }, { key: "tax", label: "Tax", kind: "money" },
    { key: "total", label: "Total", kind: "money" }, { key: "status", label: "Status" }, { key: "method", label: "Method" },
    { key: "paidAt", label: "Paid", kind: "date" }, { key: "createdAt", label: "Created", kind: "date" },
  ],
};

export async function loadDataset(dataset: string, t: TenantDb): Promise<Record<string, any>[]> {
  const cid = t.companyId;
  if (dataset === "work-orders") {
    const bs = await t.select(schema.bookings);
    return Promise.all(bs.map(async (b) => {
      const svc = await t.selectOne(schema.services, eq(schema.services.id, b.serviceId));
      const [cu] = await sdb.select().from(schema.user).where(eq(schema.user.id, b.customerId));
      let tech = "";
      if (b.riderId) {
        const r = await t.selectOne(schema.riders, eq(schema.riders.id, b.riderId));
        if (r) { const [ru] = await sdb.select().from(schema.user).where(eq(schema.user.id, r.userId)); tech = ru?.name ?? ""; }
      }
      return {
        id: b.id, title: b.title, service: svc?.name ?? "", client: cu?.name ?? "", clientPhone: b.customerPhone,
        technician: tech, status: b.status, priority: b.priority, address: b.address,
        scheduledAt: b.scheduledAt, price: b.total || b.price, paymentStatus: b.paymentStatus, createdAt: b.createdAt,
      };
    }));
  }
  if (dataset === "technicians") {
    const ts = await t.select(schema.riders);
    return Promise.all(ts.map(async (tr) => {
      const [ru] = await sdb.select().from(schema.user).where(eq(schema.user.id, tr.userId));
      return { id: tr.id, name: ru?.name ?? "", email: ru?.email ?? "", phone: tr.phone || ru?.phone || "", vehicle: tr.vehicle, skillClass: tr.skillClass, skills: tr.skills, status: tr.status, rating: tr.rating, completedJobs: tr.completedJobs };
    }));
  }
  if (dataset === "clients") {
    const us = (await usersForCompany(cid)).filter((u) => u.role === "customer");
    return us.map((u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, createdAt: u.createdAt }));
  }
  if (dataset === "invoices") {
    const inv = await t.select(schema.invoices);
    return inv.map((i) => ({ number: i.number, amount: i.amount, tax: i.tax, total: i.total, status: i.status, method: i.method, paidAt: i.paidAt, createdAt: i.createdAt }));
  }
  return [];
}

export function fileResponse(buf: Buffer | string, name: string, mime: string) {
  // Buffer is a valid BodyInit at runtime; TS 5.7's generic Uint8Array isn't in
  // the DOM BodyInit union.
  return new Response(buf as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}

/** Tenant logo + name + brand color for a PDF header — same shape and same
 *  source table job-search.ts already reads for the single-job PDF. Every
 *  export (bulk table or single job) should carry the tenant's own
 *  branding, not a generic unbranded page. */
async function loadTenantBrand(companyId: string): Promise<JobBrand | null> {
  const row = await tdb(companyId).selectOne(schema.companySettings).catch(() => undefined);
  return row ? { name: row.name, logo: row.logo, brandColor: row.brandColor } : null;
}

export const exportRoutes = new Hono<AppEnv>()
  // generic report export: client posts the already-computed report rows/columns.
  // POST /api/export/report?format=csv|xlsx|pdf  body: { title, subtitle, rows, columns }
  .post("/report", requireAuth, async (c) => {
    const format = (c.req.query("format") || "csv").toLowerCase();
    const body = await c.req.json<{ title: string; subtitle?: string; rows: any[]; columns: any[] }>();
    const { title, subtitle, rows, columns } = body;
    const slug = (title || "report").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const stamp = Date.now();
    const pre = await tenantFilePrefix(tenantId(c));
    if (format === "xlsx") {
      const buf = await toXlsx(rows, columns, title || "Report", title);
      return fileResponse(buf, `${pre}-${slug}-${stamp}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    }
    if (format === "pdf") {
      const brand = await loadTenantBrand(tenantId(c));
      const baseUrl = new URL(c.req.url).origin;
      const buf = await toPdf(rows, columns, title || "Report", subtitle, await companyTimeZone(tenantId(c)), brand, baseUrl);
      return fileResponse(buf, `${pre}-${slug}-${stamp}.pdf`, "application/pdf");
    }
    const csv = toCsv(rows, columns.map((c: any) => c.key));
    return fileResponse(csv, `${pre}-${slug}-${stamp}.csv`, "text/csv; charset=utf-8");
  })
  // GET /api/export/:dataset?columns=a,b,c&format=csv|xlsx|pdf
  .get("/:dataset", requireAuth, async (c) => {
    const dataset = c.req.param("dataset");
    if (!DATASET_COLUMNS[dataset]) return c.json({ message: "Unknown dataset" }, 400);
    const format = (c.req.query("format") || "csv").toLowerCase();
    const colsParam = c.req.query("columns");
    const picked = colsParam ? colsParam.split(",").map((s) => s.trim()) : undefined;

    const allCols = DATASET_COLUMNS[dataset];
    const cols = picked ? allCols.filter((c) => picked.includes(c.key)) : allCols;
    const rows = await loadDataset(dataset, tdb(tenantId(c)));
    const stamp = Date.now();
    const pre = await tenantFilePrefix(tenantId(c));
    const title = dataset.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

    if (format === "xlsx") {
      const buf = await toXlsx(rows, cols, title, title);
      return fileResponse(buf, `${pre}-${dataset}-${stamp}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    }
    if (format === "pdf") {
      const brand = await loadTenantBrand(tenantId(c));
      const baseUrl = new URL(c.req.url).origin;
      const buf = await toPdf(rows, cols, title, undefined, await companyTimeZone(tenantId(c)), brand, baseUrl);
      return fileResponse(buf, `${pre}-${dataset}-${stamp}.pdf`, "application/pdf");
    }
    const csv = toCsv(rows, cols.map((c) => c.key));
    return fileResponse(csv, `${pre}-${dataset}-${stamp}.csv`, "text/csv; charset=utf-8");
  })
  // schema preview so the UI can let users pick columns
  .get("/:dataset/columns", requireAuth, async (c) => {
    const ds = DATASET_COLUMNS[c.req.param("dataset")];
    return c.json({ columns: ds ? ds.map((c) => c.key) : [] }, 200);
  });
