/**
 * Directory query: filter, sort, group and page the people in a company.
 *
 * Pure on purpose. The server loads one row per person (services/directory.ts)
 * and runs the query here, so the Directory page, its exports and the AI
 * search all agree on what "residents at Maple Court, sorted by unit" means.
 * At a few thousand people (a property manager with 2,500 residents) this is
 * a few milliseconds of work, and it keeps the rules testable without a
 * database.
 */

/** Which people a query covers. Office = admins, managers, dispatchers, project managers. */
export type DirectoryKind = "all" | "customer" | "field" | "office";
export type DirectorySort =
  | "name"
  | "property"
  | "unit"
  | "manager"
  | "email"
  | "phone"
  | "role"
  | "joined"
  | "openJobs"
  | "lastVisit";
export type DirectoryGroup = "none" | "property" | "manager" | "role";
export type SortDir = "asc" | "desc";

export const DIRECTORY_SORTS: readonly DirectorySort[] = ["name", "property", "unit", "manager", "email", "phone", "role", "joined", "openJobs", "lastVisit"];
export const DIRECTORY_GROUPS: readonly DirectoryGroup[] = ["none", "property", "manager", "role"];
export const DIRECTORY_KINDS: readonly DirectoryKind[] = ["all", "customer", "field", "office"];
export const PAGE_SIZES = [25, 50, 100] as const;

const OFFICE_ROLES = new Set(["superadmin", "admin", "manager", "dispatcher", "project_manager"]);

/** The kind of person a membership role is. */
export function kindOfRole(role: string | null | undefined): Exclude<DirectoryKind, "all"> {
  if (role === "rider") return "field";
  if (OFFICE_ROLES.has(role ?? "")) return "office";
  return "customer";
}

export interface DirectoryRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  /** Membership role at this company. */
  role: string;
  kind: Exclude<DirectoryKind, "all">;
  /** Membership status here: active | invited | disabled. */
  status: string;
  isSample: boolean;
  /** Customers: the named property they belong to here. */
  propertyId: string | null;
  propertyName: string;
  propertyAddress: string;
  unit: string;
  /** Customers: the staff member who manages their property. */
  managerId: string | null;
  managerName: string;
  /** Staff: how many named properties they manage. */
  managedCount: number;
  address: string;
  city: string;
  company: string;
  createdAt: string | null;
  /** Customers: work orders not yet completed or cancelled. */
  openJobs: number;
  /** Customers: when the most recent completed work order finished. */
  lastVisitAt: string | null;
}

export interface DirectoryQuery {
  kind?: DirectoryKind;
  /** Keyword search across name, email, phone, property, unit, manager and address. */
  q?: string;
  /** A property id, or "none" for people with no property. */
  propertyId?: string;
  /** A manager's user id (the customers whose property they manage), or "none". */
  managerId?: string;
  /** Narrow to these people (the AI search resolves a question to ids). */
  ids?: string[];
  sort?: DirectorySort;
  dir?: SortDir;
  groupBy?: DirectoryGroup;
  page?: number;
  pageSize?: number;
  /** Also return every matching id, in order (for "select all 2,500"). */
  withIds?: boolean;
  /** The tenant's words for places in group headers and pickers (shared/directory-vocab.ts). */
  labels?: DirectoryLabels;
}

/** Group-header and picker words, in the tenant's vocabulary. */
export interface DirectoryLabels {
  place: string;
  places: string;
  manager: string;
}
const DEFAULT_LABELS: DirectoryLabels = { place: "Property", places: "Properties", manager: "Manager" };

/** Sorts that only mean something where the Directory has places. */
export const PLACE_SORTS: ReadonlySet<DirectorySort> = new Set<DirectorySort>(["property", "unit", "manager"]);

/**
 * A Directory without places (shared/directory-vocab.ts) ignores place-only
 * sorting, grouping and filters, wherever they came from: a view saved while
 * signed in to another company, or an old link.
 */
export function withoutPlaces(query: DirectoryQuery): DirectoryQuery {
  return {
    ...query,
    sort: query.sort && PLACE_SORTS.has(query.sort) ? "name" : query.sort,
    groupBy: query.groupBy === "property" || query.groupBy === "manager" ? "none" : query.groupBy,
    propertyId: undefined,
    managerId: undefined,
  };
}

/** The most ids one query returns for a select-all. */
export const MAX_IDS = 5000;

export interface DirectoryGroupInfo {
  key: string;
  label: string;
  /** Property groups: address and manager; manager groups: properties managed. */
  sublabel: string;
  count: number;
}

