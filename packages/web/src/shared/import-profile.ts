/**
 * Import templates in each tenant's own shape (Dan, 2026-10-19).
 *
 * The template someone downloads, and the columns an import reads, follow how
 * that tenant's Directory is set up:
 *   - a property manager's resident template is First / Last / Email / Phone /
 *     Property / Unit, named in its words, because a resident's address is the
 *     property's;
 *   - an HVAC company's customer template has the company, website and address
 *     columns its customers need, and no property columns at all;
 *   - the field-staff template keeps a trade's vehicle, plate and licence
 *     columns for technicians, and drops them for coaches or vendors;
 *   - the places import (Properties, Communities, Buildings, Teams) exists only
 *     where the Directory has places.
 * Pure, so the server (templates, imports) and the page (menu labels) agree.
 */
import type { DirectoryVocab } from "./directory-vocab";

export type ImportType = "customer" | "admin" | "rider" | "property";
export type StaffField = "skillClass" | "vehicle" | "licensePlate" | "licenseNumber" | "address" | "payRatePerHour" | "skills";
export const TRADE_STAFF_FIELDS: StaffField[] = ["skillClass", "vehicle", "licensePlate", "licenseNumber", "address", "payRatePerHour", "skills"];

export interface ImportColumn {
  key: string;
  label: string;
  example: string;
}

export interface ImportNouns {
  customer: string;
  customers: string;
  worker: string;
  workers: string;
}

/**
 * Every column each import can read, whatever the template shows: a file with
 * an Address column still imports addresses for a tenant whose template
 * leaves it out. Labels here are the defaults; a profile renames some.
 */
export const IMPORT_FIELDS: Record<ImportType, ImportColumn[]> = {
  customer: [
    { key: "firstName", label: "First Name", example: "Jane" },
    { key: "lastName", label: "Last Name", example: "Doe" },
    { key: "email", label: "Email", example: "jane.doe@example.com" },
    { key: "phone", label: "Phone", example: "+1 555 123 4567" },
    { key: "company", label: "Company", example: "Acme Co." },
    { key: "website", label: "Website", example: "https://acme.com" },
    { key: "address", label: "Address", example: "123 Main St" },
    { key: "city", label: "City", example: "Winnipeg" },
    { key: "region", label: "Province / State", example: "MB" },
    { key: "postalCode", label: "Postal / ZIP", example: "R3C 1A1" },
    { key: "country", label: "Country", example: "Canada" },
    { key: "customerType", label: "Account Type (one_time or repeat)", example: "repeat" },
    // The Directory's place (services/directory.ts), created if it's new, and their unit there.
    { key: "property", label: "Property", example: "Maple Court" },
    { key: "unit", label: "Unit", example: "4B" },
  ],
  property: [
    { key: "name", label: "Property Name", example: "Maple Court" },
    { key: "address", label: "Address", example: "120 Maple St, Winnipeg, MB" },
    { key: "manager", label: "Manager (email or name)", example: "jordan.patel@example.com" },
    { key: "notes", label: "Notes", example: "Lockbox at the side door" },
  ],
  admin: [
    { key: "firstName", label: "First Name", example: "Sam" },
    { key: "lastName", label: "Last Name", example: "Lee" },
    { key: "email", label: "Email", example: "sam.lee@example.com" },
    { key: "phone", label: "Phone", example: "+1 555 987 6543" },
  ],
  rider: [
    { key: "name", label: "Full Name", example: "Alex Chen" },
    { key: "email", label: "Email", example: "alex.chen@example.com" },
    { key: "phone", label: "Phone", example: "+1 555 222 3333" },
    { key: "skillClass", label: "Skill Class", example: "General" },
    { key: "vehicle", label: "Vehicle", example: "Van" },
    { key: "licensePlate", label: "License Plate", example: "ABC123" },
    { key: "licenseNumber", label: "License Number", example: "D1234-56789" },
    { key: "address", label: "Address", example: "456 Elm St" },
    { key: "payRatePerHour", label: "Pay Rate / Hour", example: "28" },
    { key: "skills", label: "Skills (comma separated)", example: "General" },
  ],
};

/** People served one by one (not businesses with a website): no Company / Website / Account Type columns. */
const INDIVIDUALS = /^(residents?|tenants?|occupants?|renters?|unit owners?|condo owners?|strata owners?|members?|parents?|families|homeowners?|buyers?|students?)$/i;
/** Office-type field roles (a property manager): no vehicle or plate columns. */
const DESK_ROLE = /\b(manager|coordinator|agent|administrator|leasing)\b/i;

