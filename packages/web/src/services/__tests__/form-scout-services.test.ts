/**
 * Onboarding's form scout names the services each starter form offers. These
 * cover how its answer is settled against the company's real service library:
 * only real names survive, the default is always offered, and the Service
 * type field (which carries the list) is always there but only shown when
 * there is a choice to make.
 */
import { describe, it, expect } from "bun:test";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { settleServices, libraryNames, fallbackStarterForms, starterFormServiceIds } = await import("../form-scout");

const NAMES = ["Work Order — Tenant Request", "Apartment Rental Viewing", "Leasing & Tenant Screening", "Owner Approval — NTE Review"];

const base = (keys: string[]) => ({
  title: "Book a Suite Viewing",
  slug: "book-a-suite-viewing",
  intro: "",
  successMessage: "Thanks!",
  fields: keys.map((key) => ({ key, label: key, enabled: true, required: ["name", "email", "phone", "address"].includes(key) })),
});

describe("libraryNames", () => {
  it("keeps real names once each, in library order", () => {
    expect(
      libraryNames([
        { name: " Viewing ", category: "Leasing" },
        { name: "Viewing", category: "Leasing" },
        { name: "", category: "x" },
        { name: "Screening", category: "Leasing" },
      ]),
    ).toEqual(["Viewing", "Screening"]);
    expect(libraryNames(null)).toEqual([]);
  });
});

describe("settleServices", () => {
  it("keeps the picked services and the default, and shows the dropdown for a real choice", () => {
    const f = settleServices(
      base(["name", "email", "phone", "address", "serviceType"]),
      { serviceNames: ["Apartment Rental Viewing", "Leasing & Tenant Screening"], defaultServiceName: "Apartment Rental Viewing" },
      NAMES,
    );
    expect(f.serviceNames).toEqual(["Apartment Rental Viewing", "Leasing & Tenant Screening"]);
    expect(f.defaultServiceName).toBe("Apartment Rental Viewing");
    expect(f.fields.find((x) => x.key === "serviceType")?.enabled).toBe(true);
  });

  it("drops names that aren't in the library", () => {
    const f = settleServices(
      base(["name", "email", "phone", "address", "serviceType"]),
      { serviceNames: ["Apartment Rental Viewing", "Made Up Service", "Leasing & Tenant Screening"], defaultServiceName: "Made Up Service" },
      NAMES,
    );
    expect(f.serviceNames).toEqual(["Apartment Rental Viewing", "Leasing & Tenant Screening"]);
    expect(f.defaultServiceName).toBe("Apartment Rental Viewing");
  });

  it("always offers the default", () => {
    const f = settleServices(
      base(["name", "email", "phone", "address", "serviceType"]),
      { serviceNames: ["Leasing & Tenant Screening"], defaultServiceName: "Apartment Rental Viewing" },
      NAMES,
    );
    expect(f.serviceNames).toEqual(["Apartment Rental Viewing", "Leasing & Tenant Screening"]);
  });

  it("with one service, keeps a hidden Service type field to carry it", () => {
    const f = settleServices(
      base(["name", "email", "phone", "address", "notes"]),
      { serviceNames: [], defaultServiceName: "Apartment Rental Viewing" },
      NAMES,
    );
    expect(f.serviceNames).toEqual(["Apartment Rental Viewing"]);
    const svc = f.fields.find((x) => x.key === "serviceType");
    expect(svc?.enabled).toBe(false);
    // placed after the address, where the editor shows it
    expect(f.fields.map((x) => x.key)).toEqual(["name", "email", "phone", "address", "serviceType", "notes"]);
  });

  it("hides a requested dropdown that would have one choice", () => {
    const f = settleServices(
      base(["name", "email", "phone", "address", "serviceType"]),
      { serviceNames: ["Apartment Rental Viewing"], defaultServiceName: "Apartment Rental Viewing" },
      NAMES,
    );
    expect(f.fields.find((x) => x.key === "serviceType")?.enabled).toBe(false);
  });

  it("changes nothing when the company has no service library", () => {
    const b = base(["name", "email", "phone", "address", "serviceType"]);
    const f = settleServices(b, { serviceNames: ["Anything"], defaultServiceName: "Anything" }, []);
    expect(f.serviceNames).toEqual([]);
    expect(f.defaultServiceName).toBe("");
    expect(f.fields).toEqual(b.fields);
  });
});

describe("fallbackStarterForms", () => {
  it("offers every service, as before, when the model is unavailable", () => {
    for (const f of fallbackStarterForms({ name: "Acme" })) {
      expect(f.serviceNames).toEqual([]);
      expect(f.defaultServiceName).toBe("");
    }
  });
});

describe("starterFormServiceIds", () => {
  const library = [
    { id: "s-view", name: "Apartment Rental Viewing" },
    { id: "s-lease", name: "Leasing & Tenant Screening" },
    { id: "s-nte", name: "Owner Approval — NTE Review" },
  ];
  it("stores the names as ids on the Service type field, and the default", () => {
    const out = starterFormServiceIds(
      {
        fields: base(["name", "email", "phone", "address", "serviceType"]).fields,
        serviceNames: ["Apartment Rental Viewing", "Leasing & Tenant Screening", "Gone"],
        defaultServiceName: "Apartment Rental Viewing",
      },
      library,
    );
    expect(out.fields.find((f) => f.key === "serviceType")?.serviceIds).toEqual(["s-view", "s-lease"]);
    expect(out.fields.find((f) => f.key === "name")).not.toHaveProperty("serviceIds");
    expect(out.defaultServiceId).toBe("s-view");
  });
  it("an unnarrowed form stays unnarrowed", () => {
    const out = starterFormServiceIds({ fields: base(["name", "serviceType"]).fields, serviceNames: [], defaultServiceName: "" }, library);
    expect(out.fields.find((f) => f.key === "serviceType")?.serviceIds).toEqual([]);
    expect(out.defaultServiceId).toBe("");
  });
});
