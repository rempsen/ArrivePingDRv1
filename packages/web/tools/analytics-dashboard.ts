/**
 * Writes the Claude "ArrivePing Analytics" dashboard's dataset documents from
 * the shared analytics SQL, one JSON file per source:
 *
 *   bun run analytics:dashboard [out-dir]     (default: ./analytics-dashboard)
 *
 * Each file is a complete `datasets/<id>` document (title, description and the
 * live Supabase query). Give the folder to Claude with the dashboard's link
 * (DASHBOARD_URL) to update the dashboard after a query changes, so it keeps
 * running exactly what Admin → Analytics runs.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { dashboardViolations } from "../src/services/platform-analytics/sql";
import { DASHBOARD_URL, dashboardDatasetDocuments } from "../src/services/platform-analytics/dashboard";

const out = resolve(process.argv[2] ?? "analytics-dashboard");
mkdirSync(out, { recursive: true });

let failed = false;
for (const [id, doc] of Object.entries(dashboardDatasetDocuments())) {
  const query = doc.source.args.query;
  const problems = [
    ...dashboardViolations(query).map((w) => `uses the word ${w}, which the dashboard refuses`),
    ...(query.length > 16_000 ? [`is ${query.length} characters; the dashboard takes 16,000`] : []),
  ];
  if (problems.length) {
    failed = true;
    console.error(`✗ ${id}: ${problems.join("; ")}`);
    continue;
  }
  writeFileSync(join(out, `${id}.json`), `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`✓ ${id.padEnd(13)} ${String(query.length).padStart(6)} characters`);
}
console.log(`\nDashboard: ${DASHBOARD_URL}\nDocuments: ${out}`);
if (failed) process.exit(1);
