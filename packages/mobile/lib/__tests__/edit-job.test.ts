import { describe, expect, test } from "bun:test";
import { buildPatch, draftFromBooking, isEmptyPatch, setFieldValue, validateEdit, type EditDraft } from "../edit-job";
import { customLine, parseLineItems, sumLineItems, withTotals } from "../line-items";

const booking = {
  title: "Furnace tune-up",
  priority: "high",
  status: "confirmed",
  address: "12 Main St",
  lat: 49.9,
  lng: -97.1,
  customerPhone: "204 555 0100",
  scheduledAt: "2026-10-23T15:00:00.000Z",
  notes: "Gate code 1234",
  staffNotes: "",
  customerId: "c1",
  service: { id: "s1", name: "Tune-up" },
  customer: { id: "c1", name: "Pat", phone: "204 555 0199" },
  fieldData: JSON.stringify({
    _customFields: [
      { id: "f1", type: "text", label: "Model", required: true },
      { id: "f2", type: "file", label: "Photo" },
    ],
    f1: "X200",
    __la_push_start_token: "secret",
  }),
  lineItems: JSON.stringify([{ itemId: "i1", kind: "part", name: "Filter", sku: "F-1", unit: "ea", qty: 2, unitCost: 4, unitPrice: 10, taxable: true, cost: 8, price: 20 }]),
};

describe("draftFromBooking", () => {
  test("reads the row, strips internal keys, parses JSON strings", () => {
    const d = draftFromBooking(booking);
    expect(d.priority).toBe("high");
    expect(d.customerPhone).toBe("204 555 0100");
    expect(d.fieldData).toEqual({ _customFields: booking && JSON.parse(booking.fieldData)._customFields, f1: "X200" });
    expect(d.fields.map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(d.lineItems).toHaveLength(1);
    expect(d.lineItems[0]!.price).toBe(20);
  });
  test("tolerates empty or broken JSON and an odd priority", () => {
    const d = draftFromBooking({ ...booking, priority: "weird", fieldData: "{not json", lineItems: "" });
    expect(d.priority).toBe("normal");
    expect(d.fieldData).toEqual({});
    expect(d.lineItems).toEqual([]);
  });
});

describe("validateEdit", () => {
  const base = draftFromBooking(booking);
  test("a clean draft has no errors", () => {
    expect(validateEdit(base)).toEqual({});
  });
  test("address, phone, lines and required fields", () => {
    const bad: EditDraft = { ...base, address: " ", customerPhone: "abc", lineItems: [{ ...base.lineItems[0]!, qty: 0 }] };
    const e = validateEdit(setFieldValue(bad, "f1", ""));
    expect(e.address).toBeDefined();
    expect(e.customerPhone).toBeDefined();
    expect(e.lineItems).toBeDefined();
    expect(e.fields).toContain("Model");
  });
  test("the common North American phone form passes; a bad one only matters when it changed", () => {
    expect(validateEdit({ ...base, customerPhone: "(204) 632-9434" }, base).customerPhone).toBeUndefined();
    expect(validateEdit({ ...base, customerPhone: "abc" }, base).customerPhone).toBeDefined();
    const odd = { ...base, customerPhone: "abc" };
    expect(validateEdit({ ...odd, notes: "changed" }, odd).customerPhone).toBeUndefined();
  });
  test("a title the job had can't be cleared", () => {
    expect(validateEdit({ ...base, title: " " }, base).title).toBeDefined();
    const untitled = { ...base, title: "" };
    expect(validateEdit(untitled, untitled).title).toBeUndefined();
  });
  test("a required photo field isn't the editor's problem", () => {
    const d = { ...base, fields: [{ id: "f2", type: "file", label: "Photo", required: true }] };
    expect(validateEdit(d)).toEqual({});
  });
});

describe("buildPatch", () => {
  const original = draftFromBooking(booking);
  test("nothing changed → empty patch", () => {
    const p = buildPatch(original, original);
    expect(isEmptyPatch(p)).toBe(true);
  });
  test("only the changed keys, with the address carrying coordinates only when it has them", () => {
    const d: EditDraft = { ...original, title: "Furnace tune-up ", notes: "Gate code 4321", address: "99 Elm", lat: null, lng: null };
    const p = buildPatch(d, original);
    expect(p).toEqual({ title: "Furnace tune-up", notes: "Gate code 4321", address: "99 Elm" });
  });
  test("a field edit sends fieldData whole; a line edit sends lineItems recomputed", () => {
    const d = setFieldValue({ ...original, lineItems: [{ ...original.lineItems[0]!, qty: 3 }] }, "f1", "X300");
    const p = buildPatch(d, original, { force: true });
    expect(p.fieldData).toEqual({ ...original.fieldData, f1: "X300" });
    expect(p.lineItems![0]).toMatchObject({ qty: 3, cost: 12, price: 30 });
    expect(p.force).toBe(true);
    expect(isEmptyPatch(p)).toBe(false);
  });
  test("status never rides along in the patch", () => {
    const p = buildPatch({ ...original, status: "completed" }, original);
    expect(isEmptyPatch(p)).toBe(true);
  });
});

describe("line items", () => {
  test("totals", () => {
    const items = [withTotals(customLine("Trip fee", 1, 45)), withTotals({ ...parseLineItems(booking.lineItems)[0]!, taxable: false })];
    expect(sumLineItems(items)).toEqual({ cost: 8, price: 65, taxablePrice: 45, margin: 57 });
  });
  test("rounding", () => {
    expect(withTotals(customLine("x", 3, 0.1)).price).toBe(0.3);
  });
});
