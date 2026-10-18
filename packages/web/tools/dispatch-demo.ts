/**
 * Map v2 demo server — DEV ONLY. Never imported by the app, never deployed.
 *
 * Boots the real API on an in-memory Postgres (the same PGlite harness the
 * unit tests use), seeds one internal company around Winnipeg, and serves the
 * built web app, so the dispatch map can be driven end to end (Playwright,
 * screenshots, frame-rate runs) without touching any real data.
 *
 *   bun run build
 *   bun run tools/dispatch-demo.ts                 # 12 technicians, 40 jobs
 *   bun run tools/dispatch-demo.ts --size large    # 200 technicians, 2,000 jobs
 *   bun run tools/dispatch-demo.ts --port 4400 --no-move
 *   bun run tools/dispatch-demo.ts --showcase      # + one finished job for the /features screenshots
 *
 * Prints the sign-in email and password. Every few seconds it moves the
 * technicians who are on the road, so the live stream has something to send.
 */
import { getTableConfig, PgTable, type PgColumn } from "drizzle-orm/pg-core";

const argv = process.argv.slice(2);
const arg = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const SIZE = arg("--size") === "large" ? "large" : "small";
const PORT = Number(arg("--port") ?? 4300);
const MOVE = !argv.includes("--no-move");
const SHOWCASE = argv.includes("--showcase"); // features-page screenshots (tools/features-showcase.ts)

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";
process.env.BETTER_AUTH_SECRET ||= "dispatch-demo-secret-not-for-production";
process.env.WEBSITE_URL ||= `http://localhost:${PORT}`;
process.env.NODE_ENV ||= "development";

export const DEMO = {
  company: "demo-dispatch",
  email: "dispatch@demo.test",
  password: "demo-dispatch-123",
  office: { lat: 49.8951, lng: -97.1384 },
};

const { db } = await import("../src/api/database/index");
const schema = await import("../src/api/database/schema");
const { auth } = await import("../src/api/auth");
const { attachMembership } = await import("../src/api/lib/memberships");
const { eq } = await import("drizzle-orm");

// ── tables ────────────────────────────────────────────────────────────────
function colDdl(col: PgColumn, withPk: boolean): string {
  const parts = [`"${col.name}"`, col.getSQLType()];
  if (withPk && col.primary) parts.push("PRIMARY KEY");
  const dflt = (col as unknown as { default?: unknown }).default;
  const lit =
    dflt === undefined ? null
    : typeof dflt === "string" ? `'${dflt.replace(/'/g, "''")}'`
    : typeof dflt === "boolean" ? (dflt ? "TRUE" : "FALSE")
    : typeof dflt === "number" ? String(dflt)
    : null;
  if (lit !== null) parts.push(`DEFAULT ${lit}`);
  return parts.join(" ");
}
const client = (db as unknown as { $client: { execute: (s: string) => Promise<unknown> } }).$client;
for (const v of Object.values(schema)) {
  if (!(v instanceof PgTable)) continue;
  const cfg = getTableConfig(v);
  await client.execute(`CREATE TABLE IF NOT EXISTS "${cfg.name}" (${cfg.columns.map((c) => colDdl(c, true)).join(", ")})`);
}
// better-auth stamps these itself; the generic DDL above has no SQL defaults for now().
await client.execute(`ALTER TABLE "user" ALTER COLUMN created_at SET DEFAULT now()`);
await client.execute(`ALTER TABLE "user" ALTER COLUMN updated_at SET DEFAULT now()`);

// ── seed ──────────────────────────────────────────────────────────────────
const CO = DEMO.company;
const now = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;

// Deterministic pseudo-random so every run lays out the same city.
let seed = 42;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const jitter = (km: number) => (rnd() - 0.5) * 2 * (km / 111);
const near = (km: number) => ({
  lat: DEMO.office.lat + jitter(km),
  lng: DEMO.office.lng + jitter(km) / Math.cos((DEMO.office.lat * Math.PI) / 180),
});

