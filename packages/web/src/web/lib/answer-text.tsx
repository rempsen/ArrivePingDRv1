import { Fragment, type ReactNode } from "react";

/** Optional classes, for the dashboard (Tailwind resets list styles); the website styles by element. */
export interface AnswerClasses {
  p?: string;
  ol?: string;
  ul?: string;
  strong?: string;
}

/**
 * An Ask ArrivePing answer's light markdown: numbered and bulleted lists,
 * paragraphs and **bold**. Renders text only, never HTML; a markdown link
 * shows as its words (the buttons under the answer are the way out).
 */
export function Answer({ text, cls = {} }: { text: string; cls?: AnswerClasses }) {
  const blocks: ReactNode[] = [];
  let list: { kind: "ol" | "ul"; items: string[] } | null = null;
  const inline = (s: string): ReactNode =>
    s
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .split(/(\*\*[^*]+\*\*)/g)
      .map((part, i) =>
        part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
          <strong key={i} className={cls.strong}>
            {part.slice(2, -2)}
          </strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      );
  const flush = () => {
    if (!list) return;
    const items = list.items.map((it, n) => <li key={n}>{inline(it)}</li>);
    blocks.push(
      list.kind === "ol" ? (
        <ol key={blocks.length} className={cls.ol}>
          {items}
        </ol>
      ) : (
        <ul key={blocks.length} className={cls.ul}>
          {items}
        </ul>
      ),
    );
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    const ul = /^[-*•]\s+(.*)$/.exec(line);
    if (ol || ul) {
      const kind = ol ? "ol" : "ul";
      if (list && list.kind !== kind) flush();
      list ??= { kind, items: [] };
      list.items.push((ol ?? ul)![1]!);
      continue;
    }
    flush();
    if (line)
      blocks.push(
        <p key={blocks.length} className={cls.p}>
          {inline(line)}
        </p>,
      );
  }
  flush();
  return <>{blocks}</>;
}
