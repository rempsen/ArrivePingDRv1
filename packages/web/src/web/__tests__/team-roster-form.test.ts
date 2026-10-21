import { describe, expect, it } from "bun:test";
import { emptyTeamRow, filledTeamRows, teamRowProblem, teamRowProblems, teamRowsMessage } from "../lib/team-roster-form";

const row = (name: string, phone: string, email: string) => ({ name, phone, email });

describe("team roster form", () => {
  it("ignores empty rows and trims the rest", () => {
    expect(filledTeamRows([emptyTeamRow(), row("  Jo Ng ", " ", " jo@x.com "), emptyTeamRow()])).toEqual([row("Jo Ng", "", "jo@x.com")]);
  });

  it("needs a name and a valid email, but not a phone", () => {
    expect(teamRowProblem(emptyTeamRow())).toBeNull();
    expect(teamRowProblem(row("Jo Ng", "", "jo@x.com"))).toBeNull();
    expect(teamRowProblem(row("", "555", "jo@x.com"))).toBe("Add a name");
    expect(teamRowProblem(row("Jo Ng", "555", ""))).toBe("Add an email so they can log in");
    expect(teamRowProblem(row("Jo Ng", "", "jo@x"))).toBe("That email doesn't look right");
  });

  it("reports problems by row index and skips blank rows", () => {
    expect(teamRowProblems([row("Jo Ng", "", "jo@x.com"), emptyTeamRow(), row("Al", "", "")])).toEqual({ 2: "Add an email so they can log in" });
  });

  it("writes one labelled line per person, leaving out a missing mobile", () => {
    expect(teamRowsMessage([row("Jo Ng", "555-1234", "jo@x.com"), emptyTeamRow(), row("Al Fox", "", "al@x.com")])).toBe(
      "(From the team form)\n- Jo Ng | email: jo@x.com | mobile: 555-1234\n- Al Fox | email: al@x.com",
    );
  });
});
