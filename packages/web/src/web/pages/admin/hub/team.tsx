/**
 * Control Hub → Team: the NVC360 people who can use the hub, and what each may
 * do. Owners add and remove people; there is always at least one Owner.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { Card, Skeleton, fmt } from "../analytics-ui";
import { Field, inputCls, BtnPrimary } from "../../../components/modal";
import { toast } from "../../../components/toast";
import { useConfirm } from "../../../components/confirm-dialog";
import { useAuth } from "../../../hooks/use-auth";
import { HubLayout, EmptyNote, useHubMe } from "./hub-ui";
import { hub, ROLE_LABEL, type PlatformRole, type StaffMember } from "./hub-data";

const ROLE_TEXT: Record<PlatformRole, string> = {
  owner: "Everything, including this list, plans and deleting companies.",
  staff: "Support: every company, switches, settings, act-as. No plans, kinds or deleting.",
  sales: "Demos, test accounts and leads. Customer accounts are view-only.",
};

export default function HubTeam() {
  const me = useHubMe();
  const { user } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ["hub", "team"], queryFn: () => hub<{ staff: StaffMember[] }>("/team") });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<PlatformRole>("staff");
  const owner = me.data?.can.manageTeam;
  const save = useMutation({
    mutationFn: (b: { email: string; role: PlatformRole }) => hub("/team", { method: "POST", body: b }),
    onSuccess: () => {
      toast({ kind: "success", message: "Saved." });
      setEmail("");
      void qc.invalidateQueries({ queryKey: ["hub", "team"] });
    },
  });
  const remove = useMutation({
    mutationFn: (userId: string) => hub(`/team/${userId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ kind: "success", message: "Removed. They keep an admin login for their own company only." });
      void qc.invalidateQueries({ queryKey: ["hub", "team"] });
    },
  });
  return (
    <HubLayout title="Team" subtitle="NVC360 people who can use the Control Hub. Only nvc360.com addresses can be added.">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card title="People" pad={false}>
          {q.isPending ? (
            <div className="px-5 pb-5">
              <Skeleton className="h-40 w-full" />
            </div>
          ) : (q.data?.staff.length ?? 0) === 0 ? (
            <div className="px-5 pb-5">
              <EmptyNote>No one listed yet, so every NVC360 super admin is an Owner.</EmptyNote>
            </div>
          ) : (
            <ul className="divide-y divide-white/[0.05]">
              {q.data!.staff.map((s) => (
                <li key={s.userId} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium text-slate-100">
                      {s.name || s.email}
                      {s.userId === user?.id && <span className="ml-2 text-[11px] text-slate-500">(you)</span>}
                    </p>
                    <p className="truncate text-[12px] text-slate-500">
                      {s.email} · added {s.createdAt ? fmt.ago(s.createdAt) : ""}
                    </p>
                  </div>
                  {owner && s.userId !== user?.id ? (
                    <>
                      <select
                        aria-label={`Role for ${s.name || s.email}`}
                        value={s.role}
                        onChange={(e) => save.mutate({ email: s.email, role: e.target.value as PlatformRole })}
                        className="h-8 rounded-lg border border-white/10 bg-white/[0.03] px-2 text-[12px] text-slate-200"
                      >
                        {(["owner", "staff", "sales"] as PlatformRole[]).map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={async () => {
                          if (await confirm({ title: `Take ${s.name || s.email} off the Control Hub?`, message: "They lose access to every other company and keep an admin login for their own.", confirmLabel: "Remove" }))
                            remove.mutate(s.userId);
                        }}
                        className="text-[12px] font-semibold text-rose-300 hover:text-rose-200"
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-semibold text-slate-300">{ROLE_LABEL[s.role]}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="space-y-4">
          {owner && (
            <Card title="Add someone">
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  save.mutate({ email, role });
                }}
              >
                <Field label="Email" hint="They need to have signed in to ArrivePing once.">
                  <input aria-label="Email" className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@nvc360.com" required />
                </Field>
                <Field label="Role">
                  <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as PlatformRole)}>
                    {(["staff", "sales", "owner"] as PlatformRole[]).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                </Field>
                <BtnPrimary type="submit" disabled={!email || save.isPending}>
                  <UserPlus className="h-4 w-4" aria-hidden="true" />
                  Add
                </BtnPrimary>
              </form>
            </Card>
          )}
          <Card title="What each role can do">
            <dl className="space-y-3 text-[13px]">
              {(["owner", "staff", "sales"] as PlatformRole[]).map((r) => (
                <div key={r}>
                  <dt className="font-semibold text-slate-200">{ROLE_LABEL[r]}</dt>
                  <dd className="text-slate-500">{ROLE_TEXT[r]}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>
    </HubLayout>
  );
}
