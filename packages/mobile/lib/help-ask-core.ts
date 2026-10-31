/**
 * "Ask ArrivePing" in the app: the parts with no React Native in them, so
 * `bun test lib` covers them. Server: packages/web/src/api/routes/help-ask.ts
 * (POST /api/help/ask, Server-Sent Events with JSON data).
 */

export type HelpAction = { type: "article"; slug: string } | { type: "video"; key: string } | { type: "contact"; reason: string };

export type HelpEvent =
  | { event: "delta"; data: { text: string } }
  | { event: "action"; data: HelpAction }
  | { event: "error"; data: { message: string } }
  | { event: "done"; data: { id?: string } };

export const HELP_LIMITS = { question: 500, history: 6, historyText: 2000 };

/**
 * Feeds text chunks as they arrive and calls `on` for each complete event.
 * Returns the parser; call `push(chunk)` per chunk.
 */
export function sseParser(on: (e: HelpEvent) => void) {
  let buf = "";
  return {
    push(chunk: string) {
      buf += chunk.replace(/\r\n/g, "\n");
      let cut: number;
      while ((cut = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, cut);
        buf = buf.slice(cut + 2);
        let event = "message";
        const data: string[] = [];
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
        }
        if (!data.length) continue;
        try {
          on({ event, data: JSON.parse(data.join("\n")) } as HelpEvent);
        } catch {
          /* a malformed event is skipped */
        }
      }
    },
  };
}

export type AnswerBlock = { kind: "p"; text: string } | { kind: "ol" | "ul"; items: string[] };

/** The answer's light markdown → blocks: numbered and bulleted lists and paragraphs. */
export function answerBlocks(text: string): AnswerBlock[] {
  const out: AnswerBlock[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    const ul = /^[-*•]\s+(.*)$/.exec(line);
    if (ol || ul) {
      const kind = ol ? "ol" : "ul";
      const last = out[out.length - 1];
      if (last && last.kind === kind) last.items.push((ol ?? ul)![1]!);
      else out.push({ kind, items: [(ol ?? ul)![1]!] });
      continue;
    }
    if (line) out.push({ kind: "p", text: line.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") });
  }
  return out;
}

/** "**Bold** text" → spans, for nested <Text>. */
export function boldSpans(s: string): { text: string; bold: boolean }[] {
  return s
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part) => (part.startsWith("**") && part.endsWith("**") && part.length > 4 ? { text: part.slice(2, -2), bold: true } : { text: part, bold: false }));
}
