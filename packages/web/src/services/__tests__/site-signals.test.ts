/**
 * Facts read straight from the markup, so a scan still names the business and
 * finds its phone when the AI read is unavailable, and so the footer (where
 * the address lives) is no longer thrown away with the menus.
 */
import { describe, expect, test } from "bun:test";
import { extractSignals, footerText, mergeSignals, nameFromTitle, signalsBlock, sitemapLocs } from "../site-signals";
import { buildExcerpts, pickSubpages } from "../brand-scout";

describe("nameFromTitle", () => {
  test.each([
    ["Home | Valley Fiber", "valleyfiber.ca", "Valley Fiber"],
    ["Valley Fiber - Manitoba's Rural Internet Provider", "www.valleyfiber.ca", "Valley Fiber"],
    ["Plumbing &amp; Heating in Winnipeg | Acme Plumbing Ltd.", "acmeplumbing.com", "Acme Plumbing Ltd."],
    ["Accueil – Plomberie Tremblay", "plomberietremblay.ca", "Plomberie Tremblay"],
    ["Bob's Electric", "bobselectric.com", "Bob's Electric"],
    ["Welcome", "x.com", null],
  ])("%s on %s", (title, host, want) => {
    expect(nameFromTitle(title, host)).toBe(want as string | null);
  });
});

describe("extractSignals", () => {
  const html = `<html><head>
    <title>Home | Valley Fiber</title>
    <meta name="description" content="Fast, reliable internet for rural Manitobans.">
    <meta property="og:site_name" content="Valley Fiber" />
  </head><body>
    <header><a href="tel:1-800-958-5698">Call</a><nav>Home Business</nav></header>
    <main><p>Fiber and wireless internet.</p><a href="tel:+12045550111">Winkler office</a></main>
    <footer><a href="tel:18009585698">1.800.958.5698</a>
      <a href="mailto:Info@valleyfiber.ca?subject=Hi">Email</a>
      <a href="mailto:webmaster@gmail.com">Web</a>
      <p>250 Main St, Winkler, MB R6W 1A1. Mon to Fri 8 to 5.</p></footer>
  </body></html>`;

  test("reads the name, description, most used phone link and own-domain email", () => {
    const s = extractSignals(html, "https://valleyfiber.ca/");
    expect(s.name).toBe("Valley Fiber");
    expect(s.description).toBe("Fast, reliable internet for rural Manitobans.");
    expect(s.phone).toBe("18009585698");
    expect(s.email).toBe("info@valleyfiber.ca");
    expect(s.footer).toContain("250 Main St, Winkler");
  });

  test("ignores junk addresses and non-numbers", () => {
    const s = extractSignals(`<a href="mailto:abc@sentry.io">x</a><a href="mailto:noreply@acme.com">y</a><a href="tel:123">z</a>`, "https://acme.com/");
    expect(s.email).toBeNull();
    expect(s.phone).toBeNull();
  });

  test("the homepage wins; later pages only fill gaps", () => {
    const a = extractSignals(`<title>Acme</title>`, "https://acme.com/");
    const b = extractSignals(`<title>Contact | Other Name</title><a href="tel:2045550100">c</a>`, "https://acme.com/contact");
    expect(mergeSignals([a, b])).toMatchObject({ name: "Acme", phone: "2045550100" });
  });

  test("the prompt block is empty when nothing was found", () => {
    expect(signalsBlock(extractSignals("<p>hi</p>", "https://acme.com/"))).toBe("");
    expect(signalsBlock(extractSignals(html, "https://valleyfiber.ca/"))).toContain("FOOTER TEXT");
  });

  test("footerText drops scripts and tags", () => {
    expect(footerText(`<footer><script>var a=1</script><b>Open</b> daily</footer>`)).toBe("Open daily");
  });
});

