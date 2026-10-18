/**
 * Features-page showcase data — DEV ONLY, used by `tools/dispatch-demo.ts --showcase`.
 *
 * Seeds the demo company with one finished commercial AC call (and the setup a
 * real company would have by then) so the /features screenshots show the app
 * exactly as it renders real data:
 *   - the HVAC catalog preset (same seeding a new company gets) + two parts
 *   - a $150 service call that includes the first 60 minutes, then $90/h
 *   - the driven route there and back (OSRM road geometry, tools/fixtures/showcase-route.json)
 *   - before / during / after photos (Pexels, see public/img/site/features), a drawn
 *     signature and a voice note with transcript
 *   - price, tax and tech pay computed by the app's own billing code
 *   - a paid card invoice
 *   - a second job on the way, for the customer tracking page
 *   - onboarding marked done so first-run overlays stay out of the shots
 */
import { eq } from "drizzle-orm";
import routeFixture from "./fixtures/showcase-route.json";

type Pt = [number, number];
const MIN = 60_000;

export const SHOWCASE = {
  jobId: "7c2e9a41-3b58-4f0d-9e16-2a8d5f41c042",
  liveJobId: "demo-job-8",
  token: "showcasejob1",
  liveToken: "showcaselive",
  tech: "demo-tech-0",
  techEmail: "marcus@demo.test",
  techPassword: "demo-tech-123",
};

/** A hand-drawn-looking signature, as the signature pad stores it (SVG data URL). */
const SIGNATURE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 110"><path d="M18 78c10-30 22-52 30-55 7-3 3 22-4 44-5 15-3 18 6 4 8-13 15-26 19-25 4 1-2 22 3 23 6 1 12-20 18-21 5-1 2 18 7 18 7 0 13-24 19-24 5 0 0 21 6 21 8 0 14-31 22-30 7 1-4 30 3 30 6 0 11-12 16-18M150 70c4-9 12-14 17-11 6 4-3 18-10 18-6 0-5-9 2-12 10-4 18 2 24 1 8-1 13-13 19-13 5 0 2 13 8 13 9 0 17-17 26-17 7 0 1 15 8 15 10 0 22-12 34-16 9-3 18-3 24 0" fill="none" stroke="#0f172a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** Spread `n` evenly spaced samples of a polyline across a time window. */
function sample(line: Pt[], n: number, t0: number, t1: number) {
  const out: { lat: number; lng: number; at: number }[] = [];
  for (let i = 0; i < n; i++) {
    const p = line[Math.round((i / (n - 1)) * (line.length - 1))]!;
    out.push({ lat: p[0], lng: p[1], at: Math.round(t0 + ((t1 - t0) * i) / (n - 1)) });
  }
  return out;
}