await db.insert(schema.companies).values({
  id: CO,
  name: "Prairie Demo Heating & Cooling",
  officeLat: DEMO.office.lat,
  officeLng: DEMO.office.lng,
  officeAddress: "300 Portage Ave, Winnipeg, MB",
  isInternal: true,
} as typeof schema.companies.$inferInsert);
await db.insert(schema.companySettings).values({
  id: CO,
  companyId: CO,
  name: "Prairie Demo Heating & Cooling",
  timezone: "America/Winnipeg",
} as typeof schema.companySettings.$inferInsert);

// The dispatcher who signs in.
await auth.api.signUpEmail({ body: { name: "Dana Dispatcher", email: DEMO.email, password: DEMO.password } as never });
const [admin] = await db.select().from(schema.user).where(eq(schema.user.email, DEMO.email));
if (!admin) throw new Error("demo: admin sign-up failed");
await db.update(schema.user).set({ role: "admin", companyId: CO, emailVerified: true }).where(eq(schema.user.id, admin.id));
await attachMembership({ userId: admin.id, companyId: CO, role: "admin", status: "active" });

const SERVICES = [
  { id: "svc-hvac", name: "Furnace & AC repair", category: "HVAC", durationMins: 90 },
  { id: "svc-plumb", name: "Plumbing repair", category: "Plumbing", durationMins: 75 },
  { id: "svc-elec", name: "Electrical service", category: "Electrical", durationMins: 90 },
  { id: "svc-appl", name: "Appliance repair", category: "Appliance", durationMins: 60 },
  { id: "svc-inst", name: "Equipment install", category: "Install", durationMins: 180 },
  { id: "svc-gen", name: "General visit", category: "General", durationMins: 60 },
];
await db.insert(schema.services).values(SERVICES.map((s) => ({ ...s, companyId: CO, basePrice: 150 })));

// Customers (bookings need one).
const customers: string[] = [];
for (let i = 0; i < 8; i++) {
  const id = `demo-cust-${i}`;
  customers.push(id);
  await db.insert(schema.user).values({
    id,
    name: ["Sarah Mitchell", "Robert Chen", "Linda Park", "Omar Haddad", "Grace Thompson", "Ben Kowalski", "Mei Lin", "Jordan Blake"][i]!,
    email: `customer${i}@demo.test`,
    role: "customer",
    companyId: CO,
  });
}

