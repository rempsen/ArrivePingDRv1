/**
 * Directory wording per tenant (Dan, 2026-10-19): an HVAC company's Directory
 * has no properties, residents or property managers; a property manager's
 * does, and a builder's says communities and lots. And the import templates
 * people download match how their Directory is set up.
 */
import { describe, it, expect } from "bun:test";
import { resolveDirectoryVocab, pluralOf, aWord, PROPERTY_PLACES } from "../directory-vocab";
import { importProfile, TRADE_STAFF_FIELDS } from "../import-profile";
import { INDUSTRY_PRESETS, getIndustryPreset } from "../../services/industry-presets";

const vocabFor = (industry: string, nouns: { customer?: string; worker?: string } = {}, extra: { mode?: string; hasPlaces?: boolean } = {}) => {
  const p = getIndustryPreset(industry);
  return resolveDirectoryVocab({
    industryPlaces: p?.places,
    customerNoun: nouns.customer ?? p?.customerNoun,
    workerNoun: nouns.worker ?? p?.workerNoun,
    ...extra,
  });
};

describe("which tenants have places, and what they're called", () => {
  it("trades (HVAC, plumbing, electrical, landscaping…) have none", () => {
    for (const id of ["hvac-plumbing", "electrical", "landscaping-grounds-snow", "renovation-contractor", "garage-door", "restoration", "childcare-babysitting"]) {
      expect([id, vocabFor(id).enabled]).toEqual([id, false]);
    }
  });

  it("industries that work by place use their own words", () => {
    const pick = (id: string) => {
      const v = vocabFor(id);
      return [v.enabled, v.place, v.places, v.unit, v.manager];
    };
    expect(pick("property-management-maintenance")).toEqual([true, "Property", "Properties", "Unit", "Property Manager"]);
    expect(pick("home-builder-developer")).toEqual([true, "Community", "Communities", "Lot", "Superintendent"]);
    expect(pick("commercial-building-maintenance")).toEqual([true, "Building", "Buildings", "Suite", "Account Manager"]);
    expect(pick("sports-organization")).toEqual([true, "Team", "Teams", null, "Coach"]);
  });

  it("a company whose own words say residents gets properties, whatever its industry (like Towers Realty)", () => {
    const v = vocabFor("other", { customer: "Resident", worker: "Property Manager" });
    expect([v.enabled, v.reason, v.place, v.manager]).toEqual([true, "nouns", "Property", "Property Manager"]);
    expect(vocabFor("", { customer: "Tenant" }).enabled).toBe(true);
  });

  it("an HVAC company that already has places keeps seeing them, as Sites", () => {
    const v = vocabFor("hvac-plumbing", {}, { hasPlaces: true });
    expect([v.enabled, v.reason, v.place, v.unit, v.manager]).toEqual([true, "data", "Site", "Unit", "Account Manager"]);
  });

  it("Settings can turn it on or off", () => {
    expect(vocabFor("hvac-plumbing", {}, { mode: "on" })).toMatchObject({ enabled: true, reason: "setting-on", place: "Site" });
    expect(vocabFor("property-management-maintenance", {}, { mode: "off", hasPlaces: true })).toMatchObject({ enabled: false, reason: "setting-off" });
    expect(vocabFor("hvac-plumbing", {}, { mode: "nonsense" }).enabled).toBe(false);
  });

  it("every preset with places names all of them", () => {
    for (const p of INDUSTRY_PRESETS.filter((x) => x.places)) {
      expect([p.id, !!p.places!.place && !!p.places!.places && !!p.places!.manager]).toEqual([p.id, true]);
    }
  });

  it("plurals and articles read right", () => {
    expect([pluralOf("Coach"), pluralOf("Property"), pluralOf("Superintendent"), pluralOf("Lot")]).toEqual(["Coaches", "Properties", "Superintendents", "Lots"]);
    expect([aWord("Property"), aWord("Account Manager")]).toEqual(["a property", "an account manager"]);
  });
});

