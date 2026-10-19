/**
 * The Directory: everyone in a company, with the named properties customers
 * belong to and the staff who manage those properties.
 *
 * Model (Dan, 2026-10-18): a property manager with 2,500 residents needs them
 * organised by property, by resident and by the property manager responsible
 * for each property, not one flat list.
 *   - A NAMED property is a `properties` row with a name ("Maple Court"), an
 *     optional address and an optional manager: any staff member of the
 *     company, field or office.
 *   - A customer belongs to at most one named property at a company, with a
 *     unit, on their membership row (memberships.propertyId / unit), because
 *     the same person can be a resident here and an ordinary customer of
 *     another company.
 *   - A customer's manager is their property's manager.
 *
 * Job-created address rows (services/properties.ts resolveProperty) have no
 * name and never appear here. Creating a named property at an address a job
 * already created adopts that row, so the building keeps its service history.
 *
 * Every read and write goes through tdb(companyId): tenant-scoped, RLS on.
 */
import { and, count, eq, inArray, isNull, max, ne, sql } from "drizzle-orm";
import * as schema from "../api/database/schema";
import { tdb } from "../api/database/tenant";
import { normalizeAddress } from "./properties";
import { OPEN_STATUSES } from "../shared/job-status";
import { kindOfRole, type DirectoryLabels, type DirectoryRow } from "../shared/directory-query";
import { db } from "../api/database";
import { resolveDirectoryVocab, type DirectoryVocab } from "../shared/directory-vocab";
import { importProfile, type ImportNouns, type ImportProfile } from "../shared/import-profile";
import { getIndustryPreset } from "./industry-presets";

/** The tenant's words used in this file's messages (lower-case, mid-sentence). */
export interface PlaceWords {
  place: string;
  manager: string;
  customers: string;
}
const WORDS: PlaceWords = { place: "property", manager: "manager", customers: "customers" };

/**
 * The Directory's place vocabulary for a company: its industry, its own words
 * for the people it serves, its Settings choice, and whether it has places.
 */
export async function directoryVocabFor(
  companyId: string,
  hasPlaces?: boolean,
): Promise<{ vocab: DirectoryVocab; words: PlaceWords; labels: DirectoryLabels; nouns: ImportNouns; profile: ImportProfile }> {
  const [co] = await db.select({ industry: schema.companies.industry }).from(schema.companies).where(eq(schema.companies.id, companyId));
  const t = tdb(companyId);
  const s = await t.selectOne(schema.companySettings);
  const has = hasPlaces ?? !!(await t.selectOne(schema.properties, ne(schema.properties.name, "")));
  const preset = getIndustryPreset(co?.industry);
  const vocab = resolveDirectoryVocab({
    industryPlaces: preset?.places,
    customerNoun: s?.customerNoun,
    workerNoun: s?.workerNoun,
    mode: s?.directoryPlaces,
    hasPlaces: has,
  });
  const word = (v: string | null | undefined, d: string) => (v && v.trim() ? v.trim() : d);
  const nouns: ImportNouns = {
    customer: word(s?.customerNoun, "Customer"),
    customers: word(s?.customerNounPlural, "Customers"),
    worker: word(s?.workerNoun, "Technician"),
    workers: word(s?.workerNounPlural, "Technicians"),
  };
  // The industry's own service categories make a better Skills example than "General".
  const categories = [...new Set((preset?.services ?? []).map((x) => x.category))].slice(0, 2);
  return {
    vocab,
    words: { place: vocab.place.toLowerCase(), manager: vocab.manager.toLowerCase(), customers: nouns.customers.toLowerCase() },
    labels: { place: vocab.place, places: vocab.places, manager: vocab.manager },
    nouns,
    profile: importProfile({ vocab, nouns, staffFields: preset?.staffFields, skillsExample: categories.join(", ") || undefined }),
  };
}

export class DirectoryError extends Error {
  constructor(
    public status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "DirectoryError";
  }
}