export interface DirectoryFacets {
  kinds: Record<DirectoryKind, number>;
  properties: { id: string; name: string; count: number }[];
  managers: { id: string; name: string; count: number }[];
}

export interface DirectoryResult {
  rows: DirectoryRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  sort: DirectorySort;
  dir: SortDir;
  groupBy: DirectoryGroup;
  groups: DirectoryGroupInfo[];
  facets: DirectoryFacets;
  /** Every matching person, in order, when the query asked `withIds`. */
  ids?: string[];
}

export const NONE = "none";
const noPlace = (l: DirectoryLabels) => `No ${l.place.toLowerCase()}`;
const noManager = (l: DirectoryLabels) => `No ${l.manager.toLowerCase()}`;

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
const digits = (s: string) => s.replace(/\D/g, "");

/** Every word in the search has to match something about the person. */
export function matchesSearch(r: DirectoryRow, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [r.name, r.email, r.propertyName, r.propertyAddress, r.unit, r.managerName, r.address, r.city, r.company]
    .join(" \u0001 ")
    .toLowerCase();
  const phone = digits(r.phone);
  return words.every((w) => {
    if (hay.includes(w)) return true;
    const d = digits(w);
    // "555-0121" or "0121" should find the phone number however it's written.
    return d.length >= 3 && d.length === w.replace(/[\s().+-]/g, "").length && phone.includes(d);
  });
}

function sortValue(r: DirectoryRow, sort: DirectorySort): string | number | null {
  switch (sort) {
    case "name":
      return r.name || null;
    case "property":
      return r.propertyName || null;
    case "unit":
      return r.unit || null;
    case "manager":
      return r.managerName || null;
    case "email":
      return r.email || null;
    case "phone":
      return digits(r.phone) || null;
    case "role":
      return r.role || null;
    case "joined":
      return r.createdAt ? Date.parse(r.createdAt) : null;
    case "openJobs":
      return r.openJobs;
    case "lastVisit":
      return r.lastVisitAt ? Date.parse(r.lastVisitAt) : null;
  }
}

function compareValues(a: string | number | null, b: string | number | null): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return collator.compare(String(a), String(b));
}

/** A comparator for one sort key. Blanks always sort last, whichever way you sort. */
export function rowComparator(sort: DirectorySort, dir: SortDir): (a: DirectoryRow, b: DirectoryRow) => number {
  const sign = dir === "desc" ? -1 : 1;
  return (a, b) => {
    const va = sortValue(a, sort);
    const vb = sortValue(b, sort);
    if (va === null && vb !== null) return 1;
    if (vb === null && va !== null) return -1;
    if (va !== null && vb !== null) {
      const c = compareValues(va, vb);
      if (c !== 0) return c * sign;
    }
    // Stable, predictable ties: by name, then by unit (residents of one building), then id.
    return collator.compare(a.name, b.name) || collator.compare(a.unit, b.unit) || a.id.localeCompare(b.id);
  };
}

function groupKey(r: DirectoryRow, g: DirectoryGroup, l: DirectoryLabels = DEFAULT_LABELS): { key: string; label: string } {
  switch (g) {
    case "property":
      return r.propertyId ? { key: r.propertyId, label: r.propertyName } : { key: NONE, label: noPlace(l) };
    case "manager":
      return r.managerId ? { key: r.managerId, label: r.managerName } : { key: NONE, label: noManager(l) };
    case "role":
      return { key: r.role || NONE, label: r.role || "No role" };
    default:
      return { key: "", label: "" };
  }
}

/** The group a row falls in for a grouping, so the page can draw section headers. */
export function rowGroupKey(r: DirectoryRow, g: DirectoryGroup): string {
  return groupKey(r, g).key;
}

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

