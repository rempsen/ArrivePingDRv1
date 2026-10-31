/**
 * LINKS INTO THE JOBS LIST.
 *   - ?open=<id> and ?q=<text> are read, then dropped from the URL;
 *   - ?status=<quick key> picks that pill; a comma list (the dashboard's
 *     "Active jobs") goes to the Status filter instead of falling back to All.
 */
import { describe, it, expect } from "bun:test";
import { readJobsUrl, ACTIVE_STATUSES } from "../lib/jobs-url";

const QUICK = ["pending", "confirmed", "assigned", "in_progress", "completed", "cancelled"];

describe("readJobsUrl", () => {
  it("reads ?open and strips it", () => {
    const u = readJobsUrl("?open=abc-123", QUICK);
    expect(u.open).toBe("abc-123");
    expect(u.rest).toBe("");
  });

  it("reads ?q and keeps other params in rest", () => {
    const u = readJobsUrl("?q=Smith&status=completed", QUICK);
    expect(u.q).toBe("Smith");
    expect(u.quick).toBe("completed");
    expect(u.rest).toBe("?status=completed");
  });

  it("maps a single quick key to the pill", () => {
    const u = readJobsUrl("status=pending", QUICK);
    expect(u.quick).toBe("pending");
    expect(u.statusList).toEqual([]);
  });

  it("maps a comma list to the Status filter", () => {
    const u = readJobsUrl(`?status=${ACTIVE_STATUSES.join(",")}`, QUICK);
    expect(u.quick).toBe("");
    expect(u.statusList).toEqual(["assigned", "enroute", "arrived", "in_progress"]);
  });

  it("is empty for no params", () => {
    expect(readJobsUrl("", QUICK)).toEqual({ open: "", q: "", quick: "", statusList: [], rest: "" });
  });
});
