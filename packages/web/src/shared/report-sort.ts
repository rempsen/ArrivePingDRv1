/**
 * Column sorting for the Reports detail table (and therefore its exports,
 * which send the rows in the order on screen). Numbers sort numerically,
 * dates by time, text naturally ("Zone 2" before "Zone 10"), and empty
 * values always last whatever the direction.
 */

export type SortDir = "asc" | "desc";
export type ReportColumn = { key: string; label: string; kind?: string };

const NUMERIC = new Set(["money", "num", "pct"]);

/** The direction a first click on a column sorts in: biggest first for numbers and dates, A→Z for text. */
export function firstSortDir(kind?: string): SortDir {
  return kind && (NUMERIC.has(kind) || kind === "date") ? "desc" : "asc";
}

function comparable(v: unknown, kind?: string): number | string | null {
  if (v === null || v === undefined || v === "") return null;
  if (kind && NUMERIC.has(kind)) {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (kind === "date") {
    const t = new Date(v as string | number).getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof v === "number") return v;
  return String(v);
}

/** A sorted copy of `rows`; the original order is kept for ties. */
export function sortReportRows<T extends Record<string, unknown>>(rows: T[], column: ReportColumn, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i, v: comparable(row[column.key], column.kind) }))
    .sort((a, b) => {
      if (a.v === null || b.v === null) return a.v === b.v ? a.i - b.i : a.v === null ? 1 : -1;
      const c =
        typeof a.v === "number" && typeof b.v === "number"
          ? a.v - b.v
          : String(a.v).localeCompare(String(b.v), undefined, { numeric: true, sensitivity: "base" });
      return c === 0 ? a.i - b.i : c * sign;
    })
    .map((x) => x.row);
}
