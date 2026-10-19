/**
 * Control Hub → one company. Everything staff need to help, tune or decide
 * about an account: its health and billing, the feature switchboard, its
 * people (and act-as), the settings we may tune, its history, and the
 * account-level controls.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "wouter";
import { ArrowLeft, ExternalLink, LifeBuoy, LogIn, ShieldAlert } from "lucide-react";
import { Card, HealthPill, BillingText, Segmented, Skeleton, Switch, fmt } from "../analytics-ui";
import { Modal, Field, inputCls, BtnPrimary, BtnGhost, BtnDanger } from "../../../components/modal";
import { toast } from "../../../components/toast";
import { switchCompany } from "../../../lib/tenant";
import { beginActAs } from "../../../lib/act-as";
import { HUB_SETTINGS, type HubSettingDef } from "../../../../shared/hub-settings";
import { TenantLogo } from "../../../components/brand";
import { ACT_AS_DENY, ACT_AS_MINUTES, ACT_AS_MIN_REASON } from "../../../../shared/act-as";
import { HubLayout, KindBadge, StatusText, EmptyNote, sourceText, useHubMe } from "./hub-ui";
import { hub, KIND_LABEL, OFFICE_ROLE_LABEL, PLAN_LABEL, type FeatureRow, type Person, type TenantDetail, type TenantKind } from "./hub-data";

type Tab = "overview" | "features" | "people" | "settings" | "activity" | "manage";

export default function HubTenantDetail() {
  const { id } = useParams<{ id: string }>();
  const initialTab = (new URLSearchParams(window.location.search).get("tab") as Tab) || "overview";
  const [tab, setTab] = useState<Tab>(initialTab);
  const me = useHubMe();
  const q = useQuery({ queryKey: ["hub", "tenant", id], queryFn: () => hub<TenantDetail>(`/tenants/${encodeURIComponent(id!)}`) });
  const d = q.data;
  const isSalesOnCustomer = me.data?.role === "sales" && d?.company.kind === "customer";
  const tabs: { value: Tab; label: string }[] = [
    { value: "overview", label: "Overview" },
    { value: "features", label: "Features" },
    ...(isSalesOnCustomer ? [] : [{ value: "people" as Tab, label: "People" }]),
    { value: "settings", label: "Settings" },
    ...(isSalesOnCustomer ? [] : [{ value: "activity" as Tab, label: "Activity" }]),
    { value: "manage", label: "Manage" },
  ];

  return (
    <HubLayout
      title={d?.company.name ?? "Company"}
      subtitle={d ? [KIND_LABEL[d.company.kind], PLAN_LABEL[d.company.plan], d.summary?.industryLabel, d.summary?.city].filter(Boolean).join(" · ") : undefined}
      actions={
        d && (
          <button
            type="button"
            onClick={() => {
              switchCompany(d.company.id);
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-[13px] font-semibold text-slate-200 hover:border-white/20 hover:bg-white/[0.05]"
            title="Open this company's dashboard as yourself (ArrivePing staff)"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            Open their dashboard
          </button>
        )
      }
    >
      <Link href="/admin/hub/tenants" className="mb-4 inline-flex items-center gap-1 text-[13px] text-slate-400 hover:text-slate-200">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        All companies
      </Link>
      {q.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : q.isError || !d ? (
        <EmptyNote>{(q.error as Error)?.message || "Couldn't load this company."}</EmptyNote>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <KindBadge kind={d.company.kind} />
            <StatusText status={d.company.status} />
            {d.summary && <HealthPill health={d.summary.health === "unknown" ? "dormant" : d.summary.health} />}
            {isSalesOnCustomer && <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-slate-400">View only for Sales</span>}
          </div>
          <div className="mb-5">
            <Segmented<Tab> ariaLabel="Company sections" value={tab} onChange={setTab} options={tabs} />
          </div>
          {tab === "overview" && <OverviewTab d={d} />}
          {tab === "features" && <FeaturesTab d={d} readOnly={isSalesOnCustomer} />}
          {tab === "people" && <PeopleTab d={d} canActAs={Boolean(me.data?.can.actAs) || (me.data?.role === "sales" && d.company.kind !== "customer")} />}
          {tab === "settings" && <SettingsTab d={d} readOnly={isSalesOnCustomer} />}
          {tab === "activity" && <ActivityTab d={d} />}
          {tab === "manage" && <ManageTab d={d} />}
        </>
      )}
    </HubLayout>
  );
}

/* ------------------------------------------------------------ overview -- */

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="mt-1 truncate text-[14px] text-slate-200">{children}</dd>
    </div>
  );
}

