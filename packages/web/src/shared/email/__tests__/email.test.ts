import { describe, expect, it } from "bun:test";
import { EMAIL_SAMPLE_VARS, designToText, hasDesign, legacyHeader, normalizeDesign, normalizeTheme, parseDesign, safeUrl, type EmailDesign } from "../design";
import { contrastRatio, contrastText, fillRich, fillText, fillUrl, makeCtx, renderBlock, renderEmail, renderPlainMessage, type EmailBrand } from "../render";
import { STARTERS, starterDesignFor, startersFor } from "../starters";

const brand = (over: Partial<EmailBrand> = {}): EmailBrand => ({
  company: "BMD Materials",
  brandColor: "#1d4ed8",
  bgColor: "#f1f5f9",
  logoUrl: "/uploads/email-logos/x.png",
  origin: "https://arriveping.com",
  footer: "<strong>BMD Materials</strong><br/>1 Main St",
  theme: normalizeTheme({}),
  ...over,
});
const vars = { ...EMAIL_SAMPLE_VARS, company: "BMD Materials" };

describe("designs", () => {
  it("reads a v1 array without changing its words", () => {
    const v1 = [
      { type: "heading", text: "Hi {{firstName}}", size: "lg" },
      { type: "heading", text: "Small", size: "sm" },
      { type: "text", text: "Body" },
      { type: "button", label: "Track", url: "{{trackUrl}}" },
      { type: "details", rows: [{ label: "When", value: "{{when}}" }] },
      { type: "bogus", text: "x" },
    ];
    const d = normalizeDesign(v1);
    expect(d.v).toBe(2);
    expect(d.blocks.map((b) => b.type)).toEqual(["heading", "heading", "text", "button", "details"]);
    expect(d.blocks[0]).toMatchObject({ text: "Hi {{firstName}}", level: 1 });
    expect(d.blocks[1]).toMatchObject({ level: 3 });
    expect(new Set(d.blocks.map((b) => b.id)).size).toBe(5);
    expect(hasDesign(JSON.stringify(v1))).toBe(true);
    expect(hasDesign("[]")).toBe(false);
    expect(hasDesign("{bad")).toBe(false);
    expect(parseDesign(JSON.stringify({ v: 2, preheader: "Hi", blocks: v1 }))!.preheader).toBe("Hi");
  });

  it("allowlists links and images", () => {
    expect(safeUrl("javascript:alert(1)")).toBe("");
    expect(safeUrl("data:text/html,x")).toBe("");
    expect(safeUrl("//evil.test/x")).toBe("");
    expect(safeUrl("{{trackUrl}}")).toBe("{{trackUrl}}");
    expect(safeUrl("https://ok.test/a?b=1")).toBe("https://ok.test/a?b=1");
    expect(safeUrl("/uploads/a.png")).toBe("/uploads/a.png");
    expect(safeUrl("mailto:a@b.co")).toBe("mailto:a@b.co");
    const d = normalizeDesign([{ type: "button", label: "x", url: "javascript:alert(1)" }]);
    expect((d.blocks[0] as any).url).toBe("");
  });

  it("keeps columns one level deep and bounds the size", () => {
    const d = normalizeDesign([
      { type: "columns", cols: [[{ type: "columns", cols: [[], []] }, { type: "text", text: "L" }], [{ type: "eta", label: "x", value: "y" }, { type: "text", text: "R" }]] },
      ...Array.from({ length: 80 }, () => ({ type: "divider" })),
    ]);
    expect(d.blocks.length).toBe(60);
    const c = d.blocks[0] as Extract<EmailDesign["blocks"][number], { type: "columns" }>;
    expect(c.cols[0].map((b) => b.type)).toEqual(["text"]);
    expect(c.cols[1].map((b) => b.type)).toEqual(["text"]);
  });

  it("plain text part", () => {
    const d = normalizeDesign([{ type: "text", text: "Hi **{{firstName}}** see [here](https://a.test)" }, { type: "button", label: "Go", url: "{{trackUrl}}" }]);
    expect(designToText(d, vars)).toBe("Hi Alex see here (https://a.test)\n\nGo: https://arriveping.com/t/abc123");
  });
});

