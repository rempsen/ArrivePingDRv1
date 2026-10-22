/**
 * Which services a public intake form offers, and how a submission is booked:
 * the service (kept within the form's own list), its urgency, and the day the
 * customer asked for on the company's clock.
 */
import { describe, it, expect } from "bun:test";
import { localInstant } from "../../test-support/zone-rules";
import {
  cleanServiceIds,
  formServiceIds,
  intakePriority,
  MAX_FORM_SERVICES,
  preferredStart,
  resolveIntakeService,
  servicesOfferedOnForm,
} from "../intake-services";

const svc = (id: string, name: string, extra: Partial<{ category: string; active: boolean }> = {}) => ({
  id,
  name,
  category: extra.category ?? "General",
  active: extra.active ?? true,
});

// Towers Realty's library, abridged: two leasing services among office work.
const LIBRARY = [
  svc("wo", "Work Order — Tenant Request", { category: "Maintenance" }),
  svc("em", "Work Order — Emergency Dispatch", { category: "Maintenance" }),
  svc("lease", "Leasing & Tenant Screening", { category: "Leasing" }),
  svc("view", "Apartment Rental Viewing", { category: "Leasing" }),
  svc("nte", "Owner Approval — NTE Review", { category: "Office" }),
  svc("fin", "Financial Reporting & Accounting Review", { category: "Office" }),
  svc("old", "Retired Service", { active: false }),
];

const leasingFields = [
  { key: "name" },
  { key: "serviceType", serviceIds: ["view", "lease"] },
];

describe("formServiceIds / cleanServiceIds", () => {
  it("reads the list off the Service type field", () => {
    expect(formServiceIds(leasingFields)).toEqual(["view", "lease"]);
  });
  it("is empty when the form was never narrowed down", () => {
    expect(formServiceIds([{ key: "serviceType" }])).toEqual([]);
    expect(formServiceIds([{ key: "name" }])).toEqual([]);
    expect(formServiceIds(null)).toEqual([]);
  });
  it("keeps strings only, trimmed, once each, capped", () => {
    expect(cleanServiceIds([" a ", "a", 3, null, "", "b"])).toEqual(["a", "b"]);
    expect(cleanServiceIds("a")).toEqual([]);
    const many = Array.from({ length: MAX_FORM_SERVICES + 20 }, (_, i) => `s${i}`);
    expect(cleanServiceIds(many)).toHaveLength(MAX_FORM_SERVICES);
  });
});

describe("servicesOfferedOnForm", () => {
  it("lists only the form's services, in the company's order", () => {
    expect(servicesOfferedOnForm(LIBRARY, leasingFields).map((s) => s.id)).toEqual(["lease", "view"]);
  });
  it("lists every active service when the form has no list (the old behaviour)", () => {
    const ids = servicesOfferedOnForm(LIBRARY, [{ key: "serviceType" }]).map((s) => s.id);
    expect(ids).toEqual(["wo", "em", "lease", "view", "nte", "fin"]);
  });
  it("drops a listed service once it is retired", () => {
    const ids = servicesOfferedOnForm(LIBRARY, [{ key: "serviceType", serviceIds: ["view", "old"] }]).map((s) => s.id);
    expect(ids).toEqual(["view"]);
  });
});

