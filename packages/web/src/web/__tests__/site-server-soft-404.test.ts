/**
 * PUBLIC SITE ROUTING: made-up URLs are real 404s.
 *   Every public page comes from the build's page manifest (dist/_pages/
 *   manifest.json). A made-up /support/…, /blog/… or /compare/… address must
 *   answer 404 with noindex, never a 200 "soft 404" carrying the home page's
 *   title. Real pages, real help articles and app routes keep working.
 *   Also covers the IndexNow plan: only changed URLs, sitemap-only fallback,
 *   and non-2xx responses treated as failures.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let dir = "";
let site: typeof import("../../site-server");
const SITE = "https://arriveping.com";

async function write(rel: string, body: string) {
  const file = path.join(dir, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body);
}

const get = (p: string, headers: Record<string, string> = {}) => {
  const url = new URL(`http://localhost${p}`);
  return site.serveSite(new Request(url, { headers }), url);
};

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "ap-site-"));
  await write("index.html", "<html><head><title>shell</title></head><body><div id=\"root\"></div></body></html>");
  await write("_pages/index.html", "<h1>home</h1>");
  await write("_pages/support/free-trial.html", "<h1>How the 30-day free trial works</h1>");
  await write("_pages/blog/a-real-post.html", "<h1>A real post</h1>");
  await write("_pages/404.html", "<title>Page not found | ArrivePing</title><h1>Page not found</h1>");
  await write("llms.txt", "# ArrivePing\n");
  await write(
    "_pages/manifest.json",
    JSON.stringify({
      builtAt: "2026-11-01T00:00:00.000Z",
      indexNowKey: "k".repeat(32),
      urls: [`${SITE}/`, `${SITE}/support/free-trial`, `${SITE}/blog/a-real-post`, `${SITE}/blog/listed-but-not-written`],
      pages: [
        { url: `${SITE}/`, hash: "h-home" },
        { url: `${SITE}/support/free-trial`, hash: "h-trial" },
      ],
    }),
  );
  process.env.WEB_DIST_DIR = dir;
  site = await import("../../site-server");
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("made-up public URLs", () => {
  for (const p of ["/support/zzz", "/support/zzz/deeper", "/blog/zzz", "/blog/category/zzz", "/compare/zzz", "/zzz", "/404"]) {
    it(`${p} is a 404 with noindex`, async () => {
      const res = await get(p);
      expect(res.status).toBe(404);
      expect(res.headers.get("x-robots-tag") ?? "").toContain("noindex");
      expect(await res.text()).toContain("Page not found");
    });
  }
});

describe("real pages keep working", () => {
  it("serves a prerendered help article with no noindex", async () => {
    const res = await get("/support/free-trial");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toBeNull();
    expect(await res.text()).toContain("free trial");
  });

  it("redirects a trailing slash or capitals to the canonical path", async () => {
    const res = await get("/Support/Free-Trial/");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/support/free-trial");
  });

  it("keeps a real help article public even if its prerendered file is missing", async () => {
    const res = await get("/support/live-map"); // in support/articles.ts, not written above
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toBeNull();
  });

  it("keeps a page listed in the manifest public even if its file is missing", async () => {
    const res = await get("/blog/listed-but-not-written");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toBeNull();
  });

  it("serves app routes with the SPA shell, noindexed", async () => {
    for (const p of ["/sign-in", "/get-started", "/app/jobs", "/t/abc123", "/admin"]) {
      const res = await get(p);
      expect(res.status).toBe(200);
      expect(res.headers.get("x-robots-tag") ?? "").toContain("noindex");
    }
  });

  it("serves llms.txt as text with noindex", async () => {
    const res = await get("/llms.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
  });
});

describe("IndexNow plan", () => {
  const manifest = {
    builtAt: "b",
    indexNowKey: "k",
    urls: [`${SITE}/`, `${SITE}/a`, `${SITE}/b`],
    pages: [
      { url: `${SITE}/`, hash: "1" },
      { url: `${SITE}/a`, hash: "2" },
      { url: `${SITE}/b`, hash: "3" },
    ],
  };

  it("submits only changed and removed URLs", () => {
    const plan = site.planIndexNow(manifest, { [`${SITE}/`]: "1", [`${SITE}/a`]: "old", [`${SITE}/gone`]: "9" });
    expect(plan.reason).toBe("changed");
    expect(plan.urls.sort()).toEqual([`${SITE}/a`, `${SITE}/b`, `${SITE}/gone`].sort());
  });

  it("submits nothing when nothing changed", () => {
    const plan = site.planIndexNow(manifest, { [`${SITE}/`]: "1", [`${SITE}/a`]: "2", [`${SITE}/b`]: "3" });
    expect(plan.urls).toEqual([]);
  });

  it("submits every public URL when there is nothing to compare against (no Redis, or the first run)", () => {
    expect(site.planIndexNow(manifest, null)).toEqual({ urls: manifest.urls, reason: "no-previous-build" });
    expect(site.planIndexNow({ ...manifest, pages: undefined }, { x: "y" }).urls).toEqual(manifest.urls);
    expect(site.planIndexNow({ ...manifest, urls: [], pages: undefined }, null).urls).toEqual([`${SITE}/sitemap.xml`]);
  });

  it.skipIf(Boolean(process.env.REDIS_URL))("treats a non-2xx answer as a failure and retries later", async () => {
    let calls = 0;
    let body = "";
    const rejecting = (async (_url: string, init?: RequestInit) => {
      calls++;
      body = String(init?.body);
      return new Response("key not valid", { status: 403 });
    }) as unknown as typeof fetch;
    expect(await site.submitIndexNow({ fetchImpl: rejecting })).toBe(false);
    expect(calls).toBe(1);
    // No Redis, first run: every public page in the test manifest is submitted.
    expect(JSON.parse(body).urlList).toEqual([`${SITE}/`, `${SITE}/support/free-trial`]);

    const accepting = (async () => {
      calls++;
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;
    expect(await site.submitIndexNow({ fetchImpl: accepting })).toBe(true); // retried: nothing was recorded after the 403
    expect(calls).toBe(2);
    expect(await site.submitIndexNow({ fetchImpl: accepting })).toBe(true); // already done for this build
    expect(calls).toBe(2);
  });
});
