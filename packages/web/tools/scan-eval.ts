/**
 * Run the website scan over the reference set and score it.
 *
 *   bun run scan:eval                        every site in tools/scan-eval-sites.json, against production
 *   bun run scan:eval -- --base http://localhost:4200
 *   bun run scan:eval -- --only valleyfiber.ca
 *   bun run scan:eval -- --out report.md     also write the report to a file
 *   bun run scan:eval -- --min 70            exit 1 if the average is below 70
 *
 * It calls the same public endpoint the signup page calls, one site at a time
 * (the endpoint allows 10 a minute), so it measures what a visitor gets:
 * the fetch ladder, the hosted browser and the AI read together. Each run is
 * a real scan and shows up in the Control Hub's "Website scans" card.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { AREA_LABEL, AREA_MAX, scoreScan, summarizeSet, type ScanScore, type ScoreArea, type ScoredScan, type SiteTruth } from "../src/shared/scan-score";

interface Site {
  url: string;
  note?: string;
  expect?: SiteTruth;
}

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const base = (arg("base") ?? "https://arriveping.com").replace(/\/$/, "");
const only = arg("only");
const out = arg("out");
const min = arg("min") ? Number(arg("min")) : null;
const file = arg("sites") ?? new URL("./scan-eval-sites.json", import.meta.url).pathname;

const all = (JSON.parse(readFileSync(file, "utf8")) as { sites: Site[] }).sites;
const sites = only ? all.filter((s) => s.url.includes(only)) : all;
if (!sites.length) {
  console.error(`No sites to scan${only ? ` matching "${only}"` : ""}. Add some to ${file}.`);
  process.exit(2);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function scan(url: string): Promise<{ proposal: ScoredScan | null; ms: number; error?: string }> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}/api/public/onboarding/scout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ website: url }),
      signal: AbortSignal.timeout(120_000),
    });
    const body = (await res.json().catch(() => ({}))) as { proposal?: ScoredScan; message?: string };
    if (!res.ok || !body.proposal) return { proposal: null, ms: Date.now() - t0, error: `HTTP ${res.status}${body.message ? `: ${body.message}` : ""}` };
    return { proposal: body.proposal, ms: Date.now() - t0 };
  } catch (e) {
    return { proposal: null, ms: Date.now() - t0, error: String((e as Error).message ?? e) };
  }
}

const rows: { site: Site; score: ScanScore; via: string; ms: number; error?: string }[] = [];
for (const [i, site] of sites.entries()) {
  if (i > 0) await sleep(7_000); // stay under the endpoint's 10 scans a minute
  process.stderr.write(`[${i + 1}/${sites.length}] ${site.url} ... `);
  const r = await scan(site.url);
  const score = scoreScan(r.proposal ?? { scan: { status: r.error ? "error" : "none" } }, site.expect);
  rows.push({ site, score, via: r.proposal?.scan?.via ?? "", ms: r.ms, error: r.error });
  process.stderr.write(`${score.total} (${score.grade})\n`);
}

const sum = summarizeSet(rows.map((r) => r.score));
const areas = Object.keys(AREA_MAX) as ScoreArea[];
const lines: string[] = [];
lines.push(`# Website scan: reference set`, "");
lines.push(`Run ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC against ${base}. ${sum.sites} site${sum.sites === 1 ? "" : "s"}.`, "");
lines.push(`**Average ${sum.average} of 100. ${sum.readPct}% of sites were read.** Excellent ${sum.byGrade.excellent}, good ${sum.byGrade.good}, thin ${sum.byGrade.thin}, poor ${sum.byGrade.poor}.`, "");
lines.push(`Weakest areas (share of available points lost): ${sum.weakest.filter((w) => w.lostPct > 0).map((w) => `${AREA_LABEL[w.area]} ${w.lostPct}%`).join(", ") || "none"}.`, "");
lines.push(`| Site | Score | Grade | ${areas.map((a) => `${AREA_LABEL[a]} (${AREA_MAX[a]})`).join(" | ")} | How | Seconds |`);
lines.push(`|---|---|---|${areas.map(() => "---").join("|")}|---|---|`);
for (const r of [...rows].sort((a, b) => a.score.total - b.score.total)) {
  lines.push(`| ${r.site.url} | ${r.score.total} | ${r.score.grade} | ${areas.map((a) => r.score.areas[a]).join(" | ")} | ${r.via === "render" ? "hosted browser" : r.via || "not read"} | ${(r.ms / 1000).toFixed(0)} |`);
}
lines.push("", "## What cost points", "");
for (const r of [...rows].sort((a, b) => a.score.total - b.score.total)) {
  if (!r.score.missing.length && !r.error) continue;
  lines.push(`- **${r.site.url}** (${r.score.total}): ${[r.error, ...r.score.missing].filter(Boolean).join("; ")}.`);
}
const report = lines.join("\n") + "\n";
console.log(report);
if (out) writeFileSync(out, report);
if (min !== null && sum.average < min) {
  console.error(`Average ${sum.average} is below the floor of ${min}.`);
  process.exit(1);
}
