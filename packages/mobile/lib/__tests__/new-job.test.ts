import { describe, expect, test } from "bun:test";
import { buildAdminBooking, EMPTY_DRAFT, pickClient, validateDraft, type NewJobDraft } from "../new-job";

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

describe("pickClient", () => {
  const pat = { kind: "existing" as const, id: "cu_1", name: "Pat", lastAddress: "1 Pat St" };
  const sam = { kind: "existing" as const, id: "cu_2", name: "Sam", lastAddress: "2 Sam Ave" };
  const bare = { kind: "existing" as const, id: "cu_3", name: "Bo" };
  const base = { ...EMPTY_DRAFT, lat: 1, lng: 2 };

  test("fills an empty address from the client", () => {
    expect(pickClient(base, pat)).toEqual({ action: "replace", address: "1 Pat St" });
  });
  test("swaps the previous client's own address without asking", () => {
    expect(pickClient({ ...base, client: pat, address: "1 Pat St" }, sam)).toEqual({ action: "replace", address: "2 Sam Ave" });
  });
  test("asks before replacing an address the dispatcher typed", () => {
    expect(pickClient({ ...base, address: "9 Elm Rd" }, pat)).toEqual({ action: "ask", address: "1 Pat St" });
    expect(pickClient({ ...base, client: pat, address: "9 Elm Rd" }, sam)).toEqual({ action: "ask", address: "2 Sam Ave" });
  });
  test("keeps a typed address when the client has none, or the same one", () => {
    expect(pickClient({ ...base, address: "9 Elm Rd" }, bare)).toEqual({ action: "set" });
    expect(pickClient({ ...base, address: " 1 Pat St " }, pat)).toEqual({ action: "set" });
  });
  test("picking the same client again changes nothing", () => {
    expect(pickClient({ ...base, client: pat, address: "9 Elm Rd" }, pat)).toEqual({ action: "set" });
  });
});
