/**
 * Live, 2026-11-13 (valleyfiber.ca): the signup scan made one plain request,
 * the site dropped the connection, and the user was told "Your site didn't
 * give us much to go on". The fetch is now a ladder with a typed outcome.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { _setSiteFetchForTests, fetchPage, hostVariant, looksLikeChallenge, visibleTextLength } from "../site-fetch";
import { scoutBrand } from "../brand-scout";
import { _setResolverForTests, checkPublicUrl, isPrivateAddress } from "../safe-net";

const page = (words: number) => `<html><head><title>Acme</title></head><body><p>${"word ".repeat(words)}</p></body></html>`;
const html = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
const render = (rawHtml: string, statusCode = 200) =>
  new Response(JSON.stringify({ success: true, data: { rawHtml, metadata: { statusCode, url: "https://acme.test/" } } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const isRender = (u: string) => u.startsWith("https://api.firecrawl.dev/");

const KEY = process.env.FIRECRAWL_API_KEY;
afterEach(() => {
  _setSiteFetchForTests(null);
  if (KEY === undefined) delete process.env.FIRECRAWL_API_KEY;
  else process.env.FIRECRAWL_API_KEY = KEY;
});

describe("fetchPage", () => {
  test("a normal page comes straight back, with browser headers sent", async () => {
    delete process.env.FIRECRAWL_API_KEY;
    let sent: Record<string, string> = {};
    _setSiteFetchForTests(async (_u, init) => {
      sent = init?.headers as Record<string, string>;
      return html(page(300));
    });
    const r = await fetchPage("https://acme.test/");
    expect(r.ok && r.via).toBe("direct");
    expect(sent["user-agent"]).toContain("Chrome/");
    expect(sent["accept-language"]).toBeTruthy();
    expect(sent["sec-fetch-mode"]).toBe("navigate");
  });

  test("a dropped connection is 'blocked', and the hosted browser is tried", async () => {
    process.env.FIRECRAWL_API_KEY = "test-key";
    const calls: string[] = [];
    _setSiteFetchForTests(async (u, init) => {
      calls.push(u);
      if (isRender(u)) {
        expect((init!.headers as Record<string, string>).authorization).toBe("Bearer test-key");
        expect(JSON.parse(String(init?.body)).url).toBe("https://acme.test/");
        return render(page(300));
      }
      throw Object.assign(new Error("HTTP2 PROTOCOL_ERROR"), { code: "ERR_HTTP2_PROTOCOL_ERROR" });
    });
    const r = await fetchPage("https://acme.test/");
    expect(r.ok && r.via).toBe("render");
    expect(calls.filter(isRender).length).toBe(1);
  });

  test("without a render key, a refusal is reported as blocked with its status", async () => {
    delete process.env.FIRECRAWL_API_KEY;
    _setSiteFetchForTests(async () => html("Forbidden", 403));
    const r = await fetchPage("https://acme.test/");
    expect(r).toMatchObject({ ok: false, reason: "blocked", status: 403 });
  });

  test("an unknown host tries the www twin before giving up", async () => {
    delete process.env.FIRECRAWL_API_KEY;
    const calls: string[] = [];
    _setSiteFetchForTests(async (u) => {
      calls.push(u);
      if (u.includes("www.")) return html(page(300));
      throw Object.assign(new Error("getaddrinfo ENOTFOUND acme.test"), { code: "ENOTFOUND" });
    });
    const r = await fetchPage("https://acme.test/");
    expect(r.ok).toBe(true);
    expect(calls).toEqual(["https://acme.test/", "https://www.acme.test/"]);
  });

  test("an unknown host with no twin answer is unreachable, not blocked", async () => {
    process.env.FIRECRAWL_API_KEY = "test-key";
    _setSiteFetchForTests(async (u) => {
      if (isRender(u)) return new Response(JSON.stringify({ success: false, error: "dns" }), { status: 500 });
      throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    });
    const r = await fetchPage("https://nope.test/");
    expect(r).toMatchObject({ ok: false, reason: "unreachable" });
  });

  test("a timeout is reported as a timeout", async () => {
    delete process.env.FIRECRAWL_API_KEY;
    _setSiteFetchForTests(async () => {
      throw Object.assign(new Error("The operation timed out."), { name: "TimeoutError" });
    });
    expect(await fetchPage("https://slow.test/")).toMatchObject({ ok: false, reason: "timeout" });
  });

  test("a JavaScript shell is upgraded to the rendered page", async () => {
    process.env.FIRECRAWL_API_KEY = "test-key";
    _setSiteFetchForTests(async (u) => (isRender(u) ? render(page(400)) : html(`<html><body><div id="root"></div><script>${"x".repeat(5000)}</script></body></html>`)));
    const r = await fetchPage("https://spa.test/");
    expect(r.ok && r.via).toBe("render");
  });

  test("a thin page stays as it is when rendering shows no more", async () => {
    process.env.FIRECRAWL_API_KEY = "test-key";
    _setSiteFetchForTests(async (u) => (isRender(u) ? render("<html><body></body></html>") : html(page(20))));
    const r = await fetchPage("https://small.test/");
    expect(r.ok && r.via).toBe("direct");
  });

  test("sub-pages (allowThin) never spend a render on a short page", async () => {
    process.env.FIRECRAWL_API_KEY = "test-key";
    const calls: string[] = [];
    _setSiteFetchForTests(async (u) => {
      calls.push(u);
      return html(page(20));
    });
    await fetchPage("https://small.test/contact", { allowThin: true });
    expect(calls.some(isRender)).toBe(false);
  });

  test("a bot check served as HTTP 200 is blocked, not a page", async () => {
    delete process.env.FIRECRAWL_API_KEY;
    _setSiteFetchForTests(async () => html(`<html><title>Just a moment...</title><body>Checking your browser</body></html>`));
    expect(await fetchPage("https://wall.test/")).toMatchObject({ ok: false, reason: "blocked", status: 200 });
    expect(await fetchPage("https://wall.test/about", { allowThin: true })).toMatchObject({ ok: false, reason: "blocked" });
  });

  test("a bot check is replaced by the rendered page when that gets through", async () => {
    process.env.FIRECRAWL_API_KEY = "test-key";
    _setSiteFetchForTests(async (u) => (isRender(u) ? render(page(300)) : html(`<html><title>Just a moment...</title><body>Checking your browser</body></html>`)));
    const r = await fetchPage("https://wall.test/");
    expect(r.ok && r.via).toBe("render");
  });

  test("a PDF is not a page, and is not sent to the hosted browser", async () => {
    process.env.FIRECRAWL_API_KEY = "test-key";
    const calls: string[] = [];
    _setSiteFetchForTests(async (u) => {
      calls.push(u);
      return new Response("%PDF", { status: 200, headers: { "content-type": "application/pdf" } });
    });
    expect(await fetchPage("https://acme.test/brochure.pdf")).toMatchObject({ ok: false, reason: "not_html" });
    expect(calls.some(isRender)).toBe(false);
  });

  test("a rendered page that is itself a refusal stays a failure", async () => {
    process.env.FIRECRAWL_API_KEY = "test-key";
    _setSiteFetchForTests(async (u) => (isRender(u) ? render("<html>Access denied</html>", 403) : html("no", 403)));
    expect(await fetchPage("https://wall.test/")).toMatchObject({ ok: false, reason: "blocked" });
  });
});

describe("what the scan refuses to fetch", () => {
  const redirect = (to: string, status = 302) => new Response(null, { status, headers: { location: to } });

  test.each([
    ["10.0.0.5", true], ["127.0.0.1", true], ["169.254.169.254", true], ["172.16.4.1", true], ["172.32.0.1", false], ["192.168.1.1", true],
    ["100.64.0.1", true], ["0.0.0.0", true], ["8.8.8.8", false], ["93.184.216.34", false], ["::1", true], ["fd00::1", true], ["fe80::1", true],
    ["::ffff:10.0.0.1", true], ["::ffff:a00:1", true], ["::ffff:8.8.8.8", false], ["2606:4700::1111", false], ["not-an-ip", true],
  ])("isPrivateAddress(%s) is %p", (ip, want) => {
    expect(isPrivateAddress(ip)).toBe(want as boolean);
  });

  test("a public name that resolves to an internal address", async () => {
    delete process.env.FIRECRAWL_API_KEY;
    const calls: string[] = [];
    _setSiteFetchForTests(async (u) => (calls.push(u), html(page(300))));
    _setResolverForTests(async () => ["169.254.169.254"]);
    expect(await fetchPage("https://innocent.test/")).toMatchObject({ ok: false, reason: "unreachable", refused: true });
    expect(calls).toEqual([]);
  });

  test("one internal answer among several is enough to refuse", async () => {
    _setResolverForTests(async () => ["93.184.216.34", "10.1.2.3"]);
    expect(await checkPublicUrl("https://mixed.test/")).toEqual({ ok: false, why: "private" });
  });

  test("a public page that redirects to an internal address, with no second try by another route", async () => {
    process.env.FIRECRAWL_API_KEY = "test-key";
    const calls: string[] = [];
    _setSiteFetchForTests(async (u) => {
      calls.push(u);
      return u === "https://acme.test/" ? redirect("http://127.0.0.1:4200/api/health") : html(page(300));
    });
    expect(await fetchPage("https://acme.test/")).toMatchObject({ ok: false, refused: true });
    expect(calls).toEqual(["https://acme.test/"]);
  });

  test("credentials in the address, other schemes and bare names", async () => {
    for (const u of ["https://user:pw@acme.test/", "ftp://acme.test/", "http://intranet/", "http://db.internal/", "http://[::1]/"]) {
      expect((await checkPublicUrl(u)).ok).toBe(false);
    }
  });

  test("ordinary redirects are followed, and the final address is reported", async () => {
    delete process.env.FIRECRAWL_API_KEY;
    _setSiteFetchForTests(async (u) => (u === "http://acme.test/" ? redirect("https://www.acme.test/home", 301) : u === "https://www.acme.test/home" ? html(page(300)) : html("no", 404)));
    const r = await fetchPage("http://acme.test/");
    expect(r).toMatchObject({ ok: true, finalUrl: "https://www.acme.test/home" });
  });

  test("a redirect loop ends", async () => {
    delete process.env.FIRECRAWL_API_KEY;
    let n = 0;
    _setSiteFetchForTests(async (u) => (n++, redirect(u + "x")));
    expect(await fetchPage("https://loop.test/")).toMatchObject({ ok: false, detail: "too many redirects" });
    expect(n).toBeLessThan(10);
  });
});

describe("reading the page", () => {
  test("a windows-1252 page keeps its accents", async () => {
    delete process.env.FIRECRAWL_API_KEY;
    const bytes = new Uint8Array([...`<html><head><meta charset="windows-1252"></head><body>R`].map((c) => c.charCodeAt(0)).concat([0xe9], [...`paration ${"mot ".repeat(200)}</body></html>`].map((c) => c.charCodeAt(0))));
    _setSiteFetchForTests(async () => new Response(bytes, { status: 200, headers: { "content-type": "text/html" } }));
    const r = await fetchPage("https://vieux.test/");
    expect(r.ok && r.html).toContain("Réparation");
  });

  test("a page that never ends is cut off", async () => {
    delete process.env.FIRECRAWL_API_KEY;
    _setSiteFetchForTests(async () => html(`<html><body>${"word ".repeat(1_400_000)}</body></html>`));
    const r = await fetchPage("https://huge.test/");
    expect(r.ok && r.html.length).toBeLessThanOrEqual(3_000_000);
  });
});

describe("helpers", () => {
  test("visibleTextLength ignores scripts and styles", () => {
    expect(visibleTextLength(`<style>a{}</style><script>var x=1</script><p>hello there</p>`)).toBe("hello there".length);
  });
  test("looksLikeChallenge spots a bot check but not a real page that mentions one", () => {
    expect(looksLikeChallenge(`<html><title>Just a moment...</title><body>Checking your browser</body></html>`)).toBe(true);
    expect(looksLikeChallenge(page(900) + "captcha")).toBe(false);
  });
  test("hostVariant swaps www and the bare domain only", () => {
    expect(hostVariant("https://acme.test/x")).toBe("https://www.acme.test/x");
    expect(hostVariant("https://www.acme.test/")).toBe("https://acme.test/");
    expect(hostVariant("https://shop.acme.test/")).toBeNull();
    expect(hostVariant("http://10.0.0.1/")).toBeNull();
  });
});

describe("scoutBrand outcome", () => {
  test("a site that refuses us is reported as blocked, never as an empty site", async () => {
    delete process.env.FIRECRAWL_API_KEY;
    _setSiteFetchForTests(async () => {
      throw Object.assign(new Error("HTTP2 PROTOCOL_ERROR"), { code: "ERR_HTTP2_PROTOCOL_ERROR" });
    });
    const p = await scoutBrand("valleyfiber.test", "t");
    expect(p.scan).toMatchObject({ status: "blocked", pagesRead: 0 });
    expect(p.pages).toEqual([]);
    expect(p.warnings.length).toBeGreaterThan(0);
  });
  test("a host that doesn't exist is reported as unreachable", async () => {
    delete process.env.FIRECRAWL_API_KEY;
    _setSiteFetchForTests(async () => {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    });
    expect((await scoutBrand("no-such-host.test", "t")).scan.status).toBe("unreachable");
  });
});