export async function seedShowcase(opts: {
  db: any;
  schema: any;
  CO: string;
  adminId: string;
  customers: string[];
}) {
  const { db, schema, CO, adminId } = opts;
  const { seedCatalogForCompany } = await import("../src/services/company-provisioning");
  const { recomputeBooking, accrueTechPay } = await import("../src/services/billing");
  const { scoutStarterTemplates } = await import("../src/services/template-scout");

  // An established company: industry chosen, set-up finished, Welcome done.
  await db
    .update(schema.companies)
    .set({
      industry: "hvac-plumbing",
      onboardingCompletedAt: new Date(),
      // Stripe connected (display only in the demo — see dispatch-demo.ts).
      stripeAccountId: "acct_showcase_demo",
      stripeCountry: "CA",
      stripeDetailsSubmitted: true,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      stripeConnectedAt: new Date(),
    })
    .where(eq(schema.companies.id, CO));
  await db
    .update(schema.memberships)
    .set({ onboarding: JSON.stringify({ welcomeDoneAt: new Date().toISOString(), checklistHidden: true }) })
    .where(eq(schema.memberships.userId, adminId));
  await db.update(schema.companySettings).set({ geofenceRadiusM: 150 }).where(eq(schema.companySettings.id, CO));

  // Catalog: the HVAC preset every new HVAC company starts with, plus the two
  // parts this call used.
  await seedCatalogForCompany(CO, "hvac-plumbing");
  await db.insert(schema.catalogItems).values([
    { id: "showcase-fan-motor", companyId: CO, kind: "product", name: "Condenser Fan Motor (1/4 HP, 825 RPM)", sku: "HVAC-CFM", category: "Parts", unit: "each", unitCost: 118, markupPct: 85, unitPrice: 218.3, taxable: true, description: "Universal condenser fan motor, 208-230 V." },
    { id: "showcase-r410a", companyId: CO, kind: "product", name: "R-410A Refrigerant (per lb)", sku: "HVAC-410A", category: "Consumables", unit: "lb", unitCost: 24, markupPct: 150, unitPrice: 60, taxable: true, description: "Charged and weighed in on site." },
  ]);

  // Work-order templates, through the same path provisioning uses (falls back
  // to the generic starter set when no AI gateway is configured).
  const tpls = await scoutStarterTemplates({
    name: "Prairie Demo Heating & Cooling",
    industry: "hvac-plumbing",
    services: ["Furnace & AC repair", "Equipment install", "Maintenance plans"],
    workerNoun: "Technician",
    customerNoun: "Customer",
    brandColor: "#0ea5e9",
  } as never).catch(() => []);
  // The service-call template: a $150 call-out that includes the first 60
  // minutes, then $90/h — the rule the showcase job is billed on.
  const SERVICE_PAY = { hourlyRate: null, perKmRate: 0.5, flatPay: 0, mileageBasis: "round_trip", includedKm: 0 };
  const RATE = { flatRate: 150, includedMinutes: 60, includedKm: 0, timeRate: 90, timeUnit: "hour", kmRate: 0, minCharge: 0, freeMinutes: 0, firstHourRate: 0, additionalHourRate: 0 };
  for (const tpl of tpls as any[]) {
    if (/service|maintenance/i.test(tpl.name)) {
      tpl.rateModel = RATE;
      // Pay the tech their own hourly rate plus 50 cents a km round trip, and
      // collect payment on site.
      tpl.techPayModel = SERVICE_PAY;
      tpl.collectPayment = "on_site";
    }
    await db.insert(schema.taskTemplates).values({
      companyId: CO, name: tpl.name, category: tpl.category, icon: tpl.icon, color: tpl.color, description: tpl.description,
      fields: JSON.stringify(tpl.fields), checklist: JSON.stringify(tpl.checklist), estimatedMins: tpl.estimatedMins, rateModel: JSON.stringify(tpl.rateModel),
      techPayModel: tpl.techPayModel ? JSON.stringify(tpl.techPayModel) : "", collectPayment: tpl.collectPayment ?? "", active: true,
    });
  }

  // Every technician has an hourly rate, and the other finished jobs have their
  // on-site time, so the payouts screen reads like a working week.
  const riders = await db.select().from(schema.riders).where(eq(schema.riders.companyId, CO));
  for (const [i, r] of riders.entries()) {
    await db.update(schema.riders).set({ payRatePerHour: [32, 34, 36, 38, 40, 42][i % 6] }).where(eq(schema.riders.id, r.id));
  }
  await db.update(schema.riders).set({ payRatePerHour: 38, vehicle: "Ford Transit 250" }).where(eq(schema.riders.id, SHOWCASE.tech));
  const done = await db.select().from(schema.bookings).where(eq(schema.bookings.status, "completed"));
  for (const [i, j] of done.entries()) {
    if (!j.riderId || j.companyId !== CO) continue;
    const mins = 45 + ((i * 37) % 100);
    const end = j.finishedAt ? new Date(j.finishedAt).getTime() : Date.now() - 2 * 60 * MIN;
    await db.update(schema.bookings).set({ onSiteMinutes: mins, startedAt: new Date(end - mins * MIN), finishedAt: new Date(end) }).where(eq(schema.bookings.id, j.id));
    await accrueTechPay(CO, j.id);
  }

  // ── the finished job ──────────────────────────────────────────────────────
  const R = routeFixture as unknown as { job: Pt; enroute: Pt[]; return: Pt[]; enrouteKm: number; returnKm: number };
  const day = new Date();
  day.setUTCDate(day.getUTCDate() - 1);
  day.setUTCHours(14, 20, 0, 0); // 9:20 am in Winnipeg (CDT)
  const enroute = day.getTime();
  const arrived = enroute + 14 * MIN;
  const finished = arrived + 85 * MIN;
  const home = finished + 15 * MIN;

  const custId = "showcase-cust";
  await db.insert(schema.user).values({ id: custId, name: "Grace Thompson", email: "grace.thompson@demo.test", role: "customer", companyId: CO, phone: "+12045550142" });

  const { buildLineItem, normalizeCatalogItem } = await import("../src/shared/catalog");
  const cat = (await db.select().from(schema.catalogItems).where(eq(schema.catalogItems.companyId, CO))).map(normalizeCatalogItem);
  const byId = (id: string) => cat.find((c: any) => c.id === id);
  const capacitor = cat.find((c: any) => c.sku === "HVAC-CAP");
  const lineItems = [
    buildLineItem(byId("showcase-fan-motor")!, 1, byId),
    ...(capacitor ? [buildLineItem(capacitor, 1, byId)] : []),
    buildLineItem(byId("showcase-r410a")!, 2, byId),
  ];

  const enroutePings = sample(R.enroute, 46, enroute, arrived - 20_000);
  const onsite = Array.from({ length: 10 }, (_, i) => ({
    lat: R.job[0] + Math.sin(i * 1.7) * 0.00012,
    lng: R.job[1] + Math.cos(i * 1.3) * 0.00016,
    at: arrived + Math.round(((finished - arrived) * (i + 0.5)) / 10),
  }));
  const returnPings = sample(R.return, 44, finished + 60_000, home);
  const pings = [
    ...enroutePings.map((p) => ({ ...p, phase: "enroute" })),
    ...onsite.map((p) => ({ ...p, phase: "onsite" })),
    ...returnPings.map((p) => ({ ...p, phase: "return" })),
  ];
  const mileageKm = Math.round((R.enrouteKm + R.returnKm) * 100) / 100;
  const snapped = {
    v: 1,
    provider: "osrm",
    pingCount: pings.length,
    distanceKm: mileageKm,
    points: [
      ...R.enroute.map(([lat, lng]) => ({ lat, lng, phase: "enroute" })),
      ...onsite.map((p) => ({ lat: p.lat, lng: p.lng, phase: "onsite" })),
      ...R.return.map(([lat, lng]) => ({ lat, lng, phase: "return" })),
    ],
    computedAt: new Date(home + 5 * MIN).toISOString(),
  };

  await db.insert(schema.bookings).values({
    id: SHOWCASE.jobId,
    companyId: CO,
    customerId: custId,
    serviceId: "svc-hvac",
    riderId: SHOWCASE.tech,
    title: "Rooftop AC not cooling",
    status: "completed",
    assignStatus: "accepted",
    priority: "high",
    scheduledAt: new Date(enroute + 10 * MIN),
    address: "1460 Saskatchewan Ave, Winnipeg",
    region: "MB",
    lat: R.job[0],
    lng: R.job[1],
    notes: "Rooftop unit RTU-1 over the front office is blowing warm air. Roof access by the ladder in the back hallway; ask for Grace at reception.",
    driverNotes: "Condenser fan motor seized and run capacitor bulging. Replaced both, weighed in 2 lb R-410A, pressures back in range. Unit cycling normally. Recommend coil cleaning in spring.",
    customerPhone: "+12045550142",
    publicToken: SHOWCASE.token,
    assignedAt: new Date(enroute - 50 * MIN),
    acceptedAt: new Date(enroute - 45 * MIN),
    enrouteAt: new Date(enroute),
    startedAt: new Date(arrived),
    finishedAt: new Date(finished),
    transitMinutes: 14,
    onSiteMinutes: 85,
    accumulatedMs: 85 * MIN,
    clockState: "idle",
    mileageKm,
    mileageToJobKm: R.enrouteKm,
    mileageReturnKm: R.returnKm,
    techPayModel: JSON.stringify(SERVICE_PAY),
    collectPayment: "on_site",
    routeSnapped: JSON.stringify(snapped),
    rateModel: JSON.stringify(RATE),
    lineItems: JSON.stringify(lineItems),
    signatureUrl: `data:image/svg+xml;utf8,${encodeURIComponent(SIGNATURE_SVG)}`,
    signatureName: "Grace Thompson",
    signedAt: new Date(finished - 2 * MIN),
    paymentStatus: "paid",
  });
  await recomputeBooking(CO, SHOWCASE.jobId);
  await accrueTechPay(CO, SHOWCASE.jobId);

  for (let i = 0; i < pings.length; i += 100) {
    await db.insert(schema.trackingPings).values(
      pings.slice(i, i + 100).map((p) => ({ companyId: CO, bookingId: SHOWCASE.jobId, lat: p.lat, lng: p.lng, phase: p.phase, createdAt: new Date(p.at) })),
    );
  }

  const photos = [
    { phase: "before", url: "/img/site/features/job-before.jpg", caption: "RTU-1 as found, access panel off", at: arrived + 4 * MIN },
    { phase: "during", url: "/img/site/features/job-during.jpg", caption: "Leak check on the condenser coil", at: arrived + 41 * MIN },
    { phase: "after", url: "/img/site/features/job-after.jpg", caption: "Pressures back in range after the recharge", at: finished - 6 * MIN },
  ];
  await db.insert(schema.jobPhotos).values(
    photos.map((p) => ({ companyId: CO, bookingId: SHOWCASE.jobId, url: p.url, caption: p.caption, phase: p.phase, source: "upload", createdAt: new Date(p.at) })),
  );

  const [b] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, SHOWCASE.jobId));
  const ev = (kind: string, at: number, label: string, extra: Record<string, unknown> = {}) => ({
    companyId: CO, bookingId: SHOWCASE.jobId, kind, label, createdAt: new Date(at), actorRole: "tech", actorName: "Tom Rivera", customerVisible: true, ...extra,
  });
  await db.insert(schema.jobEvents).values([
    ev("created", enroute - 70 * MIN, "Work order created", { actorRole: "dispatch", actorName: "Dana Dispatcher" }),
    ev("assigned", enroute - 50 * MIN, "Assigned to Tom Rivera", { actorRole: "dispatch", actorName: "Dana Dispatcher" }),
    ev("accepted", enroute - 45 * MIN, "Tom accepted the job"),
    ev("enroute", enroute, "Tom is on the way"),
    ev("arrived", arrived, "Arrived on site (inside the 150 m geofence)"),
    ev("photo_added", arrived + 4 * MIN, "Before photo added"),
    ev("photo_added", arrived + 41 * MIN, "During photo added"),
    ev("voice_note", arrived + 62 * MIN, "Voice note: Condenser fan motor on RTU-1 was seized, and the run capacitor was bulging.", {
      customerVisible: false,
      detail: "Condenser fan motor on RTU-1 was seized, and the run capacitor was bulging. Replaced both, recharged two pounds of 410A, and pressures are back in range. Unit's cycling normally. Recommend a coil cleaning in the spring.",
      meta: JSON.stringify({ url: "/demo-assets/voice-note.mp3", durationSecs: 12, transcribed: true }),
    }),
    ev("photo_added", finished - 6 * MIN, "After photo added"),
    ev("signature_captured", finished - 2 * MIN, "Signed by Grace Thompson"),
    ev("completed", finished, "Job completed"),
  ]);

  const total = Number(b?.total ?? 0);
  await db.insert(schema.invoices).values({
    id: "showcase-invoice", companyId: CO, bookingId: SHOWCASE.jobId, customerId: custId, number: "INV-1042",
    amount: Number(b?.subtotal ?? 0), tax: Number(b?.taxAmount ?? 0), total, status: "paid", method: "card",
    paidAt: new Date(finished + 1 * MIN), stripePaymentIntentId: "pi_demo_showcase", stripeChargeId: "ch_demo_showcase", currency: "cad",
  });
  await db.insert(schema.paymentLedger).values({
    companyId: CO, invoiceId: "showcase-invoice", bookingId: SHOWCASE.jobId, kind: "charge", amount: total, currency: "cad",
    stripeObjectId: "ch_demo_showcase", status: "succeeded", memo: "Card payment", createdAt: new Date(finished + 1 * MIN),
  });

  // The live job for the customer tracking page: Sofia is on the way.
  await db
    .update(schema.bookings)
    .set({ publicToken: SHOWCASE.liveToken, customerPhone: "+12045550188", etaMins: 12, etaDistanceKm: 4.1, collectPayment: "on_site" })
    .where(eq(schema.bookings.id, SHOWCASE.liveJobId));

  // A technician login for the technician-app screens: Marcus Lee, on site on
  // "Thermostat swap" (demo-job-7), a job that collects payment on site.
  const { auth } = await import("../src/api/auth");
  const { attachMembership } = await import("../src/api/lib/memberships");
  await auth.api.signUpEmail({ body: { name: "Marcus Lee", email: SHOWCASE.techEmail, password: SHOWCASE.techPassword } as never });
  const [tu] = await db.select().from(schema.user).where(eq(schema.user.email, SHOWCASE.techEmail));
  if (tu) {
    await db.update(schema.user).set({ role: "rider", companyId: CO, emailVerified: true, phone: "+12045551002" }).where(eq(schema.user.id, tu.id));
    await attachMembership({ userId: tu.id, companyId: CO, role: "rider", status: "active" });
    await db.update(schema.riders).set({ userId: tu.id }).where(eq(schema.riders.id, "demo-tech-2"));
  }
  await db
    .update(schema.bookings)
    .set({ collectPayment: "on_site", customerPhone: "+12045550177", rateModel: JSON.stringify(RATE), techPayModel: JSON.stringify(SERVICE_PAY) })
    .where(eq(schema.bookings.id, "demo-job-7"));
  await recomputeBooking(CO, "demo-job-7", { actualMinutes: 40 });

  return { photos: photos.length, pings: pings.length, templates: (tpls as unknown[]).length, mileageKm, total };
}
