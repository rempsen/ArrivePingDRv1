import { describe, it, expect } from "bun:test";
import { parseSkills, qualifies } from "../qualify";

describe("parseSkills", () => {
  it("splits CSV, trims, and drops blanks and case-insensitive duplicates", () => {
    expect(parseSkills(" HVAC, electrical ,,hvac, Gas ")).toEqual(["HVAC", "electrical", "Gas"]);
  });
  it("accepts a list and nothing at all", () => {
    expect(parseSkills(["Plumbing", " plumbing", "Boiler"])).toEqual(["Plumbing", "Boiler"]);
    expect(parseSkills(null)).toEqual([]);
    expect(parseSkills(undefined)).toEqual([]);
    expect(parseSkills("")).toEqual([]);
  });
});

describe("qualifies — explicit requirements", () => {
  it("passes when the skill class matches, ignoring case", () => {
    const q = qualifies({ skills: "", skillClass: "hvac" }, { requiredSkillClass: "HVAC" });
    expect(q).toEqual({ qualified: true, missing: [], matched: ["HVAC"], basis: "required" });
  });

  it("names the missing class", () => {
    const q = qualifies({ skills: "Plumbing", skillClass: "Plumbing" }, { requiredSkillClass: "HVAC" });
    expect(q.qualified).toBe(false);
    expect(q.missing).toEqual(["HVAC"]);
    expect(q.basis).toBe("required");
  });

  it("counts a listed skill as meeting a required class", () => {
    expect(qualifies({ skills: "HVAC, Install", skillClass: "Install" }, { requiredSkillClass: "HVAC" }).qualified).toBe(true);
  });

  it("needs every required tag, from CSV or a list", () => {
    const tech = { skills: "HVAC, Gas", skillClass: "HVAC" };
    expect(qualifies(tech, { requiredSkills: "gas, hvac" }).qualified).toBe(true);
    const q = qualifies(tech, { requiredSkillClass: "HVAC", requiredSkills: ["Boiler", "Gas"] });
    expect(q).toEqual({ qualified: false, missing: ["Boiler"], matched: ["HVAC", "Gas"], basis: "required" });
  });

  it("treats General as no requirement and no skill", () => {
    expect(qualifies({ skills: "", skillClass: "General" }, { requiredSkillClass: "General" }).basis).toBe("none");
    const q = qualifies({ skills: "", skillClass: "General" }, { requiredSkillClass: "HVAC" });
    expect(q).toEqual({ qualified: false, missing: ["HVAC"], matched: [], basis: "required" });
  });

  it("doesn't fall back to the category when something is required", () => {
    const q = qualifies({ skills: "Plumbing" }, { requiredSkills: "Plumbing", serviceCategory: "HVAC" });
    expect(q.qualified).toBe(true);
    expect(q.basis).toBe("required");
  });
});

describe("qualifies — service category fallback", () => {
  it("matches the category or its first word", () => {
    expect(qualifies({ skills: "hvac, electrical" }, { serviceCategory: "HVAC Repair" })).toEqual({
      qualified: true,
      missing: [],
      matched: ["HVAC Repair"],
      basis: "category",
    });
    expect(qualifies({ skills: "Preventive Maintenance" }, { serviceCategory: "preventive maintenance" }).qualified).toBe(true);
  });

  it("flags a technician whose listed skills don't cover it", () => {
    expect(qualifies({ skills: "HVAC", skillClass: "HVAC" }, { serviceCategory: "Plumbing" })).toEqual({
      qualified: false,
      missing: ["Plumbing"],
      matched: [],
      basis: "category",
    });
  });

  it("treats a technician with no skills recorded as unknown, not unqualified", () => {
    expect(qualifies({ skills: "", skillClass: "General" }, { serviceCategory: "Plumbing" })).toEqual({
      qualified: true,
      missing: [],
      matched: [],
      basis: "none",
    });
    expect(qualifies({}, { serviceCategory: "Plumbing" }).qualified).toBe(true);
  });

  it("ignores catch-all categories", () => {
    for (const c of ["General", "other", " Misc ", ""]) {
      expect(qualifies({ skills: "HVAC" }, { serviceCategory: c }).basis).toBe("none");
    }
  });
});
