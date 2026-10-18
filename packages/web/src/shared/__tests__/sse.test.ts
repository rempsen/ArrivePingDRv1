import { describe, it, expect } from "bun:test";
import { parseSse } from "../sse";

describe("parseSse", () => {
  it("parses complete messages and keeps the unfinished tail", () => {
    const r = parseSse('event: ready\ndata: {"at":1}\n\nevent: locations\ndata: [1,2]\n\nevent: chan');
    expect(r.messages).toEqual([
      { event: "ready", data: '{"at":1}' },
      { event: "locations", data: "[1,2]" },
    ]);
    expect(r.rest).toBe("event: chan");
  });

  it("finishes a message that arrives in pieces", () => {
    const a = parseSse("event: changed\nda");
    expect(a.messages).toEqual([]);
    const b = parseSse(a.rest + 'ta: {"techs":[]}\n\n');
    expect(b.messages).toEqual([{ event: "changed", data: '{"techs":[]}' }]);
    expect(b.rest).toBe("");
  });

  it("reads CRLF and CR line endings, and a CR/LF split across chunks", () => {
    expect(parseSse("event: ping\r\ndata: 1\r\n\r\n").messages).toEqual([{ event: "ping", data: "1" }]);
    // a trailing CR is held back (it may be half of a CRLF), so a CR-only stream releases a message with the next one
    expect(parseSse("event: ping\rdata: 1\r\revent: x\r").messages).toEqual([{ event: "ping", data: "1" }]);
    const a = parseSse("event: ping\ndata: 1\r");
    expect(a.messages).toEqual([]);
    const b = parseSse(a.rest + "\n\r\n");
    expect(b.messages).toEqual([{ event: "ping", data: "1" }]);
  });

  it("skips comments, joins multi-line data, and defaults the event name", () => {
    const r = parseSse(": keep-alive\n\ndata: a\ndata: b\n\n");
    expect(r.messages).toEqual([{ event: "message", data: "a\nb" }]);
  });

  it("strips exactly one space after the colon and tolerates a field with no colon", () => {
    expect(parseSse("event:x\ndata:  two spaces\n\n").messages).toEqual([{ event: "x", data: " two spaces" }]);
    expect(parseSse("event: x\ndata\n\n").messages).toEqual([{ event: "x", data: "" }]);
  });

  it("gives nothing for an empty or partial buffer", () => {
    expect(parseSse("")).toEqual({ messages: [], rest: "" });
    expect(parseSse("\n\n").messages).toEqual([]);
  });
});
