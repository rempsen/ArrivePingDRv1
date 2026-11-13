import { describe, expect, test } from "bun:test";
import { TEAM_ALL, teamRequestFromParams } from "../team-filter";

describe("teamRequestFromParams", () => {
  test("a plain tab tap is no request", () => {
    expect(teamRequestFromParams({})).toBeNull();
  });

  test("a status is that filter", () => {
    expect(teamRequestFromParams({ status: "busy" })).toEqual({ filter: "busy" });
  });

  test("the everybody value clears the filter", () => {
    expect(teamRequestFromParams({ status: TEAM_ALL })).toEqual({ filter: null });
  });

  test("an empty status leaves the chip alone but can still pick the view", () => {
    expect(teamRequestFromParams({ status: "" })).toBeNull();
    expect(teamRequestFromParams({ status: "", mode: "list" })).toEqual({ mode: "list" });
  });

  test("the view alone", () => {
    expect(teamRequestFromParams({ mode: "map" })).toEqual({ mode: "map" });
    expect(teamRequestFromParams({ mode: "grid" })).toBeNull();
  });

  test("a filter and a view together", () => {
    expect(teamRequestFromParams({ status: TEAM_ALL, mode: "list" })).toEqual({ filter: null, mode: "list" });
  });
});