/** A believable example row for each kind of place. */
const PLACE_EXAMPLES: Record<string, { name: string; address: string; unit: string; notes: string }> = {
  property: { name: "Maple Court", address: "120 Maple St, Winnipeg, MB", unit: "4B", notes: "Lockbox at the side door" },
  building: { name: "Portage Tower", address: "300 Portage Ave, Winnipeg, MB", unit: "210", notes: "Loading dock at the rear" },
  community: { name: "Riverbend Estates", address: "1 Riverbend Dr, Winnipeg, MB", unit: "27", notes: "Show home on lot 1" },
  team: { name: "U12 Thunder", address: "Southdale Arena, Winnipeg, MB", unit: "", notes: "Practice Tuesdays" },
  site: { name: "Main Street Plaza", address: "55 Main St, Winnipeg, MB", unit: "101", notes: "Check in at security" },
};

/** Example name, address and unit for a kind of place (form placeholders, templates). */
export function placeExample(place: string): { name: string; address: string; unit: string; notes: string } {
  return PLACE_EXAMPLES[place.toLowerCase()] ?? PLACE_EXAMPLES.site!;
}

const slugOf = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "people";

export interface ImportProfile {
  /** The imports this tenant has (no places import without places). */
  types: ImportType[];
  /** Menu and sheet labels, in the tenant's words. */
  label: Record<ImportType, string>;
  /** File-name stem for each template. */
  slug: Record<ImportType, string>;
  /** The template's columns, in order. */
  columns: Record<ImportType, ImportColumn[]>;
  /** Whether a customer row's place and unit columns are read. */
  placesEnabled: boolean;
}

export function importProfile(input: {
  vocab: DirectoryVocab;
  nouns: ImportNouns;
  /** The industry's field-staff columns (industry preset `staffFields`). */
  staffFields?: StaffField[] | null;
  /** An example for the Skills column, e.g. the industry's service categories. */
  skillsExample?: string;
}): ImportProfile {
  const { vocab, nouns } = input;
  const f = (type: ImportType, key: string) => ({ ...IMPORT_FIELDS[type].find((c) => c.key === key)! });
  const ex = PLACE_EXAMPLES[vocab.place.toLowerCase()] ?? PLACE_EXAMPLES.site!;
  const individuals = INDIVIDUALS.test(nouns.customer.trim()) || INDIVIDUALS.test(nouns.customers.trim());

  // Customers: who they are, then where they belong, then what a business needs.
  const customer: ImportColumn[] = ["firstName", "lastName", "email", "phone"].map((k) => f("customer", k));
  if (vocab.enabled) {
    customer.push({ key: "property", label: vocab.place, example: ex.name });
    if (vocab.unit) customer.push({ key: "unit", label: vocab.unit, example: ex.unit });
  }
  if (!individuals) customer.push(f("customer", "company"), f("customer", "website"));
  // Someone who lives in a unit has the place's address; everyone else gives theirs.
  if (!(vocab.enabled && vocab.unit)) for (const k of ["address", "city", "region", "postalCode", "country"]) customer.push(f("customer", k));
  if (!individuals) customer.push(f("customer", "customerType"));

  // The company's own word for its field people wins: "Property Managers" get no van or skills columns even in a vendor-led industry.
  const staffFields = DESK_ROLE.test(nouns.worker) ? (["address"] as StaffField[]) : (input.staffFields ?? TRADE_STAFF_FIELDS);
  const rider: ImportColumn[] = ["name", "email", "phone"].map((k) => f("rider", k));
  for (const k of TRADE_STAFF_FIELDS) {
    if (!staffFields.includes(k)) continue;
    const col = f("rider", k);
    if (k === "skills" && input.skillsExample) col.example = input.skillsExample;
    rider.push(col);
  }

  const property: ImportColumn[] = [
    { key: "name", label: `${vocab.place} Name`, example: ex.name },
    { key: "address", label: "Address", example: ex.address },
    { key: "manager", label: `${vocab.manager} (email or name)`, example: f("property", "manager").example },
    { key: "notes", label: "Notes", example: ex.notes },
  ];

  const label: Record<ImportType, string> = { customer: nouns.customers, rider: nouns.workers, admin: "Office staff", property: vocab.places };
  return {
    types: ["customer", "rider", "admin", ...(vocab.enabled ? (["property"] as ImportType[]) : [])],
    label,
    slug: { customer: slugOf(nouns.customers), rider: slugOf(nouns.workers), admin: "office-staff", property: slugOf(vocab.places) },
    columns: { customer, rider, admin: IMPORT_FIELDS.admin.map((c) => ({ ...c })), property },
    placesEnabled: vocab.enabled,
  };
}
