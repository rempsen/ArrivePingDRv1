/**
 * Bulk import reads the spreadsheets people already have, not only our
 * template: column names from other tools map onto the template's fields,
 * and the template's own example row is never imported by mistake.
 */
import { describe, it, expect } from "bun:test";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { normalizeImportRow, isTemplateExample, parseCsv, rowsFromGrid } = await import("../import");

describe("normalizeImportRow", () => {
  it("keeps the template's own column keys as they are", () => {
    expect(normalizeImportRow("customer", { firstName: "Ava", lastName: "Desjardins", email: "ava@x.ca", phone: "204-555-0112", postalCode: "R3T 2N2" })).toEqual({
      firstName: "Ava", lastName: "Desjardins", email: "ava@x.ca", phone: "204-555-0112", postalCode: "R3T 2N2", name: "Ava Desjardins",
    });
  });

  it("reads the column names another system's export uses, in any case or punctuation", () => {
    const row = normalizeImportRow("customer", {
      "First Name": "Ben", "LAST_NAME": "Kowalczyk", "E-mail Address": "ben@x.ca", "Mobile Phone": "(204) 555-0107",
      "Street Address": "142 Maple Ave", "Town": "Winnipeg", "Province": "MB", "ZIP / Postal Code": "R2M 0A1",
      "Company Name": "Kowalczyk Holdings", "Notes": "gate code 1234",
    });
    expect(row).toEqual({
      firstName: "Ben", lastName: "Kowalczyk", name: "Ben Kowalczyk", email: "ben@x.ca", phone: "(204) 555-0107",
      address: "142 Maple Ave", city: "Winnipeg", region: "MB", postalCode: "R2M 0A1", company: "Kowalczyk Holdings",
    });
  });

  it("matches the template's labels too (as the Excel template writes them)", () => {
    expect(normalizeImportRow("customer", { "Postal / ZIP": "R3T", "Province / State": "MB", "Account Type (one_time or repeat)": "Repeat" })).toEqual({
      postalCode: "R3T", region: "MB", customerType: "repeat",
    });
  });

  it("builds a technician's full name from first and last name columns", () => {
    expect(normalizeImportRow("rider", { "First Name": "Alex", "Last Name": "Chen", "Cell": "204 555 3333", "Hourly Rate": "28" })).toEqual({
      firstName: "Alex", lastName: "Chen", name: "Alex Chen", phone: "204 555 3333", payRatePerHour: "28",
    });
  });

  it("takes the first non-empty column when two mean the same thing", () => {
    expect(normalizeImportRow("customer", { "Phone": "", "Mobile": "204-555-0122", "Cell": "204-555-9999" }).phone).toBe("204-555-0122");
  });

  it("reads account type loosely, defaulting to one-time", () => {
    expect(normalizeImportRow("customer", { "Customer Type": "Recurring" }).customerType).toBe("repeat");
    expect(normalizeImportRow("customer", { "Customer Type": "residential" }).customerType).toBe("one_time");
  });

  it("keeps only the fields this kind of import has", () => {
    expect(normalizeImportRow("customer", { Skills: "HVAC", "Hourly Rate": "28" })).toEqual({});
    expect(normalizeImportRow("rider", { Company: "Acme", City: "Winnipeg", Name: "Alex" })).toEqual({ name: "Alex" });
  });

  it("reads a resident list's building and unit columns, whatever they're called", () => {
    expect(normalizeImportRow("customer", { "Resident Name": "Zoe Adams", Building: "Maple Court", "Apt #": "4B" })).toEqual({
      name: "Zoe Adams", property: "Maple Court", unit: "4B",
    });
    expect(normalizeImportRow("customer", { Tenant: "Ben", Community: "Birch Towers", Suite: "210" })).toEqual({ name: "Ben", property: "Birch Towers", unit: "210" });
  });

  it("a property list: its Property or Building column is the name; manager and notes come through", () => {
    expect(normalizeImportRow("property", { Property: "Maple Court", "Property Address": "12 Maple St", "Property Manager": "jordan@x.ca", Notes: "Lockbox" })).toEqual({
      name: "Maple Court", address: "12 Maple St", manager: "jordan@x.ca", notes: "Lockbox",
    });
    expect(normalizeImportRow("property", { "Building Name": "Birch Towers", PM: "Sam Ortiz" })).toEqual({ name: "Birch Towers", manager: "Sam Ortiz" });
    // People's columns don't make a property row.
    expect(normalizeImportRow("property", { Email: "a@b.ca", Phone: "204" })).toEqual({});
  });

  it("drops columns it doesn't know and blank cells", () => {
    expect(normalizeImportRow("customer", { "Balance Owing": "120.00", "Name": "  " })).toEqual({});
  });
});

describe("isTemplateExample", () => {
  it("spots the example row left in the downloaded template", () => {
    expect(isTemplateExample("customer", { email: "Jane.Doe@example.com" })).toBe(true);
    expect(isTemplateExample("rider", { email: "alex.chen@example.com" })).toBe(true);
    expect(isTemplateExample("customer", { email: "jane@realcustomer.ca" })).toBe(false);
    expect(isTemplateExample("customer", {})).toBe(false);
    expect(isTemplateExample("property", { name: "Maple Court", manager: "Jordan.Patel@example.com" })).toBe(true);
    expect(isTemplateExample("property", { name: "Maple Court", manager: "jordan@realco.ca" })).toBe(false);
  });
});

describe("finding the header row", () => {
  it("a plain CSV: header on line 1, rows keep their own line numbers past blank lines", () => {
    expect(parseCsv("First Name,Email\nAva,ava@x.ca\n\nBen,ben@x.ca\n")).toEqual([
      { line: 2, row: { "First Name": "Ava", Email: "ava@x.ca" } },
      { line: 4, row: { "First Name": "Ben", Email: "ben@x.ca" } },
    ]);
  });

  it("skips a title line above the headers (our Excel templates have one)", () => {
    expect(parseCsv("Residents import template,,,\nFirst Name,Last Name,Property,Unit\nAva,Adams,Maple Court,4B")).toEqual([
      { line: 3, row: { "First Name": "Ava", "Last Name": "Adams", Property: "Maple Court", Unit: "4B" } },
    ]);
    // A merged title cell reads back as the same value in every column.
    const t = "Customers import template";
    expect(rowsFromGrid([{ line: 1, cells: [t, t, t] }, { line: 2, cells: ["Name", "Email", "Phone"] }, { line: 3, cells: ["Ava", "ava@x.ca", ""] }])).toEqual([
      { line: 3, row: { Name: "Ava", Email: "ava@x.ca", Phone: "" } },
    ]);
  });

  it("a one-column file still uses its first line as the header", () => {
    expect(parseCsv("Email\nava@x.ca")).toEqual([{ line: 2, row: { Email: "ava@x.ca" } }]);
  });
});