type TechSeed = { name: string; skills: string; skillClass: string; status: string; at?: { lat: number; lng: number }; staleMins?: number };
// The named cast every test and screenshot relies on.
const NAMED: TechSeed[] = [
  { name: "Tom Rivera", skills: "HVAC,Install", skillClass: "HVAC", status: "available", at: { lat: 49.8990, lng: -97.1450 } },
  { name: "Priya Nair", skills: "Plumbing", skillClass: "Plumbing", status: "available", at: { lat: 49.8880, lng: -97.1300 } },
  { name: "Marcus Lee", skills: "HVAC,Electrical", skillClass: "HVAC", status: "onsite", at: { lat: 49.9100, lng: -97.1200 } },
  { name: "Aisha Khan", skills: "Appliance", skillClass: "Appliance", status: "offline", at: { lat: 49.8800, lng: -97.1600 } },
  { name: "Diego Ramos", skills: "HVAC,Install", skillClass: "Install", status: "available", at: { lat: 49.8700, lng: -97.1100 } },
  { name: "Sofia Russo", skills: "Electrical", skillClass: "Electrical", status: "enroute", at: { lat: 49.9200, lng: -97.1550 } },
  { name: "Jamal Carter", skills: "", skillClass: "General", status: "available", at: { lat: 49.8650, lng: -97.1700 }, staleMins: 25 },
  { name: "Emma Wilson", skills: "Plumbing,Appliance", skillClass: "Plumbing", status: "busy", at: { lat: 49.9050, lng: -97.0950 } },
  { name: "Noah Fischer", skills: "HVAC", skillClass: "HVAC", status: "available" }, // no location yet
  { name: "Lucia Gomez", skills: "Electrical,Install", skillClass: "Electrical", status: "available", at: { lat: 49.9300, lng: -97.1000 } },
  { name: "Ethan Brooks", skills: "HVAC,Plumbing", skillClass: "HVAC", status: "enroute", at: { lat: 49.8550, lng: -97.1350 } },
  { name: "Hana Sato", skills: "Appliance,General", skillClass: "Appliance", status: "available", at: { lat: 49.8950, lng: -97.2000 } },
];
const FIRST = ["Alex", "Sam", "Riley", "Jordan", "Taylor", "Casey", "Morgan", "Jamie", "Avery", "Quinn", "Drew", "Rowan", "Parker", "Reese", "Skyler", "Emerson"];
const LAST = ["Nguyen", "Patel", "Smith", "Martin", "Roy", "Tremblay", "Gagnon", "Wong", "Singh", "Brown", "Lavoie", "Campbell", "Murphy", "Kaur", "Leblanc", "Fraser"];
const SKILLSETS = [["HVAC", "HVAC"], ["Plumbing", "Plumbing"], ["Electrical", "Electrical"], ["HVAC,Electrical", "HVAC"], ["Appliance", "Appliance"], ["Install,HVAC", "Install"]];
const STATUSES = ["available", "available", "busy", "enroute", "onsite", "available", "offline"];

const techSeeds: TechSeed[] = [...NAMED];
const techTarget = SIZE === "large" ? 200 : NAMED.length;
for (let i = techSeeds.length; i < techTarget; i++) {
  const [skills, skillClass] = SKILLSETS[i % SKILLSETS.length]!;
  techSeeds.push({
    name: `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`,
    skills: skills!,
    skillClass: skillClass!,
    status: STATUSES[i % STATUSES.length]!,
    at: near(SIZE === "large" ? 28 : 12),
  });
}
const COLORS = ["#0ea5e9", "#10b981", "#f59e0b", "#a855f7", "#22d3ee", "#ec4899", "#84cc16", "#f97316"];
const techIds: string[] = [];
for (let i = 0; i < techSeeds.length; i++) {
  const t = techSeeds[i]!;
  const uid = `demo-tech-user-${i}`;
  const rid = `demo-tech-${i}`;
  techIds.push(rid);
  await db.insert(schema.user).values({ id: uid, name: t.name, email: `tech${i}@demo.test`, role: "rider", companyId: CO, phone: `+1204555${String(1000 + i).slice(-4)}` });
  await db.insert(schema.riders).values({
    id: rid,
    userId: uid,
    companyId: CO,
    skills: t.skills,
    skillClass: t.skillClass,
    status: t.status,
    color: COLORS[i % COLORS.length]!,
    vehicle: `Van #${10 + i}`,
    lat: t.at?.lat ?? null,
    lng: t.at?.lng ?? null,
    locationUpdatedAt: t.at ? new Date(now - (t.staleMins ?? 1) * MIN) : null,
    approval: "active",
  });
}

// Diego is booked off today.
await db.insert(schema.techShifts).values({ id: "demo-timeoff-diego", companyId: CO, riderId: "demo-tech-4", kind: "timeoff", date: new Date(now), startMin: 0, endMin: 1440, note: "Dentist" });