/** Run a query over everyone in a company. */
export function applyDirectoryQuery(all: DirectoryRow[], query: DirectoryQuery = {}): DirectoryResult {
  const kind: DirectoryKind = DIRECTORY_KINDS.includes(query.kind as DirectoryKind) ? (query.kind as DirectoryKind) : "all";
  const sort: DirectorySort = DIRECTORY_SORTS.includes(query.sort as DirectorySort) ? (query.sort as DirectorySort) : "name";
  const dir: SortDir = query.dir === "desc" ? "desc" : "asc";
  const groupBy: DirectoryGroup = DIRECTORY_GROUPS.includes(query.groupBy as DirectoryGroup) ? (query.groupBy as DirectoryGroup) : "none";
  const pageSize = clampInt(query.pageSize, 1, 500, 25);
  const q = (query.q ?? "").trim();
  const idSet = query.ids ? new Set(query.ids) : null;
  const labels = query.labels ?? DEFAULT_LABELS;

  // Search (and the AI's id list) first: the kind tabs show counts within it.
  const searched = all.filter((r) => (!idSet || idSet.has(r.id)) && (!q || matchesSearch(r, q)));
  const kinds: Record<DirectoryKind, number> = { all: searched.length, customer: 0, field: 0, office: 0 };
  for (const r of searched) kinds[r.kind]++;

  const ofKind = kind === "all" ? searched : searched.filter((r) => r.kind === kind);

  // Facets: the property and manager pickers list what's in this tab and search.
  const propCounts = new Map<string, { id: string; name: string; count: number }>();
  const mgrCounts = new Map<string, { id: string; name: string; count: number }>();
  for (const r of ofKind) {
    if (r.kind !== "customer") continue;
    const pk = r.propertyId ?? NONE;
    const p = propCounts.get(pk) ?? { id: pk, name: r.propertyId ? r.propertyName : noPlace(labels), count: 0 };
    p.count++;
    propCounts.set(pk, p);
    const mk = r.managerId ?? NONE;
    const m = mgrCounts.get(mk) ?? { id: mk, name: r.managerId ? r.managerName : noManager(labels), count: 0 };
    m.count++;
    mgrCounts.set(mk, m);
  }
  const byName = (a: { id: string; name: string }, b: { id: string; name: string }) =>
    a.id === NONE ? 1 : b.id === NONE ? -1 : collator.compare(a.name, b.name);

  let rows = ofKind;
  if (query.propertyId) {
    rows = query.propertyId === NONE ? rows.filter((r) => r.kind === "customer" && !r.propertyId) : rows.filter((r) => r.propertyId === query.propertyId);
  }
  if (query.managerId) {
    rows =
      query.managerId === NONE
        ? rows.filter((r) => r.kind === "customer" && !r.managerId)
        : rows.filter((r) => r.managerId === query.managerId);
  }

  const cmp = rowComparator(sort, dir);
  let sorted: DirectoryRow[];
  const groupMap = new Map<string, DirectoryGroupInfo>();
  if (groupBy === "none") {
    sorted = [...rows].sort(cmp);
  } else {
    for (const r of rows) {
      const { key, label } = groupKey(r, groupBy, labels);
      const g = groupMap.get(key) ?? { key, label, sublabel: "", count: 0 };
      g.count++;
      if (!g.sublabel) {
        if (groupBy === "property" && r.propertyId) g.sublabel = [r.propertyAddress, r.managerName && `${labels.manager}: ${r.managerName}`].filter(Boolean).join(" · ");
      }
      groupMap.set(key, g);
    }
    // Groups A–Z with the "No property / No manager" bucket last; rows sorted within each.
    const groupOrder = [...groupMap.values()].sort((a, b) => (a.key === NONE ? 1 : b.key === NONE ? -1 : collator.compare(a.label, b.label) || a.key.localeCompare(b.key)));
    const rank = new Map(groupOrder.map((g, i) => [g.key, i]));
    sorted = [...rows].sort((a, b) => rank.get(groupKey(a, groupBy).key)! - rank.get(groupKey(b, groupBy).key)! || cmp(a, b));
    groupMap.clear();
    for (const g of groupOrder) groupMap.set(g.key, g);
  }
  if (groupBy === "manager") {
    // A manager group's sublabel: how many properties of theirs are in it.
    const props = new Map<string, Set<string>>();
    for (const r of rows) if (r.managerId && r.propertyId) (props.get(r.managerId) ?? props.set(r.managerId, new Set()).get(r.managerId)!).add(r.propertyId);
    for (const [k, set] of props) {
      const g = groupMap.get(k);
      if (g) g.sublabel = `${set.size} ${(set.size === 1 ? labels.place : labels.places).toLowerCase()}`;
    }
  }

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = clampInt(query.page, 1, totalPages, 1);
  const start = (page - 1) * pageSize;

  return {
    rows: sorted.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    totalPages,
    sort,
    dir,
    groupBy,
    groups: [...groupMap.values()],
    facets: {
      kinds,
      properties: [...propCounts.values()].sort(byName),
      managers: [...mgrCounts.values()].sort(byName),
    },
    ...(query.withIds ? { ids: sorted.slice(0, MAX_IDS).map((r) => r.id) } : {}),
  };
}
