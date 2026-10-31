import { describe, expect, test } from "bun:test";
import { answerBlocks, boldSpans, sseParser, type HelpEvent } from "../help-ask-core";

describe("sseParser", () => {
  test("splits events across chunks and parses JSON data", () => {
    const got: HelpEvent[] = [];
    const p = sseParser((e) => got.push(e));
    p.push('event: delta\ndata: {"text":"Open "}\n\nevent: del');
    p.push('ta\ndata: {"text":"**Settings**"}\n\nevent: action\r\ndata: {"type":"article","slug":"x"}\r\n\r\n');
    p.push("event: done\ndata: {}\n\n");
    expect(got.map((e) => e.event)).toEqual(["delta", "delta", "action", "done"]);
    expect(got[1]).toEqual({ event: "delta", data: { text: "**Settings**" } });
  });
  test("skips malformed data", () => {
    const got: HelpEvent[] = [];
    const p = sseParser((e) => got.push(e));
    p.push("event: delta\ndata: not json\n\nevent: done\ndata: {}\n\n");
    expect(got.map((e) => e.event)).toEqual(["done"]);
  });
});

test("answerBlocks groups lists and paragraphs", () => {
  expect(answerBlocks("In the app:\n1. Tap **Jobs**\n2. Tap the job\n\nTip: [see](http://x) this\n- a\n- b")).toEqual([
    { kind: "p", text: "In the app:" },
    { kind: "ol", items: ["Tap **Jobs**", "Tap the job"] },
    { kind: "p", text: "Tip: see this" },
    { kind: "ul", items: ["a", "b"] },
  ]);
});

test("boldSpans", () => {
  expect(boldSpans("Tap **Save** now")).toEqual([
    { text: "Tap ", bold: false },
    { text: "Save", bold: true },
    { text: " now", bold: false },
  ]);
});