describe("import templates follow the Directory", () => {
  const profileFor = (industry: string, nouns?: { customer: string; customers: string; worker: string; workers: string }, extra: { hasPlaces?: boolean; mode?: string } = {}) => {
    const p = getIndustryPreset(industry);
    const n = nouns ?? { customer: p!.customerNoun, customers: p!.customerNounPlural, worker: p!.workerNoun, workers: p!.workerNounPlural };
    return importProfile({ vocab: vocabFor(industry, { customer: n.customer, worker: n.worker }, extra), nouns: n, staffFields: p?.staffFields });
  };
  const labels = (cols: { label: string }[]) => cols.map((c) => c.label);

  it("a property manager's residents: who they are and where they live, nothing a business needs", () => {
    const pr = profileFor("other", { customer: "Resident", customers: "Residents", worker: "Property Manager", workers: "Property Managers" });
    expect(labels(pr.columns.customer)).toEqual(["First Name", "Last Name", "Email", "Phone", "Property", "Unit"]);
    expect(pr.label).toMatchObject({ customer: "Residents", rider: "Property Managers", property: "Properties" });
    expect(pr.types).toEqual(["customer", "rider", "admin", "property"]);
    expect(pr.slug.customer).toBe("residents");
    // Property managers aren't a van crew.
    expect(labels(pr.columns.rider)).toEqual(["Full Name", "Email", "Phone", "Address"]);
  });

  it("an HVAC company's customers: business and address columns, no property, no places import", () => {
    const pr = profileFor("hvac-plumbing");
    expect(labels(pr.columns.customer)).toEqual([
      "First Name", "Last Name", "Email", "Phone", "Company", "Website", "Address", "City", "Province / State", "Postal / ZIP", "Country",
      "Account Type (one_time or repeat)",
    ]);
    expect(pr.types).toEqual(["customer", "rider", "admin"]);
    expect(pr.placesEnabled).toBe(false);
    expect(pr.columns.rider.map((c) => c.key)).toEqual(["name", "email", "phone", ...TRADE_STAFF_FIELDS]);
    expect(pr.label).toMatchObject({ customer: "Customers", rider: "Technicians" });
  });

  it("a builder's buyers: Community and Lot", () => {
    const pr = profileFor("home-builder-developer");
    expect(labels(pr.columns.customer)).toEqual(["First Name", "Last Name", "Email", "Phone", "Community", "Lot"]);
    expect(labels(pr.columns.property)).toEqual(["Community Name", "Address", "Superintendent (email or name)", "Notes"]);
    expect(pr.slug.property).toBe("communities");
  });

  it("a club's members: a Team (no unit) and their own address; coaches without vehicles", () => {
    const pr = profileFor("sports-organization");
    expect(labels(pr.columns.customer)).toEqual(["First Name", "Last Name", "Email", "Phone", "Team", "Address", "City", "Province / State", "Postal / ZIP", "Country"]);
    expect(pr.columns.rider.map((c) => c.key)).toEqual(["name", "email", "phone", "payRatePerHour", "skills"]);
  });

  it("commercial maintenance: site contacts at a building's suite, with their company", () => {
    const pr = profileFor("commercial-building-maintenance");
    expect(labels(pr.columns.customer)).toEqual(["First Name", "Last Name", "Email", "Phone", "Building", "Suite", "Company", "Website", "Account Type (one_time or repeat)"]);
  });

  it("an HVAC company that turns places on gets Site / Unit columns", () => {
    const pr = profileFor("hvac-plumbing", undefined, { mode: "on" });
    expect(pr.types).toContain("property");
    expect(labels(pr.columns.customer)).toContain("Site");
  });

  it("the property-management preset's own words stay PROPERTY_PLACES", () => {
    expect(getIndustryPreset("property-management-maintenance")!.places).toEqual(PROPERTY_PLACES);
  });
});
