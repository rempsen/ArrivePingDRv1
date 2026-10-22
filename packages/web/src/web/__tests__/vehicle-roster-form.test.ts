import { describe, expect, it } from "bun:test";
import { VEHICLES_SKIPPED_MESSAGE, emptyVehicleRow, filledVehicleRows, vehicleRowProblem, vehicleRowProblems, vehicleRowsMessage } from "../lib/vehicle-roster-form";

const row = (who: string, makeModel: string, plate: string, color = "") => ({ who, makeModel, color, plate });

describe("vehicle roster form", () => {
  it("treats a named person with nothing typed as skipped, not an error", () => {
    expect(vehicleRowProblem(emptyVehicleRow("Jo Ng"))).toBeNull();
    expect(filledVehicleRows([emptyVehicleRow("Jo Ng")])).toEqual([]);
  });

  it("needs a make and model, but not a plate", () => {
    expect(vehicleRowProblem(row("Jo", "Ford Transit", ""))).toBeNull();
    expect(vehicleRowProblem(row("Jo", "", "ABC123"))).toBe("Add the make and model");
    expect(vehicleRowProblems([row("A", "Van", ""), emptyVehicleRow("B"), row("C", "", "X1")])).toEqual({ 2: "Add the make and model" });
  });

  it("trims and upper-cases plates", () => {
    expect(filledVehicleRows([row(" Jo ", " Ford Transit ", " abc 123 ", " white ")])).toEqual([row("Jo", "Ford Transit", "ABC 123", "white")]);
  });

  it("doesn't count a colour alone as a vehicle", () => {
    expect(vehicleRowProblem(row("Jo", "", "", "white"))).toBe("Add the make and model");
  });

  it("writes one labelled line per vehicle", () => {
    expect(vehicleRowsMessage([row("Jo Ng", "Ford Transit", "abc123", "White"), emptyVehicleRow("Skipped"), row("", "Ram 1500", "")])).toBe(
      "(From the vehicle form)\n- Jo Ng: Ford Transit | colour: White | plate: ABC123\n- (not assigned to anyone): Ram 1500",
    );
  });

  it("has a skip message the concierge can recognise", () => {
    expect(VEHICLES_SKIPPED_MESSAGE.startsWith("(From the vehicle form)")).toBe(true);
  });
});
