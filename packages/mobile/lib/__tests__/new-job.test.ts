import { describe, expect, test } from "bun:test";
import { buildAdminBooking, EMPTY_DRAFT, validateDraft, type NewJobDraft } from "../new-job";

const now = new Date("2026-10-21T15:07:00.000Z");

const full: NewJobDraft = {
  ...EMPTY_DRAFT,
  client: { kind: "existing", id: "cu_1", name: "Pat Lee", phone: " 204-555-0100 " },
  serviceId: "svc_1",
  title: "",
  priority: "high",
  notes: " Gate code 1234 ",
  address: " 12 Main St, Winnipeg ",
  lat: 49.9,
  lng: -97.1,
  when: { kind: "asap" },
  riderId: "r_1",
};

describe("validateDraft", () => {
  test("names every missing required field", () => {
    expect(validateDraft(EMPTY_DRAFT)).toEqual({
      client: "Pick a client or add a new one",
      serviceId: "Pick a service",
      address: "Enter the address",
      when: "Pick a time",
    });
  });

  test("a new client needs a name and a valid email", () => {
    const d = { ...full, client: { kind: "new" as const, name: "", email: "x" } };
    expect(validateDraft(d).client).toBe("The new client needs a name");
    expect(validateDraft({ ...d, client: { kind: "new", name: "Sam", email: "sam@" } }).client).toBe("The new client needs a valid email");
    expect(validateDraft({ ...d, client: { kind: "new", name: "Sam", email: "sam@example.com" } }).client).toBeUndefined();
  });
});

describe("buildAdminBooking", () => {
  test("existing client, ASAP rounds up, trims text, carries the tech", () => {
    const r = buildAdminBooking(full, now);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body).toEqual({
      serviceId: "svc_1",
      scheduledAt: "2026-10-21T15:15:00.000Z",
      address: "12 Main St, Winnipeg",
      priority: "high",
      lat: 49.9,
      lng: -97.1,
      notes: "Gate code 1234",
      customerId: "cu_1",
      phone: "204-555-0100",
      riderId: "r_1",
    });
  });

  test("new client sends name and lower-cased email; no tech omits riderId", () => {
    const r = buildAdminBooking(
      { ...full, client: { kind: "new", name: " Sam Roy ", email: "Sam@Example.com" }, riderId: null, when: { kind: "at", iso: "2026-10-22T14:00:00.000Z" } },
      now,
      { force: true },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.customerName).toBe("Sam Roy");
    expect(r.body.customerEmail).toBe("sam@example.com");
    expect(r.body.customerId).toBeUndefined();
    expect(r.body.riderId).toBeUndefined();
    expect(r.body.scheduledAt).toBe("2026-10-22T14:00:00.000Z");
    expect(r.body.force).toBe(true);
  });

  test("returns errors instead of a body when incomplete", () => {
    const r = buildAdminBooking({ ...full, address: "" }, now);
    expect(r).toEqual({ ok: false, errors: { address: "Enter the address" } });
  });
});