type JobSeed = { title: string; svc: string; status: string; at: number; rider?: string; assign?: string; priority?: string; req?: string; reqSkills?: string; where?: { lat: number; lng: number }; address?: string };
const STREETS = ["Portage Ave", "Main St", "Corydon Ave", "Pembina Hwy", "Henderson Hwy", "St Mary's Rd", "Ellice Ave", "Notre Dame Ave", "Osborne St", "Academy Rd"];
const NAMED_JOBS: JobSeed[] = [
  { title: "Furnace not heating", svc: "svc-hvac", status: "pending", at: now + 2 * HOUR, priority: "high", req: "HVAC", where: { lat: 49.9020, lng: -97.1480 }, address: "182 Spence St, Winnipeg" },
  { title: "Leaky kitchen tap", svc: "svc-plumb", status: "confirmed", at: now + 3 * HOUR, where: { lat: 49.8860, lng: -97.1280 }, address: "55 Osborne St, Winnipeg" },
  { title: "No power in garage", svc: "svc-elec", status: "pending", at: now - 20 * HOUR, priority: "urgent", where: { lat: 49.9150, lng: -97.1650 }, address: "910 Notre Dame Ave, Winnipeg" },
  { title: "Dryer won't spin", svc: "svc-appl", status: "confirmed", at: now + 26 * HOUR, where: { lat: 49.8720, lng: -97.1900 }, address: "1400 Corydon Ave, Winnipeg" },
  { title: "AC tune-up", svc: "svc-hvac", status: "pending", at: now + 5 * HOUR, where: { lat: 49.8600, lng: -97.1400 }, address: "75 Pembina Hwy, Winnipeg" },
  { title: "Boiler inspection", svc: "svc-hvac", status: "pending", at: now + 6 * HOUR, req: "HVAC", reqSkills: "Boiler", where: { lat: 49.9250, lng: -97.0900 }, address: "1200 Henderson Hwy, Winnipeg" },
  { title: "Water heater install", svc: "svc-inst", status: "assigned", assign: "accepted", rider: "demo-tech-0", at: now + 4 * HOUR, where: { lat: 49.8940, lng: -97.1600 }, address: "400 Ellice Ave, Winnipeg" },
  { title: "Thermostat swap", svc: "svc-hvac", status: "in_progress", assign: "accepted", rider: "demo-tech-2", at: now - 40 * MIN, where: { lat: 49.9105, lng: -97.1205 }, address: "650 Main St, Winnipeg" },
  { title: "Panel upgrade", svc: "svc-elec", status: "enroute", assign: "accepted", rider: "demo-tech-5", at: now + 20 * MIN, where: { lat: 49.9280, lng: -97.1450 }, address: "1020 Keewatin St, Winnipeg" },
  { title: "Gas line check", svc: "svc-hvac", status: "enroute", assign: "accepted", rider: "demo-tech-10", at: now + 15 * MIN, where: { lat: 49.8480, lng: -97.1300 }, address: "2500 Pembina Hwy, Winnipeg" },
  { title: "Drain cleaning", svc: "svc-plumb", status: "assigned", assign: "offered", rider: "demo-tech-7", at: now + 90 * MIN, where: { lat: 49.9000, lng: -97.0900 }, address: "320 Archibald St, Winnipeg" },
  { title: "Fridge not cooling", svc: "svc-appl", status: "completed", assign: "accepted", rider: "demo-tech-11", at: now - 3 * HOUR, where: { lat: 49.8960, lng: -97.2050 }, address: "1750 Portage Ave, Winnipeg" },
];
const jobSeeds: JobSeed[] = [...NAMED_JOBS];
const jobTarget = SIZE === "large" ? 2000 : 40;
const svcIds = SERVICES.map((s) => s.id);
for (let i = jobSeeds.length; i < jobTarget; i++) {
  const r = rnd();
  const assigned = r < 0.55;
  const rider = assigned ? techIds[Math.floor(rnd() * techIds.length)] : undefined;
  const status = !assigned ? (rnd() < 0.5 ? "pending" : "confirmed") : r < 0.2 ? "completed" : r < 0.3 ? "in_progress" : "assigned";
  jobSeeds.push({
    title: ["Furnace service", "Leak repair", "Outlet not working", "Washer repair", "Unit install", "Site visit", "Filter change", "Duct cleaning"][i % 8]!,
    svc: svcIds[i % svcIds.length]!,
    status,
    assign: assigned ? (status === "assigned" && rnd() < 0.4 ? "offered" : "accepted") : "none",
    rider,
    at: now + Math.round((rnd() * 30 - 6) * HOUR),
    priority: rnd() < 0.08 ? "urgent" : rnd() < 0.2 ? "high" : "normal",
    where: near(SIZE === "large" ? 30 : 14),
    address: `${100 + Math.floor(rnd() * 1900)} ${STREETS[i % STREETS.length]}, Winnipeg`,
  });
}
const rows = jobSeeds.map((j, i) => ({
  id: `demo-job-${i}`,
  companyId: CO,
  customerId: customers[i % customers.length]!,
  serviceId: j.svc,
  title: j.title,
  status: j.status,
  assignStatus: j.assign ?? "none",
  priority: j.priority ?? "normal",
  scheduledAt: new Date(j.at),
  address: j.address ?? "Winnipeg",
  lat: j.where?.lat ?? DEMO.office.lat,
  lng: j.where?.lng ?? DEMO.office.lng,
  riderId: j.rider ?? null,
  requiredSkillClass: j.req ?? "",
  requiredSkills: j.reqSkills ?? "",
  startedAt: j.status === "in_progress" ? new Date(now - 30 * MIN) : null,
  enrouteAt: j.status === "enroute" ? new Date(now - 10 * MIN) : null,
  finishedAt: j.status === "completed" ? new Date(now - 2 * HOUR) : null,
  assignedAt: j.rider ? new Date(now - HOUR) : null,
  acceptedAt: j.assign === "accepted" ? new Date(now - 50 * MIN) : null,
}));
for (let i = 0; i < rows.length; i += 400) await db.insert(schema.bookings).values(rows.slice(i, i + 400));

