/**
 * Bulk import reads the spreadsheets people already have, not only our
 * template: column names from other tools map onto the template's fields,
 * and the template's own example row is never imported by mistake.
 */
import { describe, it, expect } from "bun:test";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { normalizeImportRow, isTemplateExample } = await import("../import");

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
  });
});