describe("resolveIntakeService", () => {
  const allowedIds = ["view", "lease"];
  it("books what the visitor picked when the form offers it", () => {
    expect(resolveIntakeService({ picked: "lease", defaultId: "view", allowedIds, services: LIBRARY })?.id).toBe("lease");
  });
  it("ignores a pick from outside the form's list", () => {
    expect(resolveIntakeService({ picked: "nte", defaultId: "view", allowedIds, services: LIBRARY })?.id).toBe("view");
  });
  it("ignores a retired pick", () => {
    expect(resolveIntakeService({ picked: "old", defaultId: "", allowedIds: [], services: LIBRARY })?.id).toBe("wo");
  });
  it("falls back to the form's default, then the first service on its list", () => {
    expect(resolveIntakeService({ picked: "", defaultId: "view", allowedIds, services: LIBRARY })?.id).toBe("view");
    expect(resolveIntakeService({ picked: "", defaultId: "", allowedIds, services: LIBRARY })?.id).toBe("view");
    expect(resolveIntakeService({ picked: "", defaultId: "old", allowedIds: ["lease"], services: LIBRARY })?.id).toBe("lease");
  });
  it("ignores a default the form no longer offers", () => {
    // Set before the form was narrowed down; a forged or skipped pick must not
    // land on it.
    expect(resolveIntakeService({ picked: "", defaultId: "nte", allowedIds, services: LIBRARY })?.id).toBe("view");
    expect(resolveIntakeService({ picked: "fin", defaultId: "nte", allowedIds, services: LIBRARY })?.id).toBe("view");
  });
  it("still lands somewhere when the form's whole list was retired", () => {
    expect(resolveIntakeService({ picked: "", defaultId: "", allowedIds: ["old"], services: LIBRARY })?.id).toBe("wo");
  });
  it("accepts any active pick on a form with no list", () => {
    expect(resolveIntakeService({ picked: "fin", defaultId: "", allowedIds: [], services: LIBRARY })?.id).toBe("fin");
  });
  it("returns nothing when there are no active services", () => {
    expect(resolveIntakeService({ picked: "", defaultId: "", allowedIds: [], services: [] })).toBeUndefined();
  });
});

describe("intakePriority", () => {
  it("is urgent when the service is an emergency", () => {
    expect(intakePriority({ serviceName: "Work Order — Emergency Dispatch" })).toBe("urgent");
    expect(intakePriority({ serviceName: "No heat", serviceCategory: "Emergency" })).toBe("urgent");
  });
  it("is urgent when the form exists for emergencies", () => {
    expect(intakePriority({ serviceName: "Roof repair", formTitle: "Emergency Leak / Storm Damage" })).toBe("urgent");
    expect(intakePriority({ serviceName: "Plumbing", formTitle: "Urgent plumbing help" })).toBe("urgent");
  });
  it("is normal otherwise", () => {
    expect(intakePriority({ serviceName: "Apartment Rental Viewing", formTitle: "Book a Suite Viewing" })).toBe("normal");
    expect(intakePriority({})).toBe("normal");
  });
});

describe("preferredStart", () => {
  it("reads a picked day on the company's clock, at the start of the morning", () => {
    // 9:00 AM on the company's clock, whatever the zone's offset is on that
    // day: read from the zone's rules rather than hardcoded, since tzdata can
    // change them (Winnipeg is UTC-5 in July; December depends on the data).
    const summer = preferredStart("2026-07-15", "America/Winnipeg");
    expect(summer?.dateOnly).toBe(true);
    expect(summer?.at.toISOString()).toBe(localInstant("America/Winnipeg", 2026, 7, 15, 9).toISOString());
    expect(preferredStart("2026-12-01", "America/Winnipeg")?.at.toISOString()).toBe(localInstant("America/Winnipeg", 2026, 12, 1, 9).toISOString());
    // A zone whose winter and summer offsets differ shows it really tracks the day.
    const ny = (d: string) => preferredStart(d, "America/New_York")!.at.toISOString();
    expect(ny("2026-07-15")).toBe(localInstant("America/New_York", 2026, 7, 15, 9).toISOString());
    expect(ny("2026-12-01")).toBe(localInstant("America/New_York", 2026, 12, 1, 9).toISOString());
    // Before, the bare date became UTC midnight: 7 PM the evening before.
    expect(new Date("2026-07-15").toISOString()).toBe("2026-07-15T00:00:00.000Z");
  });
  it("takes a full timestamp as given", () => {
    const at = preferredStart("2026-07-15T18:30:00Z", "America/Winnipeg");
    expect(at?.dateOnly).toBe(false);
    expect(at?.at.toISOString()).toBe("2026-07-15T18:30:00.000Z");
  });
  it("is null for nothing, garbage and impossible days", () => {
    expect(preferredStart(undefined, "America/Winnipeg")).toBeNull();
    expect(preferredStart("  ", "America/Winnipeg")).toBeNull();
    expect(preferredStart("next tuesday", "America/Winnipeg")).toBeNull();
    expect(preferredStart("2026-02-30", "America/Winnipeg")).toBeNull();
  });
});
