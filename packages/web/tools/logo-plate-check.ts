/**
 * Logo contrast check across every tenant (services/logo-contrast.ts).
 *
 *   bun run logo:check          analyse logos not yet analysed for their current file
 *   bun run logo:check --force  analyse every logo again (after a rule change)
 *
 * Prints one line per company: the plate the logo gets, where that answer came
 * from, and the metrics. Run it once after the 0027 migration so existing
 * tenants are right before anyone opens their dashboard; new logos are
 * analysed on their own as they land.
 */
import { sdb } from "../src/api/database";
import * as schema from "../src/api/database/schema";
import { ensureLogoPlate } from "../src/services/logo-contrast";

const force = process.argv.includes("--force");
const companies = await sdb.select({ id: schema.companies.id, name: schema.companies.name }).from(schema.companies);
let dark = 0;
let light = 0;
let unknown = 0;
let none = 0;
for (const co of companies.sort((a, b) => a.name.localeCompare(b.name))) {
  const r = await ensureLogoPlate(co.id, { force });
  const m = r.metrics ? ` cov=${r.metrics.coverage.toFixed(2)} white=${r.metrics.nearWhite.toFixed(2)} dark=${r.metrics.dark.toFixed(2)}` : "";
  if (!r.hasLogo) none++;
  else if (r.auto === "dark") dark++;
  else if (r.auto === "light") light++;
  else unknown++;
  console.log(`${co.name.padEnd(28)} ${(r.hasLogo ? r.plate : "no logo").padEnd(8)} ${r.source.padEnd(7)}${m}`);
}
console.log(`\n${companies.length} companies: ${light} white plate, ${dark} dark plate, ${unknown} unreadable (browser decides), ${none} without a logo.`);
process.exit(0);