describe("theme", () => {
  it("maps the old header styles", () => {
    expect(legacyHeader("gradient")).toBe("gradient");
    expect(legacyHeader("solid")).toBe("brand");
    expect(legacyHeader("minimal")).toBe("light");
    expect(legacyHeader("plain")).toBe("light");
    expect(normalizeTheme("", "solid").header).toBe("brand");
    expect(normalizeTheme({ header: "light" }, "solid").header).toBe("light");
  });
  it("cleans what it's given", () => {
    const t = normalizeTheme({ font: "comic", textColor: "red", logoRatio: 3.333333, social: [{ label: "Facebook", url: "https://facebook.com/bmd" }, { label: "Bad", url: "javascript:x" }, { label: "", url: "https://x.test" }] });
    expect(t.font).toBe("system");
    expect(t.textColor).toBe("");
    expect(t.logoRatio).toBe(3.333);
    expect(t.social).toEqual([{ label: "Facebook", url: "https://facebook.com/bmd" }]);
  });
});

describe("rendering", () => {
  it("escapes values and never turns them into links or formatting", () => {
    const evil = { ...vars, firstName: '<img src=x onerror=alert(1)> **bold** [x](https://evil.test)' };
    const html = fillRich("Hi {{firstName}}, **welcome**", evil, { link: "#000", color: "#000", size: 16 });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("evil.test\"");
    expect(html).not.toContain('href="https://evil.test');
    expect(html).toContain("<strong");
    expect(html.match(/<strong/g)!.length).toBe(1);
    expect(fillText('a"b', {})).toBe("a&quot;b");
  });

  it("drops unsafe links after tokens are filled", () => {
    expect(fillUrl("{{trackUrl}}", { trackUrl: "javascript:alert(1)" })).toBe("");
    expect(fillUrl("{{trackUrl}}", vars)).toBe("https://arriveping.com/t/abc123");
    expect(fillUrl("/uploads/a.png", {}, "https://arriveping.com/")).toBe("https://arriveping.com/uploads/a.png");
    const html = fillRich("[click](javascript:alert(1))", {}, { link: "#000", color: "#000", size: 16 });
    expect(html).not.toContain("href");
  });

  it("builds a client-safe document", () => {
    const html = renderEmail(normalizeDesign([{ type: "heading", text: "Hi {{firstName}}" }, { type: "button", label: "Track", url: "{{trackUrl}}" }]), brand(), vars);
    expect(html).toContain('lang="en"');
    expect(html).toContain('name="color-scheme"');
    expect(html).toContain("<!--[if mso]>");
    expect(html).toContain('role="presentation"');
    expect(html).toContain("mso-text-raise");
    expect(html).toContain("https://arriveping.com/uploads/email-logos/x.png");
    expect(html).toContain("Hi Alex");
    // preheader falls back to... nothing to take here (no text block) — but the button still renders
    expect(html).toContain('href="https://arriveping.com/t/abc123"');
    expect(html).toContain("Sent by BMD Materials");
  });

  it("uses the preheader, or the first words", () => {
    const withPre = renderEmail(normalizeDesign({ v: 2, preheader: "See you at {{when}}", blocks: [{ type: "text", text: "Body" }] }), brand(), vars);
    expect(withPre).toContain("See you at Jun 4, 2:30 PM&#847;");
    const auto = renderEmail(normalizeDesign([{ type: "text", text: "Hi **{{firstName}}**, we're coming" }]), brand(), vars);
    expect(auto).toContain("Hi Alex, we&#39;re coming".replace("&#39;", "'"));
  });

  it("leaves out a button with no link, and shows the ETA fallback", () => {
    const ctx = makeCtx(brand(), { ...vars, trackUrl: "", eta: null });
    expect(renderBlock(ctx, { id: "b", type: "button", label: "Track", url: "{{trackUrl}}" })).toBe("");
    const eta = renderBlock(ctx, { id: "e", type: "eta", label: "Arriving in", value: "{{eta}} min", fallback: "On the way" });
    expect(eta).toContain("On the way");
    expect(eta).not.toContain(" min");
  });

  it("puts initials on a tech card without a photo", () => {
    const ctx = makeCtx(brand(), vars);
    const html = renderBlock(ctx, { id: "t", type: "tech", name: "{{techName}}", photo: "{{techPhoto}}", role: "Technician" });
    expect(html).toContain(">JL<");
    const withPhoto = renderBlock(makeCtx(brand(), { ...vars, techPhoto: "/uploads/riders/j.jpg" }), { id: "t", type: "tech", name: "{{techName}}", photo: "{{techPhoto}}" });
    expect(withPhoto).toContain('src="https://arriveping.com/uploads/riders/j.jpg"');
  });

  it("columns stack on phones and use a table for Outlook", () => {
    const ctx = makeCtx(brand(), vars);
    const html = renderBlock(ctx, normalizeDesign([{ type: "columns", ratio: "1:2", cols: [[{ type: "text", text: "A" }], [{ type: "text", text: "B" }]] }]).blocks[0]!);
    expect(html).toContain('class="ap-col"');
    expect(html).toContain('max-width:172px');
    expect(html).toContain('max-width:346px');
    expect(html).toContain('<td width="172" valign="top">');
  });

  it("a pale brand colour never makes white-on-white", () => {
    const ctx = makeCtx(brand({ brandColor: "#f5f5f5", theme: normalizeTheme({ header: "brand" }) }), vars);
    expect(ctx.header).toBe("light");
    expect(ctx.accentText).toBe("#0f172a");
    expect(contrastRatio(ctx.link, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastText("#ffffff")).toBe("#0f172a");
    expect(contrastText("#1d4ed8")).toBe("#ffffff");
  });

  it("stays well under Gmail's 102 KB clip with a full design", () => {
    const blocks = STARTERS.flatMap((s) => s.design.blocks).slice(0, 60);
    const html = renderEmail(normalizeDesign(blocks), brand({ theme: normalizeTheme({ social: [{ label: "Facebook", url: "https://f.test" }] }) }), vars);
    expect(new TextEncoder().encode(html).length).toBeLessThan(102_000);
  });

  it("plain messages are escaped and branded", () => {
    const html = renderPlainMessage("New work order", "Hi <b>Alex</b> [x](https://evil.test)", brand(), vars);
    expect(html).toContain("Hi &lt;b&gt;Alex&lt;/b&gt;");
    expect(html).not.toContain('href="https://evil.test');
    expect(html).toContain("View details");
    expect(html).toContain("Furnace Tune-Up · Jun 4, 2:30 PM · 423 Main Street, Winnipeg");
  });

  it("editor mode tags blocks and shows placeholders", () => {
    const ctx = makeCtx(brand(), vars, { editor: true });
    expect(renderBlock(ctx, { id: "i1", type: "image", url: "" })).toContain('data-bid="i1"');
    expect(renderBlock(makeCtx(brand(), vars), { id: "i1", type: "image", url: "" })).toBe("");
  });
});

describe("starters", () => {
  it("every starter is a clean design", () => {
    for (const s of STARTERS) {
      const n = normalizeDesign(s.design);
      expect(n.blocks.length).toBe(s.design.blocks.length);
      expect(s.subject.length).toBeGreaterThan(5);
    }
  });
  it("picks the best fit for an event", () => {
    expect(startersFor("enroute", "client")[0]!.key).toBe("on-the-way");
    expect(startersFor("delayed", "client")[0]!.key).toBe("running-late");
    expect(startersFor("assigned", "tech")[0]!.key).toBe("tech-job");
    const a = starterDesignFor("enroute", "client");
    const b = starterDesignFor("enroute", "client");
    expect(a.design.blocks[0]!.id).not.toBe(b.design.blocks[0]!.id);
  });
});
