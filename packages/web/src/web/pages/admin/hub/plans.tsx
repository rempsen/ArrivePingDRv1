/**
 * Control Hub → Plans: which parts of the product each plan includes, and how
 * many companies are on it. Plans are defined in code (shared/plans.ts) so a
 * change goes through review; every plan includes everything for now.
 */
import { useQuery } from "@tanstack/react-query";
import { Check, Minus } from "lucide-react";
import { Card, Skeleton, fmt } from "../analytics-ui";
import { HubLayout } from "./hub-ui";
import { hub } from "./hub-data";

interface PlansResp {
  entitlements: { key: string; label: string; group: string }[];
  plans: { id: string; label: string; includes: string[]; tenants: number; customers: number }[];
}

export default function HubPlans() {
  const q = useQuery({ queryKey: ["hub", "plans"], queryFn: () => hub<PlansResp>("/plans") });
  return (
    <HubLayout title="Plans" subtitle="Billing is per seat whatever the plan. A plan decides which parts of the product a company gets.">
      {q.isPending || !q.data ? (
        <Skeleton className="h-80 w-full" />
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            {q.data.plans.map((p) => (
              <div key={p.id} className="rounded-[20px] border border-white/[0.06] bg-white/[0.025] p-5">
                <p className="text-[13px] font-medium text-slate-400">{p.label}</p>
                <p className="mt-2 text-[30px] font-semibold leading-none text-white tabular-nums">{fmt.int(p.customers)}</p>
                <p className="mt-2 text-[12px] text-slate-500">
                  customers · {fmt.int(p.tenants)} accounts in all · {p.includes.length} of {q.data.entitlements.length} features
                </p>
              </div>
            ))}
          </div>
          <Card title="What each plan includes" caption="Every plan includes everything until pricing changes. To hold a feature back, change shared/plans.ts; this page shows how many companies it would reach." pad={false}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-[13px]">
                <thead>
                  <tr className="border-b border-white/[0.06] text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="px-5 py-3">Feature</th>
                    {q.data.plans.map((p) => (
                      <th key={p.id} className="px-3 py-3 text-center">
                        {p.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {q.data.entitlements.map((e) => (
                    <tr key={e.key} className="border-b border-white/[0.04] last:border-0">
                      <td className="px-5 py-3 text-slate-200">
                        {e.label}
                        <span className="ml-2 text-[11px] text-slate-500">{e.group}</span>
                      </td>
                      {q.data.plans.map((p) => (
                        <td key={p.id} className="px-3 py-3 text-center">
                          {p.includes.includes(e.key) ? (
                            <Check className="mx-auto h-4 w-4 text-emerald-300" aria-label="Included" />
                          ) : (
                            <Minus className="mx-auto h-4 w-4 text-slate-600" aria-label="Not included" />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </HubLayout>
  );
}
