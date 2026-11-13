import { describe, expect, test } from "bun:test";
import { requestTeamFilter, takeTeamFilterRequest } from "../team-filter";

describe("team filter request", () => {
  test("nothing is waiting until Today asks", () => {
    expect(takeTeamFilterRequest()).toBeUndefined();
  });

  test("null means everybody, and is told apart from no request", () => {
    requestTeamFilter(null);
    expect(takeTeamFilterRequest()).toEqual({ status: null });
  });

  test("a status is passed through", () => {
    requestTeamFilter("busy");
    expect(takeTeamFilterRequest()).toEqual({ status: "busy" });
  });

  test("it is consumed once, so a later visit keeps the last chip", () => {
    requestTeamFilter("busy");
    takeTeamFilterRequest();
    expect(takeTeamFilterRequest()).toBeUndefined();
  });

  test("the newest request wins", () => {
    requestTeamFilter("busy");
    requestTeamFilter(null);
    expect(takeTeamFilterRequest()).toEqual({ status: null });
  });
});
