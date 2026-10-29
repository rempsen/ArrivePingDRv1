import { describe, expect, test } from "bun:test";
import { DEFAULT_SKILL_CLASSES, cleanSkillClasses, parseSkillClasses, renameSkillClass } from "../skill-classes";

describe("skill classes", () => {
  test("nothing stored, or garbage stored: the defaults", () => {
    expect(parseSkillClasses("")).toEqual([...DEFAULT_SKILL_CLASSES]);
    expect(parseSkillClasses("not json")).toEqual([...DEFAULT_SKILL_CLASSES]);
    expect(parseSkillClasses("[]")).toEqual([...DEFAULT_SKILL_CLASSES]);
    expect(parseSkillClasses(null)).toEqual([...DEFAULT_SKILL_CLASSES]);
  });
  test("a company's own list, in its order", () => {
    expect(parseSkillClasses(JSON.stringify(["Carpet Installation", "LVP Installation", "Tile Installation"]))).toEqual(["Carpet Installation", "LVP Installation", "Tile Installation"]);
  });
  test("cleaning: trims, collapses spaces, drops blanks and repeats", () => {
    expect(cleanSkillClasses(["  Sheet  Vinyl ", "", "sheet vinyl", "Wall Base"])).toEqual(["Sheet Vinyl", "Wall Base"]);
  });
  test("rename keeps the place; renaming onto an existing class merges", () => {
    expect(renameSkillClass(["A", "B", "C"], "B", "Beta")).toEqual(["A", "Beta", "C"]);
    expect(renameSkillClass(["A", "B", "C"], "B", "c")).toEqual(["A", "C"]);
    expect(renameSkillClass(["A", "B"], "b", "B ")).toEqual(["A", "B"]);
  });
});