export interface PropertyItem {
  id: string;
  name: string;
  address: string;
  notes: string;
  managerId: string | null;
  managerName: string;
  residents: number;
  openJobs: number;
  createdAt: string | null;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Membership rows of staff (anyone who isn't a customer) — who can manage a property. */
function isStaffRole(role: string | null | undefined) {
  return kindOfRole(role) !== "customer";
}

/** Everything the Directory needs for one company, as rows plus the named properties. */
export async function loadDirectory(companyId: string): Promise<{ rows: DirectoryRow[]; properties: PropertyItem[] }> {
  const t = tdb(companyId);
  const [members, users, props, jobStats] = await Promise.all([
    t.select(schema.memberships),
    // Scoped `user` reads return home-company OR member rows (tenant.ts).
    t.select(schema.user),
    t.select(schema.properties, ne(schema.properties.name, "")),
    // Per customer AND the property each job is linked to, so a property's
    // open requests can follow the job (see openByProperty below).
    t.transaction((tx) =>
      tx
        .select({
          customerId: schema.bookings.customerId,
          propertyId: schema.bookings.propertyId,
          open: sql<number>`count(*) filter (where ${inArray(schema.bookings.status, [...OPEN_STATUSES])})`.mapWith(Number),
          lastVisit: max(sql`case when ${schema.bookings.status} = 'completed' then coalesce(${schema.bookings.finishedAt}, ${schema.bookings.scheduledAt}) end`),
        })
        .from(schema.bookings)
        .where(t.scope(schema.bookings, isNull(schema.bookings.deletedAt)))
        .groupBy(schema.bookings.customerId, schema.bookings.propertyId),
    ),
  ]);

  const userById = new Map(users.map((u) => [u.id, u]));
  const memberByUser = new Map(members.map((m) => [m.userId, m]));
  const propById = new Map(props.map((p) => [p.id, p]));
  const statsByCustomer = new Map<string, { open: number; lastVisit: number | null }>();
  for (const s of jobStats) {
    const cur = statsByCustomer.get(s.customerId) ?? { open: 0, lastVisit: null };
    cur.open += s.open;
    const lv = s.lastVisit ? new Date(s.lastVisit as unknown as string | Date).getTime() : null;
    if (lv !== null && (cur.lastVisit === null || lv > cur.lastVisit)) cur.lastVisit = lv;
    statsByCustomer.set(s.customerId, cur);
  }

  const managerName = (id: string | null | undefined) => {
    if (!id || !memberByUser.has(id)) return "";
    return userById.get(id)?.name ?? "";
  };

  const managedCount = new Map<string, number>();
  const residentCount = new Map<string, number>();
  // A property's open requests: jobs linked to it, plus its residents' jobs
  // linked to no named property (a job at "120 Maple St #4B" is a unit-level
  // address row). A job at another named property counts there instead.
  const openByProperty = new Map<string, number>();
  for (const s of jobStats) {
    if (!s.open) continue;
    const linked = s.propertyId && propById.has(s.propertyId) ? s.propertyId : null;
    const home = memberByUser.get(s.customerId);
    const target = linked ?? (home && kindOfRole(home.role) === "customer" && home.propertyId && propById.has(home.propertyId) ? home.propertyId : null);
    if (target) openByProperty.set(target, (openByProperty.get(target) ?? 0) + s.open);
  }

  const rows: DirectoryRow[] = [];
  for (const m of members) {
    const u = userById.get(m.userId);
    if (!u) continue;
    const kind = kindOfRole(m.role);
    const prop = kind === "customer" && m.propertyId ? propById.get(m.propertyId) : undefined;
    const stats = statsByCustomer.get(u.id);
    const mgrId = prop?.managerId && memberByUser.has(prop.managerId) ? prop.managerId : null;
    if (prop) residentCount.set(prop.id, (residentCount.get(prop.id) ?? 0) + 1);
    rows.push({
      id: u.id,
      name: u.name ?? "",
      email: u.email ?? "",
      phone: u.phone ?? "",
      role: m.role ?? u.role ?? "customer",
      kind,
      status: m.status,
      isSample: !!u.isSample,
      propertyId: prop?.id ?? null,
      propertyName: prop?.name ?? "",
      propertyAddress: prop?.addressDisplay ?? "",
      unit: kind === "customer" ? (m.unit ?? "") : "",
      managerId: mgrId,
      managerName: mgrId ? managerName(mgrId) : "",
      managedCount: 0,
      address: u.address ?? "",
      city: u.city ?? "",
      company: u.company ?? "",
      createdAt: iso(u.createdAt),
      openJobs: kind === "customer" ? (stats?.open ?? 0) : 0,
      lastVisitAt: kind === "customer" && stats?.lastVisit != null ? new Date(stats.lastVisit).toISOString() : null,
    });
  }
  for (const p of props) if (p.managerId) managedCount.set(p.managerId, (managedCount.get(p.managerId) ?? 0) + 1);
  for (const r of rows) if (r.kind !== "customer") r.managedCount = managedCount.get(r.id) ?? 0;

  const properties: PropertyItem[] = props.map((p) => {
    const mgr = p.managerId && memberByUser.has(p.managerId) ? p.managerId : null;
    return {
      id: p.id,
      name: p.name,
      address: p.addressDisplay,
      notes: p.notes,
      managerId: mgr,
      managerName: managerName(mgr),
      residents: residentCount.get(p.id) ?? 0,
      openJobs: openByProperty.get(p.id) ?? 0,
      createdAt: iso(p.createdAt),
    };
  });
  return { rows, properties };
}

/** The manager must be staff at this company (any role but customer), or null. */
async function checkManager(companyId: string, managerId: string | null | undefined, w: PlaceWords = WORDS): Promise<string | null> {
  if (!managerId) return null;
  const m = await tdb(companyId).selectOne(schema.memberships, eq(schema.memberships.userId, managerId));
  if (!m || !isStaffRole(m.role)) throw new DirectoryError(400, `The ${w.manager} has to be a member of your team.`);
  return managerId;
}

async function namedPropertyByName(companyId: string, name: string, exceptId?: string) {
  const rows = await tdb(companyId).select(schema.properties, sql`lower(${schema.properties.name}) = ${name.toLowerCase()}`);
  return rows.find((r) => r.id !== exceptId);
}

export async function createProperty(
  companyId: string,
  input: { name: string; address?: string; notes?: string; managerId?: string | null },
  w: PlaceWords = WORDS,
): Promise<{ id: string; adopted: boolean }> {
  const name = input.name.trim();
  if (!name) throw new DirectoryError(400, `A ${w.place} needs a name.`);
  if (await namedPropertyByName(companyId, name)) throw new DirectoryError(409, `There's already a ${w.place} called "${name}".`);
  const managerId = await checkManager(companyId, input.managerId, w);
  const t = tdb(companyId);
  const address = (input.address ?? "").trim();
  const addressNormalized = normalizeAddress(address);
  // A job may already have recorded this address: adopt it, so the building
  // keeps its service history. A named one at the same address is a clash.
  if (addressNormalized.length >= 4) {
    const existing = await t.selectOne(schema.properties, eq(schema.properties.addressNormalized, addressNormalized));
    if (existing) {
      if (existing.name) throw new DirectoryError(409, `"${existing.name}" is already at that address.`);
      await t.update(
        schema.properties,
        { name, managerId, notes: input.notes?.trim() || existing.notes, addressDisplay: address || existing.addressDisplay, updatedAt: new Date() },
        eq(schema.properties.id, existing.id),
      );
      return { id: existing.id, adopted: true };
    }
  }
  const [row] = await t.insert(schema.properties, {
    name,
    managerId,
    addressDisplay: address,
    addressNormalized,
    notes: input.notes?.trim() ?? "",
  });
  return { id: row!.id, adopted: false };
}

export async function updateProperty(
  companyId: string,
  id: string,
  patch: { name?: string; address?: string; notes?: string; managerId?: string | null },
  w: PlaceWords = WORDS,
): Promise<void> {
  const t = tdb(companyId);
  const prop = await t.selectOne(schema.properties, eq(schema.properties.id, id));
  if (!prop || !prop.name) throw new DirectoryError(404, `That ${w.place} wasn't found.`);
  const set: Partial<typeof schema.properties.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new DirectoryError(400, `A ${w.place} needs a name.`);
    if (await namedPropertyByName(companyId, name, id)) throw new DirectoryError(409, `There's already a ${w.place} called "${name}".`);
    set.name = name;
  }
  if (patch.address !== undefined) {
    const address = patch.address.trim();
    const normalized = normalizeAddress(address);
    if (normalized.length >= 4 && normalized !== prop.addressNormalized) {
      const clash = await t.selectOne(schema.properties, and(eq(schema.properties.addressNormalized, normalized), ne(schema.properties.id, id)));
      if (clash?.name) throw new DirectoryError(409, `"${clash.name}" is already at that address.`);
    }
    set.addressDisplay = address;
    set.addressNormalized = normalized;
  }
  if (patch.notes !== undefined) set.notes = patch.notes.trim();
  if (patch.managerId !== undefined) set.managerId = await checkManager(companyId, patch.managerId, w);
  await t.update(schema.properties, set, eq(schema.properties.id, id));
}

/**
 * Remove a property from the Directory. Its residents become unassigned; the
 * row itself stays (without a name) when jobs point at it, so the address's
 * service history isn't lost.
 */
export async function deleteProperty(companyId: string, id: string, w: PlaceWords = WORDS): Promise<{ unassigned: number }> {
  const t = tdb(companyId);
  const prop = await t.selectOne(schema.properties, eq(schema.properties.id, id));
  if (!prop || !prop.name) throw new DirectoryError(404, `That ${w.place} wasn't found.`);
  const unlinked = await t.update(schema.memberships, { propertyId: null, unit: "", updatedAt: new Date() }, eq(schema.memberships.propertyId, id));
  const [jobs] = await t.transaction((tx) =>
    tx.select({ n: count() }).from(schema.bookings).where(t.scope(schema.bookings, eq(schema.bookings.propertyId, id))),
  );
  if ((jobs?.n ?? 0) > 0) await t.update(schema.properties, { name: "", managerId: null, updatedAt: new Date() }, eq(schema.properties.id, id));
  else await t.delete(schema.properties, eq(schema.properties.id, id));
  return { unassigned: unlinked.length };
}

/**
 * Put customers at a property (or take them off one). Only customers can
 * belong to a property; staff ids in the list are refused, not skipped, so a
 * bulk action never half-applies without saying so.
 */
export async function assignToProperty(
  companyId: string,
  input: { userIds: string[]; propertyId: string | null; unit?: string },
  w: PlaceWords = WORDS,
): Promise<{ updated: number }> {
  const ids = [...new Set(input.userIds)];
  if (!ids.length) throw new DirectoryError(400, "Choose at least one person.");
  const t = tdb(companyId);
  if (input.propertyId) {
    const prop = await t.selectOne(schema.properties, eq(schema.properties.id, input.propertyId));
    if (!prop || !prop.name) throw new DirectoryError(404, `That ${w.place} wasn't found.`);
  }
  const members = await t.select(schema.memberships, inArray(schema.memberships.userId, ids));
  if (members.length !== ids.length) throw new DirectoryError(404, "Some of those people aren't in your directory.");
  const staff = members.filter((m) => kindOfRole(m.role) !== "customer");
  if (staff.length)
    throw new DirectoryError(400, `Only ${w.customers} can belong to a ${w.place}. Make a team member the ${w.place}'s ${w.manager} instead.`);
  const set: Partial<typeof schema.memberships.$inferInsert> = { propertyId: input.propertyId, updatedAt: new Date() };
  // A unit only makes sense for one person; a bulk move keeps each person's unit.
  if (input.unit !== undefined) set.unit = input.propertyId ? input.unit.trim() : "";
  else if (!input.propertyId) set.unit = "";
  const updated = await t.update(schema.memberships, set, inArray(schema.memberships.userId, ids));
  return { updated: updated.length };
}

/** Find a named property by name (case-insensitive), creating it when asked. Used by import. */
export async function propertyIdForName(companyId: string, name: string, create: boolean, w: PlaceWords = WORDS): Promise<string | null> {
  const clean = name.trim();
  if (!clean) return null;
  const found = await namedPropertyByName(companyId, clean);
  if (found) return found.id;
  if (!create) return null;
  try {
    return (await createProperty(companyId, { name: clean }, w)).id;
  } catch (e) {
    // Lost a race with another row of the same import creating it.
    if (e instanceof DirectoryError && e.status === 409) return (await namedPropertyByName(companyId, clean))?.id ?? null;
    throw e;
  }
}

/** A staff member by email or name (case-insensitive), for a property import's Manager column. */
export async function staffIdForLabel(companyId: string, label: string): Promise<string | null> {
  const want = label.trim().toLowerCase();
  if (!want) return null;
  const t = tdb(companyId);
  const members = (await t.select(schema.memberships)).filter((m) => isStaffRole(m.role));
  if (!members.length) return null;
  const users = await t.select(schema.user, inArray(schema.user.id, members.map((m) => m.userId)));
  const hit =
    users.find((u) => (u.email ?? "").toLowerCase() === want) ??
    users.find((u) => (u.name ?? "").trim().toLowerCase() === want);
  return hit?.id ?? null;
}
