/**
 * Control Hub demo factory: a branded, working demo account for any of the
 * industries we've researched, in a couple of minutes.
 *
 * A demo is an ordinary tenant made by the same provisioning pipeline as a
 * real signup (company-provisioning.ts), then marked kind "demo" (left out of
 * analytics and HubSpot, Map v2 on) with an end date. Its sample day
 * (sample-day.ts) gives it technicians on the move and a day of jobs; nothing
 * in a demo ever texts or emails anyone. Reset lays the day out again; Extend
 * moves the end date; Convert turns it into a real customer account.
 *
 * Expired demos are never deleted on their own: they stop re-laying their day,
 * and the Control Hub overview asks someone to extend, convert or delete them.
 */
import { eq } from "drizzle-orm";
import { sdb } from "../api/database";
import * as schema from "../api/database/schema";
import { tdb } from "../api/database/tenant";
import { getIndustryPreset } from "./industry-presets";
import { provisionCompany, slugify, type CompanyCreateInput } from "./company-provisioning";
import { clearSampleDay, seedSampleDay } from "./sample-day";
import { forwardGeocode } from "./geocode";
import { setTenantKind } from "./tenant-kind";
import { platformAudit } from "./platform-audit";
import { invalidateCompanyCache } from "../api/middleware/auth";

const DAY = 86_400_000;
export const DEMO_DEFAULT_DAYS = 30;
export const DEMO_MAX_DAYS = 180;

export class DemoError extends Error {
  constructor(
    public code: "bad_industry" | "bad_name" | "not_demo" | "not_found" | "bad_days",
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

async function freeSlug(base: string): Promise<string> {
  const root = `demo-${slugify(base)}`.slice(0, 60).replace(/-+$/, "");
  for (let i = 0; i < 50; i++) {
    const id = i === 0 ? root : `${root}-${i + 1}`;
    const [hit] = await sdb.select({ id: schema.companies.id }).from(schema.companies).where(eq(schema.companies.id, id));
    if (!hit) return id;
  }
  return `${root}-${crypto.randomUUID().slice(0, 6)}`;
}

function randomPassword(): string {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  return `Demo-${[...b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

export interface CreateDemoArgs {
  name: string;
  industry: string;
  city?: string;
  website?: string;
  brand?: CompanyCreateInput["brand"];
  days?: number;
  actor: { id: string; name: string };
  /** Test hook: provisioning is the slow, AI-assisted part. */
  provision?: typeof provisionCompany;
  geocode?: typeof forwardGeocode;
}

export async function createDemo(a: CreateDemoArgs) {
  const name = a.name.trim();
  if (name.length < 2 || name.length > 120) throw new DemoError("bad_name", "Give the demo company a name (2 to 120 characters).");
  const preset = getIndustryPreset(a.industry);
  if (!preset) throw new DemoError("bad_industry", "Pick one of the industries.");
  const days = a.days ?? DEMO_DEFAULT_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > DEMO_MAX_DAYS) throw new DemoError("bad_days", `A demo can run 1 to ${DEMO_MAX_DAYS} days.`);

  const slug = await freeSlug(name);
  const provision = a.provision ?? provisionCompany;
  const result = await provision(
    {
      name,
      slug,
      industry: preset.id,
      website: a.website,
      // A login nobody receives mail at: demos are opened through act-as,
      // and nothing in a demo ever sends.
      adminEmail: `${slug}@demo.arriveping.com`,
      adminName: `${name} Admin`,
      adminPassword: randomPassword(),
      brand: a.brand,
      plan: "pro",
    } as CompanyCreateInput,
    { id: a.actor.id, name: a.actor.name },
    { source: "superadmin" },
  );
  const id = result.company.id;
  await setTenantKind(id, "demo");
  await sdb.update(schema.companies).set({ demoExpiresAt: new Date(Date.now() + days * DAY), updatedAt: new Date() }).where(eq(schema.companies.id, id));

  // Put the demo's office (and so its vans) in the prospect's city.
  let located = false;
  if (a.city?.trim()) {
    const hit = await (a.geocode ?? forwardGeocode)(a.city.trim()).catch(() => null);
    if (hit) {
      await sdb.update(schema.companies).set({ officeAddress: hit.address, officeLat: hit.lat, officeLng: hit.lng }).where(eq(schema.companies.id, id));
      await tdb(id).update(schema.companySettings, { address: hit.address, lat: hit.lat, lng: hit.lng } as never, eq(schema.companySettings.companyId, id));
      await clearSampleDay(id).catch(() => null);
      await seedSampleDay(id, { force: true }).catch(() => null);
      located = true;
    }
  }
  invalidateCompanyCache();
  await platformAudit({ actor: a.actor, action: "demo.create", companyId: id, entityType: "company", entityId: id, summary: `Made demo ${name} (${preset.label}${a.city ? `, ${a.city}` : ""}) for ${days} days` });
  return { id, name, industry: preset.id, industryLabel: preset.label, located, adminUserId: result.admin.id, expiresAt: new Date(Date.now() + days * DAY).toISOString() };
}

async function demoRow(id: string) {
  const [co] = await sdb.select().from(schema.companies).where(eq(schema.companies.id, id));
  if (!co) throw new DemoError("not_found", "No such demo.", 404);
  if (co.kind !== "demo") throw new DemoError("not_demo", "That account isn't a demo.", 400);
  return co;
}

/** Lay the sample day out again from now, as if the demo were brand new. */
export async function resetDemo(id: string, actor: { id: string; name: string }) {
  const co = await demoRow(id);
  await clearSampleDay(id);
  const seeded = await seedSampleDay(id, { force: true });
  await platformAudit({ actor, action: "demo.reset", companyId: id, entityType: "company", entityId: id, summary: `Reset demo ${co.name}` });
  return { ok: true, jobs: seeded.jobs, techs: seeded.techs };
}

/** Move the end date to `days` from now. */
export async function extendDemo(id: string, days: number, actor: { id: string; name: string }) {
  if (!Number.isInteger(days) || days < 1 || days > DEMO_MAX_DAYS) throw new DemoError("bad_days", `Extend by 1 to ${DEMO_MAX_DAYS} days.`);
  const co = await demoRow(id);
  const until = new Date(Date.now() + days * DAY);
  await sdb.update(schema.companies).set({ demoExpiresAt: until, updatedAt: new Date() }).where(eq(schema.companies.id, id));
  await platformAudit({ actor, action: "demo.extend", companyId: id, entityType: "company", entityId: id, summary: `Demo ${co.name} now ends ${until.toISOString().slice(0, 10)}` });
  return { ok: true, expiresAt: until.toISOString() };
}

/**
 * The prospect signed: turn the demo into their real account. It becomes a
 * customer (analytics, HubSpot and onboarding nudges start counting it) and
 * the sample data is cleared unless they want to keep it while they set up.
 */
export async function convertDemo(id: string, opts: { keepSample?: boolean }, actor: { id: string; name: string }) {
  const co = await demoRow(id);
  await setTenantKind(id, "customer");
  await sdb.update(schema.companies).set({ demoExpiresAt: null, updatedAt: new Date() }).where(eq(schema.companies.id, id));
  if (!opts.keepSample) await clearSampleDay(id).catch(() => null);
  invalidateCompanyCache();
  await platformAudit({ actor, action: "demo.convert", companyId: id, entityType: "company", entityId: id, summary: `Turned demo ${co.name} into a customer account` });
  return { ok: true };
}


export async function listDemos() {
  return sdb.select().from(schema.companies).where(eq(schema.companies.kind, "demo"));
}
