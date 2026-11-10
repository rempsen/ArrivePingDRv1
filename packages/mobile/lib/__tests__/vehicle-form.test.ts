import { describe, expect, test } from "bun:test";
import { formFromRider, vehiclePatch, vehicleProblem, vehicleUnchanged } from "../vehicle-form";

/**
 * A technician edits their own vehicle from Profile. The server rejects a
 * blank make and model but lets the colour and plate go blank, and stores the
 * plate upper-cased; the form has to agree with it so Save never sends a
 * request the server will refuse.
 */

const rider = { vehicle: "Ford Transit", vehicleColor: "White", licensePlate: "ABC 123" };

describe("formFromRider", () => {
  test("starts from what's on file", () => {
    expect(formFromRider(rider)).toEqual({ vehicle: "Ford Transit", vehicleColor: "White", licensePlate: "ABC 123" });
  });

  test("tolerates a profile that hasn't loaded or has nulls", () => {
    const blank = { vehicle: "", vehicleColor: "", licensePlate: "" };
    expect(formFromRider(undefined)).toEqual(blank);
    expect(formFromRider({ vehicle: null, vehicleColor: null, licensePlate: null })).toEqual(blank);
  });
});

describe("vehicleProblem", () => {
  test("accepts a full vehicle", () => {
    expect(vehicleProblem(formFromRider(rider))).toBeNull();
  });

  test("accepts a blank colour and plate", () => {
    expect(vehicleProblem({ vehicle: "Ford Transit", vehicleColor: "", licensePlate: "" })).toBeNull();
  });

  test("needs a make and model", () => {
    expect(vehicleProblem({ vehicle: "", vehicleColor: "White", licensePlate: "" })).toContain("make and model");
    expect(vehicleProblem({ vehicle: "  ", vehicleColor: "", licensePlate: "" })).toContain("make and model");
    expect(vehicleProblem({ vehicle: "F", vehicleColor: "", licensePlate: "" })).toContain("make and model");
  });

  test("catches fields the server would refuse as too long", () => {
    expect(vehicleProblem({ vehicle: "x".repeat(121), vehicleColor: "", licensePlate: "" })).toContain("120");
    expect(vehicleProblem({ vehicle: "Van", vehicleColor: "x".repeat(41), licensePlate: "" })).toContain("40");
    expect(vehicleProblem({ vehicle: "Van", vehicleColor: "", licensePlate: "x".repeat(33) })).toContain("32");
  });

  test("measures length after trimming, as the server does", () => {
    expect(vehicleProblem({ vehicle: `  ${"x".repeat(120)}  `, vehicleColor: "", licensePlate: "" })).toBeNull();
  });
});

describe("vehiclePatch", () => {
  test("trims and upper-cases the plate", () => {
    expect(vehiclePatch({ vehicle: "  Ram ProMaster ", vehicleColor: " Grey ", licensePlate: " xyz 789 " })).toEqual({
      vehicle: "Ram ProMaster",
      vehicleColor: "Grey",
      licensePlate: "XYZ 789",
    });
  });

  test("keeps blank colour and plate blank so they clear on the server", () => {
    expect(vehiclePatch({ vehicle: "Van", vehicleColor: "  ", licensePlate: "" })).toEqual({
      vehicle: "Van",
      vehicleColor: "",
      licensePlate: "",
    });
  });
});

describe("vehicleUnchanged", () => {
  test("is true for the values already on file", () => {
    expect(vehicleUnchanged(formFromRider(rider), rider)).toBe(true);
  });

  test("ignores whitespace and plate case", () => {
    expect(vehicleUnchanged({ vehicle: " Ford Transit ", vehicleColor: "White ", licensePlate: "abc 123" }, rider)).toBe(true);
  });

  test("is false once anything changes, including clearing a field", () => {
    expect(vehicleUnchanged({ ...formFromRider(rider), vehicleColor: "Grey" }, rider)).toBe(false);
    expect(vehicleUnchanged({ ...formFromRider(rider), licensePlate: "" }, rider)).toBe(false);
  });
});
