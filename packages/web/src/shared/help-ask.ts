/**
 * "Ask ArrivePing" on the public Help Center and in the mobile apps: what the
 * server, the website and the app all need to agree on.
 * Server: api/routes/help-ask.ts, services/help-ask.ts.
 */

/** Who's asking: anyone on the Help Center, or a signed-in office person or technician in the app. */
export type HelpAskAudience = "public" | "office" | "technician";
export type HelpAskPlatform = "web" | "ios" | "android";

/** A button under an answer. */
export type HelpAskAction = { type: "article"; slug: string } | { type: "video"; key: string } | { type: "contact"; reason: string };

export const HELP_ASK_LIMITS = {
  question: 500,
  /** Earlier turns sent back for follow-ups ("and on Android?"). */
  history: 6,
  historyText: 2000,
};

/**
 * SSE events from POST /api/public/help/ask and /api/help/ask (every data
 * payload is JSON). "done" carries the id of the logged question, which the
 * thumbs up/down sends back.
 */
export type HelpAskEvent =
  | { event: "delta"; data: { text: string } }
  | { event: "action"; data: HelpAskAction }
  | { event: "error"; data: { message: string } }
  | { event: "done"; data: { id?: string } };

/** Read an SSE stream from fetch(), calling `on` for each event. Shared by the website and the app. */
export async function readHelpStream(res: Response, on: (e: HelpAskEvent) => void): Promise<void> {
  if (!res.body) throw new Error("No response body");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let cut: number;
    while ((cut = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (!data.length) continue;
      try {
        on({ event, data: JSON.parse(data.join("\n")) } as HelpAskEvent);
      } catch {
        /* a malformed event is skipped */
      }
    }
  }
}