function OverviewTab({ d }: { d: TenantDetail }) {
  const s = d.summary;
  const c = d.company;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Usage, last 30 days">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Fact label="Team">{fmt.int(s?.team)}</Fact>
          <Fact label="Technicians">{fmt.int(s?.techs)}</Fact>
          <Fact label="Customers">{fmt.int(s?.customers)}</Fact>
          <Fact label="Jobs">{fmt.int(s?.jobs30)}</Fact>
          <Fact label="Last active">{fmt.ago(s?.lastActive)}</Fact>
          <Fact label="Signed up">{c.createdAt ? fmt.day(c.createdAt.slice(0, 10)) : "—"}</Fact>
        </dl>
      </Card>
      <Card title="Billing">
        <dl className="grid grid-cols-2 gap-4">
          <Fact label="Plan">{PLAN_LABEL[c.plan] ?? c.plan}</Fact>
          <Fact label="Status">
            <BillingText status={c.billing.status} />
          </Fact>
          <Fact label="Seats">{fmt.int(c.billing.seats)}</Fact>
          <Fact label="Trial ends">{c.billing.trialEndsAt ? fmt.day(c.billing.trialEndsAt.slice(0, 10)) : "—"}</Fact>
          <Fact label="Card payments">{c.stripe.usePlatform ? "Our Stripe" : c.stripe.chargesEnabled ? "Their Stripe, live" : c.stripe.connected ? "Stripe set-up unfinished" : "Not set up"}</Fact>
          {c.kind === "demo" && <Fact label="Demo ends">{c.demoExpiresAt ? fmt.day(c.demoExpiresAt.slice(0, 10)) : "No end date"}</Fact>}
        </dl>
      </Card>
      <Card title="Contact">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Fact label="Email">{c.contactEmail || "—"}</Fact>
          <Fact label="Phone">{c.phone || "—"}</Fact>
          <Fact label="Office">{c.officeAddress || "—"}</Fact>
          <Fact label="HubSpot">{c.hubspot.companyId ? `Linked · synced ${fmt.ago(c.hubspot.syncedAt)}` : "Not linked"}</Fact>
        </dl>
      </Card>
      <LogoCheckCard d={d} />
      <Card title="Connected apps">
        {d.integrations.filter((i) => i.status === "connected").length === 0 ? (
          <p className="text-[13px] text-slate-500">None connected.</p>
        ) : (
          <ul className="space-y-1.5 text-[13px]">
            {d.integrations
              .filter((i) => i.status === "connected")
              .map((i) => (
                <li key={i.provider} className="flex justify-between gap-3">
                  <span className="capitalize text-slate-200">{i.provider.replace(/_/g, " ")}</span>
                  <span className="truncate text-slate-500">{i.accountLabel || "Connected"}</span>
                </li>
              ))}
          </ul>
        )}
        <p className="mt-3 text-[12px] text-slate-500">Support access: {c.allowSupportAccess ? "allowed" : "switched off by the company"}</p>
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------- logo check -- */

/**
 * Setup check: the logo on the plate it will actually be shown on. Logos
 * drawn with white lettering vanish on a white plate, so every logo is read
 * when it lands and the plate follows (services/logo-contrast.ts). Staff see
 * the result here, can run it again, and can pin a plate under Settings →
 * Brand → Logo backing.
 */
function LogoCheckCard({ d }: { d: TenantDetail }) {
  const qc = useQueryClient();
  const lc = d.logoCheck;
  const recheck = useMutation({
    mutationFn: () => hub<{ ok: boolean; auto: string; plate: string }>(`/tenants/${encodeURIComponent(d.company.id)}/logo-check`, { method: "POST" }),
    onSuccess: (r) => {
      toast.success(r.auto ? `Logo reads best on the ${r.auto} plate.` : "Couldn't read that logo file; the browser will decide.");
      void qc.invalidateQueries({ queryKey: ["hub", "tenant", d.company.id] });
    },
    onError: () => toast.error("Couldn't check the logo."),
  });
  const verdict = !lc.hasLogo
    ? { tone: "warn", text: "No logo yet. The sidebar shows a monogram until one is added." }
    : lc.source === "manual"
      ? { tone: "ok", text: `Pinned to the ${lc.plate} plate by staff${lc.auto ? `; the file reads as ${lc.auto}` : ""}.` }
      : lc.source === "auto"
        ? { tone: "ok", text: lc.auto === "dark" ? "White lettering: shown on the dark plate." : "Dark lettering: shown on the white plate." }
        : { tone: "warn", text: "Not analysed yet, or the file format can't be read here. Run the check." };
  return (
    <Card title="Logo" caption="Setup check: does the logo read on the plate it's shown on?">
      <div className="flex items-start gap-4">
        <TenantLogo
          src={lc.logo}
          name={lc.name}
          color={lc.brandColor}
          variant="plate"
          plate={lc.plate}
          className="h-20 w-44 shrink-0 px-3 py-2.5"
          fallbackClassName="h-16 w-16 text-2xl"
        />
        <div className="min-w-0 flex-1">
          <p className={`text-[13px] ${verdict.tone === "ok" ? "text-slate-200" : "text-amber-200"}`}>{verdict.text}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <BtnGhost onClick={() => recheck.mutate()} disabled={!lc.hasLogo || recheck.isPending}>
              {recheck.isPending ? "Checking…" : "Check again"}
            </BtnGhost>
            <span className="text-[12px] text-slate-500">To pin a plate, use Settings → Brand → Logo backing.</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------ features -- */

function FeaturesTab({ d, readOnly }: { d: TenantDetail; readOnly: boolean }) {
  const [editing, setEditing] = useState<FeatureRow | null>(null);
  const qc = useQueryClient();
  const reset = useMutation({
    mutationFn: (key: string) => hub(`/tenants/${d.company.id}/features/${key}`, { method: "PUT", body: { enabled: null } }),
    onSuccess: () => {
      toast({ kind: "success", message: "Back to the default." });
      void qc.invalidateQueries({ queryKey: ["hub"] });
    },
  });
  const groups = useMemo(() => {
    const m = new Map<string, FeatureRow[]>();
    for (const f of d.features) m.set(f.group, [...(m.get(f.group) ?? []), f]);
    return [...m.entries()];
  }, [d.features]);
  return (
    <div className="space-y-6">
      <p className="text-[13px] text-slate-400">
        Each switch starts from the company's plan and kind. Change one here to override it for {d.company.name} only, with an end date if it's a trial.
      </p>
      {groups.map(([group, rows]) => (
        <Card key={group} title={group} pad={false}>
          <ul className="divide-y divide-white/[0.05]">
            {rows.map((f) => (
              <li key={f.key} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium text-slate-100">
                    {f.label}
                    {f.kind !== "entitlement" && (
                      <span className="rounded-full bg-white/[0.06] px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-slate-400">{f.kind === "rollout" ? "New version" : "Behind the scenes"}</span>
                    )}
                  </p>
                  <p className="text-[12px] text-slate-500">{f.description}</p>
                  <p className={`mt-1 text-[11px] ${f.source === "override" ? "text-cyan-300" : "text-slate-500"}`}>
                    {sourceText(f.source, f.inherited, d.company.kind)}
                    {f.override?.expiresAt ? ` · until ${fmt.day(f.override.expiresAt.slice(0, 10))}` : ""}
                    {f.override?.reason ? ` · “${f.override.reason}”` : ""}
                    {f.override?.setByName ? ` · ${f.override.setByName}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {f.source === "override" && !readOnly && (
                    <button type="button" onClick={() => reset.mutate(f.key)} className="text-[12px] font-semibold text-slate-400 hover:text-slate-200">
                      Use default
                    </button>
                  )}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={f.on}
                    aria-label={`${f.label}: ${f.on ? "on" : "off"}`}
                    disabled={readOnly}
                    onClick={() => setEditing(f)}
                    className={`relative h-[24px] w-[42px] shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 disabled:opacity-50 ${f.on ? "bg-emerald-live" : "bg-white/[0.14]"}`}
                  >
                    <span className={`absolute top-[2px] h-[20px] w-[20px] rounded-full bg-white shadow transition-[left] duration-200 ${f.on ? "left-[20px]" : "left-[2px]"}`} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ))}
      {editing && <FeatureDialog company={d.company} feature={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

const UNTIL: { value: string; label: string; days: number | null }[] = [
  { value: "none", label: "No end date", days: null },
  { value: "7", label: "7 days", days: 7 },
  { value: "30", label: "30 days", days: 30 },
  { value: "90", label: "90 days", days: 90 },
];

function FeatureDialog({ company, feature, onClose }: { company: TenantDetail["company"]; feature: FeatureRow; onClose: () => void }) {
  const qc = useQueryClient();
  const target = !feature.on;
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("none");
  const save = useMutation({
    mutationFn: () => {
      const days = UNTIL.find((u) => u.value === until)?.days;
      return hub(`/tenants/${company.id}/features/${feature.key}`, {
        method: "PUT",
        body: { enabled: target, reason: reason.trim() || undefined, expiresAt: days ? new Date(Date.now() + days * 86_400_000).toISOString() : null },
      });
    },
    onSuccess: () => {
      toast({ kind: "success", message: `${feature.label} is ${target ? "on" : "off"} for ${company.name}.` });
      void qc.invalidateQueries({ queryKey: ["hub"] });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`Turn ${feature.label.toLowerCase()} ${target ? "on" : "off"}?`}
      subtitle={`For ${company.name} only. It takes effect within a minute.`}
      footer={
        <div className="flex justify-end gap-2">
          <BtnGhost onClick={onClose}>Cancel</BtnGhost>
          <BtnPrimary onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : target ? "Turn on" : "Turn off"}
          </BtnPrimary>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Why (optional)" hint="Shown to the team in the hub, not to the company.">
          <input aria-label="Why" className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder={target ? "e.g. Beta pilot, asked on the call" : "e.g. Not on their plan"} />
        </Field>
        <Field label="Until" hint="After that it goes back to the plan default by itself.">
          <select className={inputCls} value={until} onChange={(e) => setUntil(e.target.value)}>
            {UNTIL.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------- people -- */

function PeopleTab({ d, canActAs }: { d: TenantDetail; canActAs: boolean }) {
  const [who, setWho] = useState<Person | null>(null);
  const people = d.people.filter((p) => p.status === "active" && p.role !== "customer");
  return (
    <div className="space-y-6">
      {!d.company.allowSupportAccess && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 text-[13px] text-amber-100">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {d.company.name} has switched off support access. Ask an admin there to turn it on in Settings → Security before signing in as anyone.
        </div>
      )}
      <Card title="Team" caption="Office and field staff. Sign in as someone to see exactly what they see." pad={false}>
        {people.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyNote>No active team members yet.</EmptyNote>
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {people.map((p) => (
              <li key={p.userId} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-slate-100">
                    {p.name || p.email}
                    {p.sample && <span className="ml-2 text-[11px] text-slate-500">(sample)</span>}
                  </p>
                  <p className="truncate text-[12px] text-slate-500">
                    {OFFICE_ROLE_LABEL[p.role] ?? p.role} · {p.email}
                  </p>
                </div>
                {canActAs && !p.sample && (
                  <button
                    type="button"
                    disabled={!d.company.allowSupportAccess}
                    onClick={() => setWho(p)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-orange-400/30 px-2.5 py-1.5 text-[12px] font-semibold text-orange-200 hover:bg-orange-400/10 disabled:opacity-40"
                  >
                    <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
                    Sign in as
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {who && <ActAsDialog company={d.company} person={who} onClose={() => setWho(null)} />}
    </div>
  );
}

function ActAsDialog({ company, person, onClose }: { company: TenantDetail["company"]; person: Person; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState<string>("30");
  const start = useMutation({
    mutationFn: () => hub<{ session: { id: string; companyId: string } }>("/act-as", { method: "POST", body: { targetUserId: person.userId, companyId: company.id, reason, minutes: Number(minutes) } }),
    onSuccess: (r) => beginActAs(r.session.id, r.session.companyId, `/admin/hub/tenants/${company.id}?tab=people`),
  });
  const short = reason.trim().length < ACT_AS_MIN_REASON;
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`Sign in as ${person.name || person.email}?`}
      subtitle={`At ${company.name}, as ${OFFICE_ROLE_LABEL[person.role] ?? person.role}.`}
      footer={
        <div className="flex justify-end gap-2">
          <BtnGhost onClick={onClose}>Cancel</BtnGhost>
          <BtnPrimary onClick={() => start.mutate()} disabled={short || start.isPending}>
            {start.isPending ? "Starting…" : "Sign in as them"}
          </BtnPrimary>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Why" hint={`${company.name} sees this in their Audit Log, with your name.`}>
          <textarea aria-label="Why you are signing in as them" className={`${inputCls} min-h-[80px]`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. Tom can't see tomorrow's jobs on his phone" />
        </Field>
        <div>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">For</span>
          <Segmented ariaLabel="How long" value={minutes} onChange={setMinutes} options={ACT_AS_MINUTES.map((m) => ({ value: String(m), label: `${m} min` }))} />
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-[12px] text-slate-400">
          <p className="mb-1 flex items-center gap-1.5 font-semibold text-slate-300">
            <LifeBuoy className="h-3.5 w-3.5 text-orange-300" aria-hidden="true" />
            While you're signed in as them
          </p>
          You can change what they can change, and every change carries your name. You can't touch {ACT_AS_DENY.map((x) => x.label).join(", ")}, or passwords. It ends by itself when time's up.
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------ settings -- */

function SettingsTab({ d, readOnly }: { d: TenantDetail; readOnly: boolean }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const value = (k: string) => (k in draft ? draft[k] : d.settings[k]);
  const dirty = Object.keys(draft).filter((k) => draft[k] !== d.settings[k]);
  const save = useMutation({
    mutationFn: () => hub(`/tenants/${d.company.id}/settings`, { method: "PATCH", body: Object.fromEntries(dirty.map((k) => [k, draft[k]])) }),
    onSuccess: () => {
      toast({ kind: "success", message: `Saved. ${d.company.name} sees it in their Audit Log as a change by ArrivePing support.` });
      setDraft({});
      void qc.invalidateQueries({ queryKey: ["hub", "tenant", d.company.id] });
    },
  });
  const groups = useMemo(() => {
    const m = new Map<string, HubSettingDef[]>();
    for (const s of HUB_SETTINGS as readonly HubSettingDef[]) m.set(s.group, [...(m.get(s.group) ?? []), s]);
    return [...m.entries()];
  }, []);
  return (
    <div className="space-y-6">
      <p className="text-[13px] text-slate-400">The settings ArrivePing may tune for a company. Money, identity and their support-access choice stay theirs.</p>
      <div className="grid gap-6 lg:grid-cols-2">
        {groups.map(([group, defs]) => (
          <Card key={group} title={group}>
            <div className="space-y-4">
              {defs.map((s) => (
                <SettingControl key={s.key} def={s} value={value(s.key)} disabled={readOnly} onChange={(v) => setDraft((x) => ({ ...x, [s.key]: v }))} />
              ))}
            </div>
          </Card>
        ))}
      </div>
      {!readOnly && (
        <div className="sticky bottom-4 flex justify-end">
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-ink-2/95 px-4 py-3 shadow-2xl backdrop-blur">
            <span className="text-[13px] text-slate-400">{dirty.length ? `${dirty.length} change${dirty.length === 1 ? "" : "s"}` : "No changes"}</span>
            {dirty.length > 0 && <BtnGhost onClick={() => setDraft({})}>Undo</BtnGhost>}
            <BtnPrimary disabled={!dirty.length || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "Saving…" : "Save"}
            </BtnPrimary>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingControl({ def, value, disabled, onChange }: { def: HubSettingDef; value: unknown; disabled: boolean; onChange: (v: unknown) => void }) {
  const id = `hs-${def.key}`;
  if (def.type === "boolean") {
    return (
      <div>
        <Switch id={id} checked={Boolean(value)} onChange={(v) => !disabled && onChange(v)} label={def.label} />
        {def.help && <p className="mt-1 pl-12 text-[12px] text-slate-500">{def.help}</p>}
      </div>
    );
  }
  return (
    <Field label={def.label} hint={def.help}>
      {def.type === "choice" ? (
        <select id={id} disabled={disabled} className={inputCls} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {def.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : def.type === "int" ? (
        <div className="flex items-center gap-2">
          <input id={id} aria-label={def.label} disabled={disabled} type="number" min={def.min} max={def.max} className={inputCls} value={String(value ?? "")} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} />
          {def.unit && <span className="text-[12px] text-slate-500">{def.unit}</span>}
        </div>
      ) : (
        <input id={id} aria-label={def.label} disabled={disabled} className={inputCls} value={String(value ?? "")} maxLength={def.max} onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  );
}

/* ------------------------------------------------------------ activity -- */

function ActivityTab({ d }: { d: TenantDetail }) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card title="Their audit log" caption="What happened in the company, as they see it." pad={false}>
        {d.tenantAudit.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyNote>Nothing recorded yet.</EmptyNote>
          </div>
        ) : (
          <ol className="divide-y divide-white/[0.05]">
            {d.tenantAudit.map((e) => (
              <li key={e.id} className="px-5 py-2.5 text-[13px]">
                <p className="text-slate-200">
                  <span className="font-semibold text-white">{e.actorName || "System"}</span> {e.summary || `${e.action} ${e.entityType}`}
                </p>
                <p className="text-[11px] text-slate-500">
                  {fmt.ago(e.createdAt)}
                  {e.supportActorName ? <span className="ml-2 text-orange-300">by ArrivePing support ({e.supportActorName})</span> : null}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Card>
      <div className="space-y-6">
        <Card title="Act-as sessions" pad={false}>
          {d.sessions.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyNote>Nobody from ArrivePing has signed in as anyone here.</EmptyNote>
            </div>
          ) : (
            <ul className="divide-y divide-white/[0.05]">
              {d.sessions.map((s) => (
                <li key={s.id} className="px-5 py-2.5 text-[13px]">
                  <p className="text-slate-200">
                    <span className="font-semibold text-white">{s.actorName}</span> as {s.targetName}: {s.reason}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {fmt.ago(s.startedAt)} · {s.endedAt ? `ended (${s.endedReason})` : "still open"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Hub changes" caption="Switches, settings and account changes made from here." pad={false}>
          {d.hubAudit.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyNote>No hub changes yet.</EmptyNote>
            </div>
          ) : (
            <ul className="divide-y divide-white/[0.05]">
              {d.hubAudit.map((e) => (
                <li key={e.id} className="px-5 py-2.5 text-[13px]">
                  <p className="text-slate-200">
                    <span className="font-semibold text-white">{e.actorName}</span> {e.summary}
                  </p>
                  <p className="text-[11px] text-slate-500">{fmt.ago(e.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- manage -- */

function ManageTab({ d }: { d: TenantDetail }) {
  const me = useHubMe();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const c = d.company;
  const own = c.id === "default";
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => hub<{ changes: string[] }>(`/tenants/${c.id}`, { method: "PATCH", body }),
    onSuccess: (r) => {
      toast({ kind: "success", message: r.changes.length ? `Done: ${r.changes.join(", ")}.` : "Nothing changed." });
      void qc.invalidateQueries({ queryKey: ["hub"] });
    },
  });
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const del = useMutation({
    mutationFn: () => hub(`/api/superadmin/companies/${encodeURIComponent(c.id)}`, { method: "DELETE", body: { confirmName } }),
    onSuccess: () => {
      toast({ kind: "success", message: `${c.name} was deleted.` });
      void qc.invalidateQueries({ queryKey: ["hub"] });
      navigate("/admin/hub/tenants");
    },
  });
  const can = me.data?.can;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Plan and kind" caption={can?.editPlans ? "Owners only. A plan change can switch features on or off." : "Only an Owner can change these."}>
        <div className="space-y-4">
          <Field label="Plan">
            <select className={inputCls} disabled={!can?.editPlans || patch.isPending} value={c.plan} onChange={(e) => patch.mutate({ plan: e.target.value })}>
              {d.plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Kind" hint="Demo and test accounts stay out of the numbers and HubSpot, and get new versions first.">
            <select className={inputCls} disabled={!can?.editKinds || own || patch.isPending} value={c.kind} onChange={(e) => patch.mutate({ kind: e.target.value as TenantKind })}>
              {(["customer", "demo", "test"] as TenantKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
              {own && <option value="internal">ArrivePing</option>}
            </select>
          </Field>
          {c.kind === "demo" && (
            <Field label="Demo ends">
              <input
                aria-label="Demo ends"
                type="date"
                className={inputCls}
                value={c.demoExpiresAt ? c.demoExpiresAt.slice(0, 10) : ""}
                onChange={(e) => e.target.value && patch.mutate({ demoExpiresAt: new Date(`${e.target.value}T23:59:00`).toISOString() })}
              />
            </Field>
          )}
        </div>
      </Card>
      <Card title="Access" caption="Suspending stops everyone at the company signing in. Nothing is deleted.">
        <div className="flex flex-wrap items-center gap-3">
          {c.status === "active" ? (
            <BtnDanger disabled={own || patch.isPending} onClick={() => patch.mutate({ status: "suspended" })}>
              Suspend {c.name}
            </BtnDanger>
          ) : (
            <BtnPrimary disabled={patch.isPending || (c.status === "closed" && !can?.deleteTenants)} onClick={() => patch.mutate({ status: "active" })}>
              Reopen {c.name}
            </BtnPrimary>
          )}
          <span className="text-[12px] text-slate-500">Now: {c.status === "active" ? "open" : c.status}</span>
        </div>
      </Card>
      {can?.deleteTenants && !own && (
        <Card title="Delete for good" caption="Removes the company and everything in it. This can't be undone." className="lg:col-span-2">
          {!deleting ? (
            <BtnDanger onClick={() => setDeleting(true)}>Delete {c.name}…</BtnDanger>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <Field label={`Type “${c.name}” to confirm`}>
                <input aria-label="Company name to confirm" className={`${inputCls} min-w-[16rem]`} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
              </Field>
              <BtnDanger disabled={confirmName !== c.name || del.isPending} onClick={() => del.mutate()}>
                {del.isPending ? "Deleting…" : "Delete for good"}
              </BtnDanger>
              <BtnGhost onClick={() => setDeleting(false)}>Cancel</BtnGhost>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

