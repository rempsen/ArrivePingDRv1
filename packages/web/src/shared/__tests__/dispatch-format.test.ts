import { describe, expect, test } from "bun:test";
import { firstName, jobSub, jobTitle, whenLabel } from "../../web/features/dispatch/panels/format";

const NOW = Date.parse("2026-10-18T18:00:00Z"); // 1:00 PM in Winnipeg (CDT)
const TZ = "America/Winnipeg";

describe("whenLabel", () => {
  test("today, tomorrow, yesterday, and a later date, in the company's time zone", () => {
    expect(whenLabel("2026-10-18T20:20:00Z", TZ, NOW)).toBe("Today 3:20 PM");
    expect(whenLabel("2026-10-19T14:00:00Z", TZ, NOW)).toBe("Tomorrow 9:00 AM");
    expect(whenLabel("2026-10-17T14:00:00Z", TZ, NOW)).toBe("Yesterday 9:00 AM");
    expect(whenLabel("2026-10-25T14:00:00Z", TZ, NOW)).toBe("Oct 25, 9:00 AM");
  });
  test("a bad date gives an empty label, not 'Invalid Date'", () => {
    expect(whenLabel("nonsense", TZ, NOW)).toBe("");
  });
  test("a late-evening job near midnight UTC is still today locally", () => {
    expect(whenLabel("2026-10-19T03:30:00Z", TZ, NOW)).toBe("Today 10:30 PM");
  });
});

describe("names", () => {
  test("firstName", () => {
    expect(firstName("Tom Rivera")).toBe("Tom");
    expect(firstName("  Madonna ")).toBe("Madonna");
  });
  test("jobTitle falls back to the service, then the noun and id tail", () => {
    const j = { id: "bk_abcd1234", title: "", service: "Furnace repair" } as never;
    expect(jobTitle(j, "Job")).toBe("Furnace repair");
    expect(jobTitle({ id: "bk_abcd1234", title: "", service: "" } as never, "Job")).toBe("Job 1234");
  });
  test("jobSub joins when and where, skipping an empty address", () => {
    const j = { scheduledAt: "2026-10-18T20:20:00Z", address: "" } as never;
    expect(jobSub(j, TZ)).not.toContain("·");
  });
});