describe("pickSubpages", () => {
  const link = (href: string, text: string) => `<a href="${href}">${text}</a>`;

  test("finds section pages on a French site", () => {
    const html = [link("/nos-services/", "Nos services"), link("/a-propos/", "À propos"), link("/equipe/", "Notre équipe"), link("/nous-joindre/", "Nous joindre"), link("/secteurs-desservis/", "Secteurs"), link("/carrieres/", "Carrières")].join("");
    const got = pickSubpages(html, "https://plomberie.test/");
    expect(got).toEqual(expect.arrayContaining(["https://plomberie.test/nos-services/", "https://plomberie.test/a-propos/", "https://plomberie.test/equipe/", "https://plomberie.test/nous-joindre/", "https://plomberie.test/secteurs-desservis/"]));
    expect(got.some((u) => u.includes("carrieres"))).toBe(false);
  });

  test("treats customer segments as service pages, and never a sign-up page", () => {
    const html = [link("/signup", "Get service"), link("/business/", "Business"), link("/residential/", "Residential"), link("/coverage-map/", "Coverage"), link("/company/", "Company")].join("");
    const got = pickSubpages(html, "https://isp.test/");
    expect(got).toEqual(expect.arrayContaining(["https://isp.test/business/", "https://isp.test/residential/", "https://isp.test/coverage-map/", "https://isp.test/company/"]));
    expect(got).not.toContain("https://isp.test/signup");
  });

  test("takes up to three service pages and eight pages in all", () => {
    const html = Array.from({ length: 12 }, (_, i) => link(`/services/s${i}/`, `Service ${i}`)).join("") + link("/about/", "About") + link("/contact/", "Contact") + link("/team/", "Team") + link("/service-areas/", "Areas");
    const got = pickSubpages(html, "https://acme.test/");
    expect(got.length).toBe(8);
    expect(got.slice(0, 4)).toEqual(expect.arrayContaining(["https://acme.test/about/", "https://acme.test/team/", "https://acme.test/service-areas/"]));
  });

  test("uses sitemap pages when the homepage has no plain links", () => {
    const got = pickSubpages("<div id=root></div>", "https://spa.test/", [
      "https://spa.test/services/",
      "https://spa.test/about-us/",
      "https://spa.test/blog/2024/a-very-long-post/",
      "https://spa.test/services/drains/unclog/kitchen/",
      "https://other.test/services/",
      "https://spa.test/sitemap-pages.xml",
    ]);
    expect(got).toEqual(["https://spa.test/services/", "https://spa.test/about-us/"]);
  });
});

describe("sitemapLocs", () => {
  test("splits pages from child sitemaps and drops other hosts", () => {
    const idx = `<sitemapindex><sitemap><loc>https://a.test/page-sitemap.xml</loc></sitemap><sitemap><loc><![CDATA[https://a.test/post-sitemap.xml]]></loc></sitemap></sitemapindex>`;
    expect(sitemapLocs(idx, "https://a.test")).toEqual({ pages: [], children: ["https://a.test/page-sitemap.xml", "https://a.test/post-sitemap.xml"] });
    const set = `<urlset><url><loc>https://a.test/services/</loc></url><url><loc>https://b.test/x</loc></url></urlset>`;
    expect(sitemapLocs(set, "https://a.test")).toEqual({ pages: ["https://a.test/services/"], children: [] });
  });
});

describe("buildExcerpts", () => {
  test("gives the writers every section, not a 3,000-character slice", () => {
    const text = (w: string) => `${w} `.repeat(600);
    const pages = ["", "services/", "services/drains/", "about/", "service-areas/", "team/", "contact/"].map((p, i) => ({ url: `https://acme.test/${p}`, title: `P${i}`, text: text(`word${i}`) }));
    const out = buildExcerpts(pages);
    expect(out.length).toBeGreaterThan(8_000);
    expect(out.length).toBeLessThanOrEqual(12_400);
    for (let i = 0; i < 7; i++) expect(out).toContain(`word${i}`);
    expect(out.indexOf("word1")).toBeLessThan(out.indexOf("word0"));
  });
});