if (SHOWCASE) {
  const { seedShowcase } = await import("./features-showcase");
  console.log("showcase:", JSON.stringify(await seedShowcase({ db, schema, CO, adminId: admin.id, customers })));
}

// ── serve ─────────────────────────────────────────────────────────────────
const { default: app } = await import("../src/api/index");
const { serveSite } = await import("../src/site-server");
const server = Bun.serve({
  port: PORT,
  idleTimeout: 0,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api")) return app.fetch(request);
    if (SHOWCASE && url.pathname === "/demo-assets/voice-note.mp3") {
      return new Response(Bun.file(new URL("./fixtures/voice-note.mp3", import.meta.url)), { headers: { "content-type": "audio/mpeg" } });
    }
    return serveSite(request, url);
  },
});

// ── live movement ─────────────────────────────────────────────────────────
if (MOVE) {
  const realtime = (await import("../src/services/realtime")) as Record<string, unknown>;
  const publish = realtime.publishDispatch as undefined | ((co: string, s: unknown) => Promise<void>);
  setInterval(async () => {
    const moving = await db.select().from(schema.riders).where(eq(schema.riders.status, "enroute"));
    for (const r of moving.slice(0, 12)) {
      if (r.lat == null || r.lng == null) continue;
      const lat = r.lat + (rnd() - 0.5) * 0.0016;
      const lng = r.lng + (rnd() - 0.5) * 0.0024;
      await db.update(schema.riders).set({ lat, lng, locationUpdatedAt: new Date() }).where(eq(schema.riders.id, r.id));
      await publish?.(CO, { kind: "location", techId: r.id, lat, lng, at: Date.now() });
    }
  }, 4_000);
}

console.log(`dispatch demo (${SIZE}: ${techSeeds.length} technicians, ${jobSeeds.length} jobs) on http://localhost:${server.port}`);
console.log(`DEMO_EMAIL=${DEMO.email}`);
console.log(`DEMO_PASSWORD=${DEMO.password}`);
