import { describe, expect, test } from "bun:test";
import { filterQuestions, gapTopics, helpStats, isGap, matchLabel, type HelpQuestion } from "../pages/admin/hub/help-gaps";
import { KB } from "../../shared/help-kb";

const screen = KB.find((e) => e.surface === "office-web")!;
const q = (over: Partial<HelpQuestion>): HelpQuestion => ({
  id: Math.random().toString(36),
  source: "public",
  platform: "web",
  question: "How do I do a thing?",
  matched: "",
  answerChars: 100,
  handedOff: false,
  failed: false,
  rating: 0,
  createdAt: "2026-10-31T12:00:00Z",
  ...over,
});

describe("help questions in the Control Hub", () => {
  const rows = [
    q({ question: "Refund please", handedOff: true, matched: `${screen.id},article:x` }),
    q({ question: "Why is billing wrong", rating: -1, matched: screen.id }),
    q({ question: "Where is the map", rating: 1, matched: screen.id }),
    q({ question: "Teleport my truck", handedOff: true, matched: "", source: "technician" }),
    q({ question: "Broke", failed: true, source: "office" }),
  ];

  test("a gap is handed off, thumbs down or failed", () => {
    expect(rows.map(isGap)).toEqual([true, true, false, true, true]);
  });

  test("stats", () => {
    expect(helpStats(rows)).toEqual({ asked: 5, gaps: 4, handedOff: 2, thumbsDown: 1, thumbsUp: 1, failed: 1, selfServed: 0.2 });
    expect(helpStats([]).selfServed).toBeNull();
  });

  test("gaps grouped by the screen ranked first, biggest first", () => {
    const t = gapTopics(rows);
    expect(t[0]).toMatchObject({ id: screen.id, label: screen.title, count: 2 });
    expect(t[0]!.examples).toEqual(["Refund please", "Why is billing wrong"]);
    expect(t.find((x) => x.id === "(none)")).toMatchObject({ label: "Nothing matched", count: 2 });
  });

  test("labels for screens and articles, and the raw id otherwise", () => {
    expect(matchLabel(screen.id)).toBe(screen.title);
    expect(matchLabel("not.a.screen")).toBe("not.a.screen");
  });

  test("filters", () => {
    expect(filterQuestions(rows, { onlyGaps: true, source: "", search: "" }).length).toBe(4);
    expect(filterQuestions(rows, { onlyGaps: false, source: "technician", search: "" }).map((r) => r.question)).toEqual(["Teleport my truck"]);
    expect(filterQuestions(rows, { onlyGaps: false, source: "", search: "MAP" }).map((r) => r.question)).toEqual(["Where is the map"]);
  });
});
