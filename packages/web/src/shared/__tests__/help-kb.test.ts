/**
 * The screen map (shared/help-kb): well-formed, and its search finds the
 * right screen for the questions people actually ask.
 */
import { describe, expect, test } from "bun:test";
import { KB, kbById, kbEntryText, kbOutline, searchKb } from "../help-kb";
import { articles } from "../../web/site/support/articles";
import { PAGE_ACCESS } from "../office-pages";

describe("the screen map", () => {
  test("every entry is well-formed and ids are unique", () => {
    expect(KB.length).toBeGreaterThan(100);
    expect(Object.keys(kbById).length).toBe(KB.length);
    for (const e of KB) {
      expect(e.id).toMatch(/^(office-web|office-mobile|tech-app|customer|account)\.[a-z0-9.-]+$/);
      expect(e.id.startsWith(e.surface)).toBe(true);
      expect(e.title.trim()).not.toBe("");
      expect(e.summary.trim()).not.toBe("");
      expect(e.path.trim()).not.toBe("");
      expect(e.platforms.length).toBeGreaterThan(0);
      expect(e.roles.length).toBeGreaterThan(0);
      for (const t of e.tasks) {
        expect(t.q.trim()).not.toBe("");
        expect(t.steps.length).toBeGreaterThanOrEqual(1);
        expect(t.steps.length).toBeLessThanOrEqual(10);
      }
    }
  });

  test("covers every app", () => {
    const surfaces = new Set(KB.map((e) => e.surface));
    for (const s of ["office-web", "office-mobile", "tech-app", "customer", "account"]) expect(surfaces.has(s as never)).toBe(true);
  });

  test("the company's words are lowercase placeholders (the assistant capitalises them)", () => {
    // Other {braces} are real message-template variables people type ({customerName}, {trackUrl}).
    const all = KB.map((e) => kbEntryText(e)).join("\n");
    expect(all).not.toMatch(/\{(Job|Jobs|Worker|Workers|Customer|Customers)\}/);
  });

  test("every office dashboard page has a screen (add one when you add a page)", () => {
    // Pages documented under another route: these four are also tabs of Settings.
    const ALSO: Record<string, string> = {
      "/admin/automation": "/admin/settings?section=automation",
      "/admin/integrations": "/admin/settings?section=integrations",
      "/admin/audit": "/admin/settings?section=audit",
      "/admin/api-access": "/admin/settings?section=api",
    };
    const NOT_YET = new Set(["/admin/dispatch"]); // the dispatch map in progress; opens from Map when it ships
    const routes = KB.map((e) => e.route ?? "");
    const missing = PAGE_ACCESS.filter((p) => p.need !== "superadmin" && p.need !== "platform" && !NOT_YET.has(p.prefix))
      .filter((p) => {
        const want = [p.prefix, ALSO[p.prefix]].filter(Boolean) as string[];
        return !routes.some((r) => want.some((w) => r === w || r.startsWith(`${w}/`) || r.startsWith(`${w}?`) || (w.includes("?") && r.startsWith(w))));
      })
      .map((p) => p.prefix);
    expect(missing).toEqual([]);
  });

  test("the outline stays small enough to send with every question", () => {
    expect(kbOutline().length).toBeLessThan(40_000);
    expect(articles.length).toBeGreaterThan(0);
  });
});

/** Questions → the app the right answer lives in (the top results must include one from it, on topic). */
const CASES: [string, RegExp][] = [
  ["How do I invite a technician?", /invite|technician|add-technician/],
  ["Why does the app ask for Always location?", /^tech-app\.location/],
  ["How does a technician mark a job complete?", /^tech-app\.(complete|job)/],
  ["What does the customer see when the tech is on the way?", /^customer\.(tracking|messages)/],
  ["I forgot my password", /^account\.(forgot|reset)/],
  ["How do I connect QuickBooks?", /quickbooks|integrations/],
  ["How do I change the on my way text message?", /notification/],
  ["How do I add a service to my price catalog?", /catalog|services/],
  ["How do I embed a booking form on my website?", /intake|embed/],
  ["How do I drag a job to another technician on iPad?", /^office-mobile\.board/],
  ["How do I update the credit card for my subscription?", /billing/],
  ["How do I create a skill class?", /skill-classes/],
];

describe("search finds the right screen", () => {
  for (const [q, want] of CASES) {
    test(q, () => {
      const ids = searchKb(q, { limit: 5 }).map((e) => e.id);
      expect(ids.some((id) => want.test(id))).toBe(true);
    });
  }
  test("a technician's search stays in the technician app", () => {
    const ids = searchKb("How do I reschedule a job?", { surfaces: ["tech-app", "account"], roles: ["technician", "anyone"] }).map((e) => e.id);
    expect(ids.every((id) => id.startsWith("tech-app.") || id.startsWith("account."))).toBe(true);
  });
  test("nothing for an empty question", () => {
    expect(searchKb("the and of")).toEqual([]);
  });
});
