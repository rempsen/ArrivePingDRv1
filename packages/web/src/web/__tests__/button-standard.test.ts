/**
 * The button standard (src/web/styles.css, "Buttons"; Dan, 2026-10-20):
 * a button's label never touches its edge, on any tenant's page, however
 * long the company or technician name in it ("Email BMD Materials").
 *
 * Every labelled button, link-styled-as-a-button or router Link in the web
 * app either uses .nvc-btn (which sets the padding for its size) or, styled
 * by hand, keeps side padding of at least 12px (px-3) when its label is
 * text-sm or larger, and 8px (px-2) for a smaller label or one whose size it
 * takes from around it. A fixed square (an icon button, a calendar day, an
 * A–Z letter) is exempt: it has no label to crowd.
 */
import { describe, it, expect } from "bun:test";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { Glob } from "bun";

const WEB = join(import.meta.dir, "..");

export interface ButtonFinding {
  file: string;
  line: number;
  reason: string;
  className: string;
}

/** A filled or outlined, rounded control with a label weight: a button, whatever its tag. */
const isLabelledButton = (cls: string) =>
  /\brounded/.test(cls) && /\b(bg-|border\b|nvc-btn-primary)/.test(cls) && /\bfont-(medium|semibold|bold)\b/.test(cls);
const usesStandard = (cls: string) => /(^|[\s"'`{(])nvc-btn(?=[\s"'`})]|$)/.test(cls);
const isFixedSquare = (cls: string) =>
  /\bsize-(\d|\[)/.test(cls) || (/(^|[\s"'`])h-(\d+|\[[^\]]+\])/.test(cls) && /(^|[\s"'`])(min-)?w-(\d+|\[[^\]]+\])/.test(cls) && !/\bw-full\b/.test(cls));
/** A label of 14px or more: text-sm and up, or an arbitrary size from 13px. */
const largeText = (cls: string) => /\btext-(sm|base|lg|xl|[2-9]xl)\b|\btext-\[(1[3-9]|[2-9]\d)(\.\d+)?px\]/.test(cls);

/** The smallest side padding a class string sets, in Tailwind spacing units (1 = 4px), or null for none. */
export function sidePadding(cls: string): number | null {
  const units: number[] = [];
  for (const m of cls.matchAll(/(?:^|[\s"'`{(])!?(?:px|pl|pr|ps|pe|p)-(\[[^\]]+\]|[\d.]+)(?=[\s"'`})]|$)/g)) {
    const v = m[1]!;
    if (v.startsWith("[")) {
      const px = /^\[([\d.]+)px\]$/.exec(v)?.[1] ?? /^\[([\d.]+)rem\]$/.exec(v)?.[1];
      if (px) units.push(v.endsWith("rem]") ? Number(px) * 4 : Number(px) / 4);
    } else units.push(Number(v));
  }
  return units.length ? Math.min(...units) : null;
}

/** Labelled buttons in one TSX source that break the rule. */
export function findCrampedButtons(file: string, text: string): ButtonFinding[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: ButtonFinding[] = [];
  const visit = (n: ts.Node) => {
    if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && ["button", "a", "Link"].includes(n.tagName.getText(sf))) {
      const attr = n.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(sf) === "className") as ts.JsxAttribute | undefined;
      const cls = attr?.initializer?.getText(sf) ?? "";
      if (cls && isLabelledButton(cls) && !usesStandard(cls) && !isFixedSquare(cls)) {
        const need = largeText(cls) ? 3 : 2;
        const pad = sidePadding(cls);
        const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
        if (pad === null) out.push({ file, line, reason: "no side padding", className: cls });
        else if (pad < need) out.push({ file, line, reason: `side padding ${pad * 4}px, under ${need * 4}px`, className: cls });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe("the button standard", () => {
  it("no labelled button in the web app is cramped", () => {
    const findings: ButtonFinding[] = [];
    for (const f of new Glob("**/*.tsx").scanSync(WEB)) {
      if (f.includes("__tests__")) continue;
      const path = join(WEB, f);
      findings.push(...findCrampedButtons(relative(join(WEB, "../.."), path), readFileSync(path, "utf8")));
    }
    // Fix: add .nvc-btn (+ a size: nvc-btn-xs / -sm / -lg), or side padding (px-3; px-2 for a small label).
    expect(findings.map((x) => `${x.file}:${x.line} ${x.reason}`)).toEqual([]);
  });

  it("catches the button Dan found, and passes it once it's on the standard", () => {
    const before = `<a href="mailto:x" className="mt-5 flex items-center justify-center gap-2 rounded-xl bg-brand py-2.5 text-sm font-semibold text-white hover:bg-brand-deep">Email BMD Materials</a>`;
    expect(findCrampedButtons("x.tsx", before).map((x) => x.reason)).toEqual(["no side padding"]);
    const after = `<a href="mailto:x" className="nvc-btn nvc-btn-brand mt-5 w-full">Email BMD Materials</a>`;
    expect(findCrampedButtons("x.tsx", after)).toEqual([]);
  });

  it("scales the minimum with the label: 12px from text-sm up, 8px below", () => {
    const btn = (cls: string) => findCrampedButtons("x.tsx", `<button className="${cls}">Go</button>`).map((x) => x.reason);
    expect(btn("rounded-lg bg-brand px-2 py-1 text-xs font-semibold")).toEqual([]);
    expect(btn("rounded-lg bg-brand px-2 py-2 text-sm font-semibold")).toEqual(["side padding 8px, under 12px"]);
    expect(btn("rounded-lg bg-brand px-1 py-1 text-[11px] font-semibold")).toEqual(["side padding 4px, under 8px"]);
    expect(btn("rounded-md bg-white/5 px-2 py-1 font-semibold")).toEqual([]); // size from around it
    expect(btn("rounded-md bg-white/5 py-1 font-semibold")).toEqual(["no side padding"]);
    expect(btn("rounded-lg border border-white/10 px-4 py-2.5 text-sm font-semibold")).toEqual([]);
    // An icon button, a calendar day or an A–Z letter is a fixed square, not a label.
    expect(btn("grid h-7 w-7 place-items-center rounded-full bg-brand font-semibold")).toEqual([]);
    expect(btn("grid h-7 min-w-7 place-items-center rounded-md px-1 text-xs font-semibold bg-white/5")).toEqual([]);
    // Toggles, thumbnails and cards carry no label weight and aren't checked.
    expect(btn("relative h-[24px] w-[42px] rounded-full bg-emerald-500")).toEqual([]);
  });

  it("reads padding in conditional classes and arbitrary values", () => {
    expect(sidePadding("`rounded-md px-2.5 ${on ? 'bg-brand' : ''}`")).toBe(2.5);
    expect(sidePadding('"rounded-lg px-[14px] py-2"')).toBe(3.5);
    expect(sidePadding('"rounded-lg py-2"')).toBeNull();
  });
});
