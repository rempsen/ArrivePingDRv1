/**
 * Server-sent events, parsed by hand.
 *
 * The browser's EventSource can't send an Authorization or X-Company-Id header,
 * and the dispatch stream needs both, so the map reads the stream with fetch()
 * and feeds the bytes through this. Pure: text in, messages out.
 */
export interface SseMessage {
  event: string;
  data: string;
}

/**
 * Split a growing text buffer into complete SSE messages. Returns the messages
 * that are finished and the unfinished tail, to be prepended to the next chunk.
 * Understands LF, CRLF and CR line endings, `:` comment lines, multi-line `data`
 * and a field with no colon. A lone trailing CR is held back because the next
 * chunk may start with its LF.
 */
export function parseSse(buffer: string): { messages: SseMessage[]; rest: string } {
  const held = buffer.endsWith("\r") ? "\r" : "";
  const text = (held ? buffer.slice(0, -1) : buffer).replace(/\r\n?/g, "\n");
  const blocks = text.split("\n\n");
  const rest = (blocks.pop() ?? "") + held;
  const messages: SseMessage[] = [];
  for (const block of blocks) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      const i = line.indexOf(":");
      const field = i === -1 ? line : line.slice(0, i);
      let value = i === -1 ? "" : line.slice(i + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (data.length > 0 || event !== "message") messages.push({ event, data: data.join("\n") });
  }
  return { messages, rest };
}
