/**
 * The Claude "ArrivePing Analytics" dashboard's sources.
 *
 * The dashboard is a Claude artifact that runs these queries live, through
 * each reader's own Supabase connector, every time it is opened, refreshed or
 * filtered. The SQL is the text the Admin → Analytics tab runs (./sql.ts),
 * rendered with the `{{name}}` placeholders the dashboard fills from its
 * filters, so the two always show the same numbers.
 *
 * After changing a query in ./sql.ts, run `bun run analytics:dashboard <dir>`
 * (tools/analytics-dashboard.ts) and update each `datasets/<id>` document of
 * the dashboard from the files it writes: ask Claude, giving it DASHBOARD_URL.
 */
import { DASHBOARD_QUERIES, forDashboard } from "./sql";

export const DASHBOARD_URL = "https://claude.ai/artifact/WDjw9pLUpGnXMDdNW6WT8r";

/** The production Supabase project ("ArrivePing"). */
export const SUPABASE_PROJECT_ID = "ujrzjdzcqrvquwasneaq";

/** The connector as it is named in claude.ai, and its SQL tool. */
export const DASHBOARD_CONNECTOR = "Supabase";
export const DASHBOARD_TOOL = "execute_sql";

export type DashboardDatasetId = keyof typeof DASHBOARD_QUERIES;

/** What each source is called in the dashboard's Sources panel. */
export const DASHBOARD_DATASETS: Record<DashboardDatasetId, { title: string; description: string }> = {
  headline: {
    title: "Headline figures",
    description:
      "Every headline figure for the chosen period and the same number of days before it: companies, people, jobs, customer updates, plan revenue and the most active company. Reads companies, bookings, memberships, session, riders, notification_deliveries and reviews.",
  },
  kpis: {
    title: "Change vs previous period",
    description:
      "The main figures for the chosen period beside the period before, with the change as a share and as a multiple. Reads companies, bookings, memberships, session, riders, notification_deliveries and reviews.",
  },
  series: {
    title: "Activity over time",
    description:
      "Jobs created and completed, new companies, customer updates and team sign-ins per day, week or month of the period, with empty ones as zero. Reads companies, bookings, memberships, session and notification_deliveries.",
  },
  tenants: {
    title: "Company list",
    description:
      "One row per company: industry, health, billing, plan value, team, customers and activity in the chosen period. Reads companies, bookings, memberships, session, riders and notification_deliveries.",
  },
  records: {
    title: "Platform records",
    description:
      "All-time bests, such as the most jobs created in one day; the filters apply, the date range doesn't. Reads companies, bookings, riders and notification_deliveries.",
  },
  funnel_steps: {
    title: "Activation milestones",
    description:
      "How many companies have reached each milestone, from signing up to paying, as a share of all signups, and the median days from signup to a first job. Reads companies, bookings and riders.",
  },
  industries: {
    title: "Industries in use",
    description: "The industries companies have chosen, for the industry filter. Reads companies.",
  },
  first_day: {
    title: "First day of data",
    description: "The earliest day a company or a job was created, where All time starts. Reads companies and bookings.",
  },
};

/** The dashboard's `datasets/<id>` documents, ready to write. */
export function dashboardDatasetDocuments(projectId: string = SUPABASE_PROJECT_ID) {
  return Object.fromEntries(
    (Object.keys(DASHBOARD_DATASETS) as DashboardDatasetId[]).map((id) => [
      id,
      {
        ...DASHBOARD_DATASETS[id],
        source: {
          kind: "query",
          connector: DASHBOARD_CONNECTOR,
          tool: DASHBOARD_TOOL,
          args: { project_id: projectId, query: forDashboard(DASHBOARD_QUERIES[id]) },
        },
      },
    ]),
  ) as Record<
    DashboardDatasetId,
    {
      title: string;
      description: string;
      source: { kind: "query"; connector: string; tool: string; args: { project_id: string; query: string } };
    }
  >;
}
