import { Fragment, useState, useEffect } from "react";
import { DialogPanel } from "../../components/dialog-panel";
import { useLocation } from "wouter";
import { keepPreviousData, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { InferRequestType } from "hono/client";
import { ok } from "../../lib/api-ok";
import { FullLoader } from "../../components/loader";
import { PageWrap } from "../../components/brand";
import { PageHead } from "./shell";
import { fmtDateShort, dismiss, activate, money } from "../../lib/utils";
import {
  Modal,
  Field,
  inputCls,
  BtnPrimary,
  BtnGhost,
  ConfirmModal,
} from "../../components/modal";
import { AddressAutocomplete } from "../../components/address-autocomplete";
import { TagPicker } from "../../components/tag-picker";
import { AttachmentManager } from "../../components/attachment-manager";
import { CustomFieldsForm } from "../../components/custom-fields";
import { WorkOrderModal } from "../../components/work-order-modal";
import { ImportMenu, type ImportType } from "../../components/import-menu";
import {
  Search,
  UserPlus,
  Trash2,
  Plus,
  X,
  Mail,
  Phone,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Building2,
  Sparkles,
  Info,
} from "lucide-react";
import { useWorkerNoun, useCustomerNoun } from "../../lib/use-brand";
import {
  rowGroupKey,
  NONE,
  type DirectoryGroup,
  type DirectoryKind,
  type DirectoryRow,
  type DirectorySort,
  type SortDir,
} from "../../../shared/directory-query";
import type { DirectoryFilter } from "../../../shared/directory-ask";
import {
  DirectoryProperties,
  invalidateDirectory,
  useDirectoryProperties,
  type PropertyItem,
} from "./directory-properties";

const ROLE_LABEL_BASE: Record<string, string> = {
  superadmin: "Super Admin",
  admin: "Dispatcher",
  rider: "Technician",
  manager: "Manager",
  dispatcher: "Dispatcher",
  project_manager: "Project Manager",
};
const ROLE_TINT: Record<string, string> = {
  superadmin: "bg-amber-500/15 text-amber-300",
  admin: "bg-violet-500/15 text-violet-300",
  manager: "bg-violet-500/15 text-violet-300",
  dispatcher: "bg-violet-500/15 text-violet-300",
  project_manager: "bg-violet-500/15 text-violet-300",
  rider: "bg-brand/15 text-cyan-glow",
  customer: "bg-emerald-live/15 text-emerald-live",
};

/**
 * The add form captures the client's business, not just a login: first/last
 * name so we can address them properly, plus company name, address and website
 * so a new client record is usable for quoting and invoicing without a second
 * pass through the drawer. `accountType` is the buying pattern (a single job vs
 * an ongoing account) — it is NOT the role; the role comes from the tab you
 * opened the modal from.
 */
/** Exactly what POST /admin/users accepts — a bad role can no longer compile. */
type NewUserForm = InferRequestType<typeof api.admin.users.$post>["json"];

const EMPTY_ADD_FORM: NewUserForm = {
  firstName: "",
  lastName: "",
  email: "",
  password: "",
  phone: "",
  role: "customer",
  company: "",
  address: "",
  city: "",
  region: "",
  postalCode: "",
  country: "",
  website: "",
  customerType: "one_time",
};

type Tab = DirectoryKind | "properties";

/** An AI search answer being shown: the question, and the filter it became. */
type AskState = { question: string; filter: DirectoryFilter; summary: string; notes: string[]; usedAI: boolean };

/** The import each tab offers. */
const IMPORT_FOR_TAB: Record<Tab, ImportType | undefined> = {
  all: undefined,
  customer: "customer",
  field: "rider",
  office: "admin",
  properties: "property",
};

/** How a viewer last arranged the Directory: theirs only, and only a convenience. */
const VIEW_KEY = "arriveping.directory.view";
type SavedView = { groupBy?: DirectoryGroup; sort?: DirectorySort; dir?: SortDir; pageSize?: number };
function loadView(): SavedView {
  try {
    return JSON.parse(localStorage.getItem(VIEW_KEY) || "{}") as SavedView;
  } catch {
    return {};
  }
}
function saveView(v: SavedView) {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch {
    /* private window: the view just isn't remembered */
  }
}

/** "Sep 2", or "Sep 2, 2024" when it isn't this year: joined and last-visit dates span years. */
function fmtDay(iso: string): string {
  const d = new Date(iso);
  const thisYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(thisYear ? {} : { year: "numeric" }) });
}

/** Numbers and dates read best biggest/newest first; names A–Z. */
const DESC_FIRST = new Set<DirectorySort>(["openJobs", "lastVisit", "joined"]);

/**
 * The Directory: everyone a company deals with, by kind, property and manager.
 *
 * The server runs the query (GET /directory, shared/directory-query.ts), so a
 * property manager with 2,500 residents sorts, groups and pages them without
 * the browser holding the whole list.
 */
export default function AdminClients() {
  const qc = useQueryClient();
  const { noun, nounPlural } = useWorkerNoun();
  const { noun: customerNoun, nounPlural: customerNounPlural } = useCustomerNoun();
  const roleLabel = (r: string) =>
    r === "rider" ? noun : r === "customer" ? customerNoun : ROLE_LABEL_BASE[r] ?? r;
  const [, go] = useLocation();
  const [saved] = useState(loadView);
  const [tab, setTab] = useState<Tab>("all");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<DirectorySort>(saved.sort ?? "name");
  const [dir, setDir] = useState<SortDir>(saved.dir ?? "asc");
  const [groupBy, setGroupBy] = useState<DirectoryGroup>(saved.groupBy ?? "none");
  const [propertyId, setPropertyId] = useState("");
  const [managerId, setManagerId] = useState("");
  const [pageSize, setPageSize] = useState(saved.pageSize ?? 25);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignOpen, setAssignOpen] = useState(false);
  const [propEdit, setPropEdit] = useState<PropertyItem | "new" | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [delUser, setDelUser] = useState<DirectoryRow | null>(null);
  const [detail, setDetail] = useState<DirectoryRow | null>(null);
  const [err, setErr] = useState("");
  const [form, setForm] = useState({ ...EMPTY_ADD_FORM });
  const [ask, setAsk] = useState<AskState | null>(null);
  const [askErr, setAskErr] = useState("");

  // Type, then wait a moment: one query per pause, not per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 250);
    return () => clearTimeout(t);
  }, [qInput]);

  // An AI answer's own order and grouping aren't the viewer's saved view.
  useEffect(() => {
    if (!ask) saveView({ groupBy, sort, dir, pageSize });
  }, [groupBy, sort, dir, pageSize, ask]);

  // A new filter is a new list: back to page 1, and nothing hidden stays selected.
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [tab, q, propertyId, managerId, groupBy, pageSize]);

  const peopleTab = tab === "properties" ? "all" : tab;
  const staffTab = tab === "field" || tab === "office";
  const params: Record<string, string> = {
    kind: peopleTab,
    q,
    sort,
    dir,
    groupBy: staffTab && (groupBy === "property" || groupBy === "manager") ? "none" : groupBy,
    page: String(page),
    pageSize: String(pageSize),
    ...(propertyId && !staffTab ? { propertyId } : {}),
    ...(managerId && !staffTab ? { managerId } : {}),
  };

  const directory = useQuery({
    queryKey: ["directory", params],
    enabled: !ask,
    placeholderData: keepPreviousData,
    queryFn: async () => ok(await api.directory.$get({ query: params })),
  });
  const props = useDirectoryProperties();

  // An AI answer re-runs its filter (never the model) to sort, group or page.
  const askFilter: DirectoryFilter | null = ask
    ? { ...ask.filter, kind: peopleTab, sort, dir, groupBy: params.groupBy as DirectoryGroup }
    : null;
  const askKey = (f: DirectoryFilter | null, pg: number, size: number) => ["directory", "ask", f, pg, size];
  const asked = useQuery({
    queryKey: askKey(askFilter, page, pageSize),
    enabled: !!askFilter,
    placeholderData: keepPreviousData,
    queryFn: async () => ok(await api.directory.ask.$post({ json: { filter: askFilter!, page, pageSize } })),
  });
  const askAvailable = useQuery({
    queryKey: ["directory-ask-available"],
    staleTime: 5 * 60_000,
    queryFn: async () => (await ok(await api.directory.ask.$get())).available,
  });

  const runAsk = useMutation({
    mutationFn: async (question: string) => ok(await api.directory.ask.$post({ json: { question, pageSize } })),
    onSuccess: (data, question) => {
      const f = data.ask.filter;
      setAskErr("");
      setTab(f.kind);
      setSort(f.sort);
      setDir(f.dir);
      setGroupBy(f.groupBy);
      setPropertyId("");
      setManagerId("");
      setPage(1);
      setAsk({ question, filter: f, summary: data.ask.summary, notes: data.ask.notes, usedAI: data.ask.usedAI });
      // The answer is already here: seed the re-run query so it isn't fetched again.
      const staff = f.kind === "field" || f.kind === "office";
      const g = staff && (f.groupBy === "property" || f.groupBy === "manager") ? "none" : f.groupBy;
      qc.setQueryData(askKey({ ...f, groupBy: g }, 1, pageSize), data);
    },
    onError: (e: Error) => setAskErr(e.message || "Couldn't search just now"),
  });
  const submitAsk = () => {
    const question = qInput.trim();
    if (question.length >= 2 && !runAsk.isPending) runAsk.mutate(question);
  };
  // Leaving an answer puts back the viewer's own order and grouping, so the
  // answer's never becomes their saved view (the save effect runs on exit).
  const exitAsk = () => {
    setAsk(null);
    setAskErr("");
    const v = loadView();
    setSort(v.sort ?? "name");
    setDir(v.dir ?? "asc");
    setGroupBy(v.groupBy ?? "none");
  };
  const clearAsk = () => {
    exitAsk();
    setQInput("");
    setQ("");
  };

  const create = useMutation({
    mutationFn: async () => {
      const res = await api.admin.users.$post({ json: form });
      const data = await res.json();
      if (!res.ok) throw new Error((data as any).message || "Failed");
      return data;
    },
    onSuccess: () => {
      invalidateDirectory(qc);
      setShowAdd(false);
      setForm({ ...EMPTY_ADD_FORM });
      setErr("");
    },
    onError: (e: any) => setErr(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.admin.users[":id"].$delete({ param: { id } });
      const data = await res.json();
      if (!res.ok) throw new Error((data as any).message || "Failed");
      return data;
    },
    onSuccess: () => {
      invalidateDirectory(qc);
      setDelUser(null);
    },
    onError: () => setDelUser(null),
  });

  const selectAllMatching = useMutation({
    mutationFn: async () =>
      askFilter
        ? ok(await api.directory.ask.$post({ json: { filter: askFilter, page: 1, pageSize, withIds: true } }))
        : ok(await api.directory.$get({ query: { ...params, page: "1", withIds: "1" } })),
    onSuccess: (r) => setSelected(new Set(r.ids ?? [])),
  });

  /**
   * The action button follows the tab you are looking at, so it never offers
   * to add a customer while you are staring at a technician list. Technicians
   * are not creatable from this directory (their create flow needs skills,
   * vehicle and payout fields), so that tab sends you to the technicians page.
   */
  const addAction =
    tab === "properties"
      ? { label: "Add property", icon: Building2, onClick: () => setPropEdit("new") }
      : tab === "field"
        ? { label: `Add ${noun}`, icon: UserPlus, onClick: () => go("/admin/techs") }
        : tab === "office"
          ? {
              label: "Add Dispatcher",
              icon: UserPlus,
              onClick: () => {
                setForm((f) => ({ ...f, role: "admin" }));
                setShowAdd(true);
              },
            }
          : {
              label: `Add ${customerNoun}`,
              icon: UserPlus,
              onClick: () => {
                setForm((f) => ({ ...f, role: "customer" }));
                setShowAdd(true);
              },
            };

  if (!ask && directory.isLoading && !directory.data) return <FullLoader label="Loading directory…" />;
  const result = ask ? asked.data : directory.data;
  const fetching = ask ? asked.isFetching && asked.isPlaceholderData : directory.isFetching && directory.isPlaceholderData;
  const rows = result?.rows ?? [];
  const kinds = result?.facets.kinds ?? { all: 0, customer: 0, field: 0, office: 0 };
  const propertyCount = props.data?.properties.length ?? directory.data?.propertyCount ?? 0;
  const effectiveGroup = (result?.groupBy ?? "none") as DirectoryGroup;
  const groupInfo = new Map((result?.groups ?? []).map((g) => [g.key, g]));
  const showPlacement = tab === "all" || tab === "customer";
  const selectable = (r: DirectoryRow) => r.kind === "customer";
  const pageSelectable = rows.filter(selectable);
  const allOnPage = pageSelectable.length > 0 && pageSelectable.every((r) => selected.has(r.id));
  const filtersOn = !!(propertyId || managerId || q || ask);

  // Property and manager pickers: what's in this tab and search, plus whatever
  // is picked (a property with nobody in it yet still shows its name).
  const propertyOptions = (() => {
    const list = (result?.facets.properties ?? []).map((p) => ({ id: p.id, label: `${p.name} (${p.count})` }));
    if (propertyId && !list.some((p) => p.id === propertyId)) {
      const p = props.data?.properties.find((x) => x.id === propertyId);
      list.unshift({ id: propertyId, label: `${p?.name ?? "Property"} (0)` });
    }
    return list;
  })();
  const managerOptions = (() => {
    const list = (result?.facets.managers ?? []).map((m) => ({ id: m.id, label: `${m.name} (${m.count})` }));
    if (managerId && !list.some((m) => m.id === managerId)) {
      const s = props.data?.staff.find((x) => x.id === managerId);
      list.unshift({ id: managerId, label: `${s?.name ?? "Manager"} (0)` });
    }
    return list;
  })();

  const sortBy = (k: DirectorySort) => {
    if (k === sort) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(k);
      setDir(DESC_FIRST.has(k) ? "desc" : "asc");
    }
  };
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const togglePage = () =>
    setSelected((s) => {
      const n = new Set(s);
      for (const r of pageSelectable) {
        if (allOnPage) n.delete(r.id);
        else n.add(r.id);
      }
      return n;
    });

  const viewResidents = (pid: string) => {
    setTab("customer");
    setManagerId("");
    setPropertyId(pid);
  };

  const tabs: [Tab, string, number][] = [
    ["all", "All", kinds.all],
    ["customer", customerNounPlural, kinds.customer],
    ["field", nounPlural, kinds.field],
    ["office", "Office staff", kinds.office],
    ["properties", "Properties", propertyCount],
  ];

  type Col = { key: string; label: string; sort?: DirectorySort; cls?: string };
  const cols: Col[] = showPlacement
    ? [
        { key: "name", label: "Name", sort: "name" },
        ...(tab === "all" ? [{ key: "role", label: "Type", sort: "role" as const, cls: "hidden lg:table-cell" }] : []),
        { key: "property", label: "Property", sort: "property", cls: "hidden md:table-cell" },
        { key: "unit", label: "Unit", sort: "unit", cls: "hidden md:table-cell" },
        { key: "manager", label: "Manager", sort: "manager", cls: "hidden lg:table-cell" },
        { key: "contact", label: "Contact", sort: "email", cls: "hidden sm:table-cell" },
        ...(tab === "customer"
          ? [
              { key: "openJobs", label: "Open", sort: "openJobs" as const, cls: "hidden text-right xl:table-cell" },
              { key: "lastVisit", label: "Last visit", sort: "lastVisit" as const, cls: "hidden text-right xl:table-cell" },
            ]
          : [{ key: "joined", label: "Joined", sort: "joined" as const, cls: "hidden text-right xl:table-cell" }]),
      ]
    : [
        { key: "name", label: "Name", sort: "name" },
        { key: "role", label: "Role", sort: "role" },
        { key: "contact", label: "Contact", sort: "email", cls: "hidden sm:table-cell" },
        { key: "manages", label: "Manages", cls: "hidden text-right md:table-cell" },
        { key: "joined", label: "Joined", sort: "joined", cls: "hidden text-right lg:table-cell" },
      ];
  const colSpan = cols.length + 2;

  const cell = (r: DirectoryRow, c: Col) => {
    switch (c.key) {
      case "name":
        return (
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand/15 text-xs font-bold text-cyan-glow">
              {r.name?.[0]?.toUpperCase() ?? "U"}
            </div>
            <div className="min-w-0 max-w-[52vw] md:max-w-none">
              <p className="flex items-center gap-1.5 truncate font-semibold text-slate-100">
                <span className="truncate">{r.name || r.email}</span>
                {r.status === "invited" && <span className="rounded-full bg-cyan-glow/10 px-1.5 py-px text-[10px] font-semibold text-cyan-glow">Invited</span>}
                {r.status === "disabled" && <span className="rounded-full bg-white/5 px-1.5 py-px text-[10px] font-semibold text-slate-500">Deactivated</span>}
              </p>
              {/* Small screens: the columns that are hidden, folded under the name. */}
              {r.kind === "customer" && (r.propertyName || r.managerName) && (
                <p className="truncate text-xs text-slate-500 md:hidden">
                  {/* Under a property header, the property and its manager are already said. */}
                  {(effectiveGroup === "property"
                    ? [r.unit && `Unit ${r.unit}`]
                    : [r.propertyName, r.unit && `Unit ${r.unit}`, effectiveGroup === "manager" ? "" : r.managerName]
                  )
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
              <p className="truncate text-xs text-slate-500 sm:hidden">{r.phone || r.email}</p>
            </div>
          </div>
        );
      case "role":
        return (
          <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${ROLE_TINT[r.role] ?? "bg-white/5 text-slate-400"}`}>
            {roleLabel(r.role)}
          </span>
        );
      case "property":
        return r.propertyName ? (
          <span className="block max-w-[200px] truncate text-slate-200" title={r.propertyAddress || undefined}>{r.propertyName}</span>
        ) : r.kind === "customer" ? (
          <span className="text-slate-600">—</span>
        ) : null;
      case "unit":
        return r.unit ? <span className="text-slate-300">{r.unit}</span> : null;
      case "manager":
        return r.managerName ? <span className="block max-w-[180px] truncate text-slate-300">{r.managerName}</span> : null;
      case "contact":
        return (
          <div className="min-w-0 max-w-[240px] text-xs">
            {r.email && (
              <a href={`mailto:${r.email}`} onClick={(e) => e.stopPropagation()} className="block truncate text-slate-300 hover:text-white">
                {r.email}
              </a>
            )}
            {r.phone && (
              <a href={`tel:${r.phone}`} onClick={(e) => e.stopPropagation()} className="block truncate text-slate-500 hover:text-white">
                {r.phone}
              </a>
            )}
            {!r.email && !r.phone && <span className="text-slate-600">—</span>}
          </div>
        );
      case "openJobs":
        return r.openJobs ? (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-300">{r.openJobs}</span>
        ) : (
          <span className="text-slate-600">0</span>
        );
      case "lastVisit":
        return <span className="whitespace-nowrap text-slate-400">{r.lastVisitAt ? fmtDay(r.lastVisitAt) : "—"}</span>;
      case "joined":
        return <span className="whitespace-nowrap text-slate-500">{r.createdAt ? fmtDay(r.createdAt) : "—"}</span>;
      case "manages":
        return r.managedCount ? (
          <span className="text-slate-300">
            {r.managedCount} {r.managedCount === 1 ? "property" : "properties"}
          </span>
        ) : (
          <span className="text-slate-600">—</span>
        );
      default:
        return null;
    }
  };

  const selectCls = "rounded-full border border-white/10 bg-ink-2 px-3 py-2 text-xs font-semibold text-slate-200 outline-none focus:border-brand";

  return (
    <PageWrap>
      <PageHead
        title="Directory"
        subtitle={
          tab === "properties"
            ? `${propertyCount.toLocaleString()} ${propertyCount === 1 ? "property" : "properties"}`
            : `${(result?.total ?? 0).toLocaleString()} ${(result?.total ?? 0) === 1 ? "person" : "people"}${filtersOn ? " match" : ""}`
        }
        actions={
          <div className="flex items-center gap-2" data-tour="people.add">
            <ImportMenu
              types={["customer", "rider", "admin", "property"]}
              activeType={IMPORT_FOR_TAB[tab]}
              customerLabel={customerNounPlural}
              workerLabel={nounPlural}
              onDone={() => invalidateDirectory(qc)}
            />
            <BtnPrimary onClick={addAction.onClick}>
              <addAction.icon className="h-4 w-4" /> {addAction.label}
            </BtnPrimary>
          </div>
        }
      />

      <div className="-mx-1 mb-3 overflow-x-auto px-1" data-tour="people.filters">
        <div className="flex w-max gap-1.5" role="tablist" aria-label="Directory sections">
          {tabs.map(([t, label, count]) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                tab === t ? "bg-brand text-white" : "bg-ink-2 text-slate-400 hover:bg-white/5"
              }`}
            >
              {label}
              <span className={`rounded-full px-1.5 text-[10px] ${tab === t ? "bg-white/20" : "bg-white/5 text-slate-500"}`}>{count.toLocaleString()}</span>
            </button>
          ))}
        </div>
      </div>

      {tab === "properties" ? (
        <DirectoryProperties
          edit={propEdit}
          setEdit={setPropEdit}
          onViewResidents={viewResidents}
          customerNoun={customerNoun}
          customerNounPlural={customerNounPlural}
        />
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            {/* Typing searches as you go; Enter or Ask reads it as a question. */}
            <form
              className="relative lg:w-[30rem]"
              onSubmit={(e) => {
                e.preventDefault();
                submitAsk();
              }}
            >
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
              <input
                aria-label="Search the directory, or ask a question"
                value={qInput}
                maxLength={300}
                onChange={(e) => {
                  setQInput(e.target.value);
                  // Editing the question goes back to searching as you type.
                  if (ask) exitAsk();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && (ask || qInput)) clearAsk();
                }}
                placeholder={showPlacement ? "Search, or ask: “Maple Court residents with open requests”" : "Search, or ask a question…"}
                className="w-full rounded-full border border-white/10 bg-ink-2 py-2 pl-9 pr-24 text-sm text-white outline-none placeholder:text-slate-600 focus:border-brand"
              />
              <button
                type="submit"
                disabled={qInput.trim().length < 2 || runAsk.isPending}
                title={askAvailable.data ? "Ask in plain words (AI)" : "Ask in plain words (keyword reading: AI search is off)"}
                className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-full bg-brand/15 px-3 py-1.5 text-xs font-semibold text-cyan-glow transition hover:bg-brand/25 disabled:opacity-40"
              >
                <Sparkles className={`h-3.5 w-3.5 ${runAsk.isPending ? "animate-pulse" : ""}`} aria-hidden />
                {runAsk.isPending ? "Asking…" : "Ask"}
              </button>
            </form>
            <div className="flex flex-wrap items-center gap-2">
              {showPlacement && !ask && (
                <>
                  <select aria-label="Filter by property" className={selectCls} value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
                    <option value="">All properties</option>
                    {propertyOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <select aria-label="Filter by manager" className={selectCls} value={managerId} onChange={(e) => setManagerId(e.target.value)}>
                    <option value="">All managers</option>
                    {managerOptions.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </>
              )}
              {/* Small screens hide most column headers, so sorting gets its own control. */}
              <select
                aria-label="Sort by"
                className={`${selectCls} md:hidden`}
                value={`${sort}:${dir}`}
                onChange={(e) => {
                  const [k, d] = e.target.value.split(":") as [DirectorySort, SortDir];
                  setSort(k);
                  setDir(d);
                }}
              >
                <option value="name:asc">Name A–Z</option>
                <option value="name:desc">Name Z–A</option>
                {showPlacement && <option value="property:asc">Property A–Z</option>}
                {showPlacement && <option value="unit:asc">Unit</option>}
                {showPlacement && <option value="manager:asc">Manager A–Z</option>}
                {tab === "customer" && <option value="openJobs:desc">Most open requests</option>}
                {tab === "customer" && <option value="lastVisit:desc">Last visit, newest</option>}
                <option value="joined:desc">Newest first</option>
                {![
                  "name:asc", "name:desc", "property:asc", "unit:asc", "manager:asc", "openJobs:desc", "lastVisit:desc", "joined:desc",
                ].includes(`${sort}:${dir}`) && <option value={`${sort}:${dir}`}>Custom sort</option>}
              </select>
              <select aria-label="Group by" className={selectCls} value={staffTab && groupBy !== "role" ? "none" : groupBy} onChange={(e) => setGroupBy(e.target.value as DirectoryGroup)}>
                <option value="none">No grouping</option>
                {showPlacement && <option value="property">Group by property</option>}
                {showPlacement && <option value="manager">Group by manager</option>}
                <option value="role">Group by type</option>
              </select>
              {filtersOn && !ask && (
                <button
                  onClick={() => {
                    setQInput("");
                    setQ("");
                    setPropertyId("");
                    setManagerId("");
                  }}
                  className="flex items-center gap-1 rounded-full px-2.5 py-2 text-xs font-semibold text-slate-400 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" aria-hidden /> Clear
                </button>
              )}
            </div>
          </div>

          {askErr && <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{askErr}</p>}
          {ask && (
            <div className="mb-3 rounded-xl border border-brand/30 bg-brand/[0.06] px-4 py-3" aria-live="polite">
              <div className="flex flex-wrap items-start gap-2">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-cyan-glow" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white">
                    {ask.summary || `“${ask.question}”`}
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      {(result?.total ?? 0).toLocaleString()} {(result?.total ?? 0) === 1 ? "match" : "matches"}
                    </span>
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {(asked.data?.ask.chips ?? []).map((chip) => (
                      <span key={chip} className="rounded-full border border-white/10 bg-ink-2 px-2 py-0.5 text-[11px] font-semibold text-slate-300">
                        {chip}
                      </span>
                    ))}
                    {!ask.usedAI && (
                      <span
                        title="AI search is off or busy right now, so the question was read by its keywords and property and team names."
                        className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-slate-500"
                      >
                        Keyword reading
                      </span>
                    )}
                  </div>
                  {ask.notes.map((n) => (
                    <p key={n} className="mt-1.5 flex items-center gap-1 text-xs text-amber-300">
                      <Info className="h-3 w-3 shrink-0" aria-hidden /> {n}
                    </p>
                  ))}
                </div>
                <button onClick={clearAsk} className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-slate-400 hover:text-white">
                  <X className="h-3.5 w-3.5" aria-hidden /> Clear
                </button>
              </div>
            </div>
          )}

          {selected.size > 0 && (
            <div className="sticky top-2 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-brand/40 bg-ink-2/95 px-4 py-2.5 text-sm shadow-xl backdrop-blur">
              <span className="font-semibold text-white">{selected.size.toLocaleString()} selected</span>
              {tab === "customer" && allOnPage && result && selected.size < result.total && (
                <button
                  onClick={() => selectAllMatching.mutate()}
                  disabled={selectAllMatching.isPending}
                  className="text-xs font-semibold text-cyan-glow hover:underline disabled:opacity-50"
                >
                  {selectAllMatching.isPending ? "Selecting…" : `Select all ${result.total.toLocaleString()} matching`}
                </button>
              )}
              <div className="ml-auto flex flex-wrap gap-2">
                <BtnPrimary onClick={() => setAssignOpen(true)}>
                  <Building2 className="h-4 w-4" /> Assign to property
                </BtnPrimary>
                <BtnGhost onClick={() => setSelected(new Set())}>Clear</BtnGhost>
              </div>
            </div>
          )}

          <div className={`nvc-card overflow-hidden transition-opacity ${fetching || runAsk.isPending ? "opacity-70" : ""}`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5 text-left text-xs text-slate-500">
                    <th className="w-10 py-3 pl-4">
                      {pageSelectable.length > 0 && (
                        <input
                          type="checkbox"
                          aria-label={allOnPage ? "Unselect everyone on this page" : "Select everyone on this page"}
                          checked={allOnPage}
                          onChange={togglePage}
                          className="h-4 w-4 accent-cyan-500"
                        />
                      )}
                    </th>
                    {cols.map((c) => (
                      <th
                        key={c.key}
                        className={`px-3 py-3 font-semibold ${c.cls ?? ""}`}
                        aria-sort={c.sort && sort === c.sort ? (dir === "asc" ? "ascending" : "descending") : undefined}
                      >
                        {c.sort ? (
                          <button
                            onClick={() => sortBy(c.sort!)}
                            className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-white ${sort === c.sort ? "text-slate-200" : ""}`}
                          >
                            {c.label}
                            {sort === c.sort && (dir === "asc" ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)}
                          </button>
                        ) : (
                          <span className="uppercase tracking-wide">{c.label}</span>
                        )}
                      </th>
                    ))}
                    <th className="relative px-4 py-3 text-right font-semibold">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={colSpan} className="py-12 text-center text-slate-500">
                        {filtersOn ? "Nobody matches. Try fewer words, or clear the filters." : "Nobody here yet"}
                      </td>
                    </tr>
                  ) : (
                    rows.map((r, i) => {
                      const gk = effectiveGroup !== "none" ? rowGroupKey(r, effectiveGroup) : "";
                      const prevKey = i > 0 && effectiveGroup !== "none" ? rowGroupKey(rows[i - 1]!, effectiveGroup) : null;
                      const g = gk && gk !== prevKey ? groupInfo.get(gk) : undefined;
                      const gLabel = g ? (effectiveGroup === "role" && g.key !== NONE ? roleLabel(g.key) : g.label) : "";
                      return (
                        <Fragment key={r.id}>
                          {g && (
                            <tr className="bg-white/[0.035]">
                              <td colSpan={colSpan} className="px-4 py-2" aria-label={`${gLabel}: ${g.count}`}>
                                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                  <span className="text-xs font-bold uppercase tracking-wide text-slate-200">
                                    {gLabel}
                                  </span>
                                  <span className="text-xs text-slate-500">{g.count.toLocaleString()}</span>
                                  {g.sublabel && <span className="text-xs text-slate-500">{g.sublabel}</span>}
                                  {i === 0 && page > 1 && <span className="text-[11px] text-slate-600">(continued)</span>}
                                </div>
                              </td>
                            </tr>
                          )}
                          <tr onClick={() => setDetail(r)} className={`cursor-pointer hover:bg-white/[0.03] ${selected.has(r.id) ? "bg-brand/[0.06]" : ""}`}>
                            <td className="w-10 py-3 pl-4" onClick={(e) => e.stopPropagation()}>
                              {selectable(r) && (
                                <input
                                  type="checkbox"
                                  aria-label={`Select ${r.name || r.email}`}
                                  checked={selected.has(r.id)}
                                  onChange={() => toggle(r.id)}
                                  className="h-4 w-4 accent-cyan-500"
                                />
                              )}
                            </td>
                            {cols.map((c) => (
                              <td key={c.key} className={`px-3 py-3 ${c.cls ?? ""}`}>
                                {cell(r, c)}
                              </td>
                            ))}
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDelUser(r);
                                }}
                                aria-label={`Delete account ${r.name}`}
                                title="Delete account"
                                className="grid h-8 w-8 place-items-center rounded-lg text-slate-600 transition hover:bg-red-500/10 hover:text-red-400"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {result && result.total > 0 && (
              <PaginationBar
                page={result.page}
                totalPages={result.totalPages}
                pageSize={pageSize}
                total={result.total}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
              />
            )}
          </div>
        </>
      )}

      {/* add client modal */}
      <Modal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title={form.role === "admin" ? "Add Dispatcher" : `Add ${customerNoun}`}
        subtitle={`Create a ${form.role === "admin" ? "dispatcher" : customerNoun.toLowerCase()} login`}
        footer={
          <>
            <BtnGhost onClick={() => setShowAdd(false)}>Cancel</BtnGhost>
            <BtnPrimary
              disabled={
                !form.firstName ||
                !form.lastName ||
                !form.email ||
                !form.password ||
                create.isPending
              }
              onClick={() => create.mutate()}
            >
              <Plus className="h-4 w-4" />
              {create.isPending ? "Creating…" : "Create"}
            </BtnPrimary>
          </>
        }
      >
        <div className="space-y-3">
          {err && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{err}</p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name">
              <input aria-label="First name" className={inputCls} value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })} placeholder="Jane" />
            </Field>
            <Field label="Last name">
              <input aria-label="Last name" className={inputCls} value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })} placeholder="Doe" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email">
              <input aria-label="jane@email.com" className={inputCls} type="email" value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jane@email.com" />
            </Field>
            <Field label="Temp password">
              <input aria-label="min 8 chars" className={inputCls} value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="min 8 chars" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone">
              <input aria-label="+1 416 555 9999" className={inputCls} value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 416 555 9999" />
            </Field>
            {form.role === "customer" ? (
              <Field label="Account type">
                <select aria-label="Account type" className={inputCls} value={form.customerType}
                  onChange={(e) => setForm({ ...form, customerType: e.target.value as NewUserForm["customerType"] })}>
                  <option value="one_time">One-time client</option>
                  <option value="repeat">Repeat customer</option>
                </select>
              </Field>
            ) : (
              <Field label="Role">
                <input aria-label="Role" className={`${inputCls} opacity-60`} value="Dispatcher" readOnly />
              </Field>
            )}
          </div>

          {form.role === "customer" && (
            <div className="space-y-3 border-t border-white/10 pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Company</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Company name">
                  <input aria-label="Company name" className={inputCls} value={form.company}
                    onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Acme Inc." />
                </Field>
                <Field label="Company website">
                  <input aria-label="Company website" className={inputCls} value={form.website}
                    onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="acme.com" />
                </Field>
              </div>
              <Field label="Company address">
                <AddressAutocomplete
                  value={form.address ?? ""}
                  placeholder="123 Main St, Toronto, ON"
                  onResolve={({ address }) =>
                    setForm((f) => ({ ...f, ...applyAddressParts(f, address) }))
                  }
                />
              </Field>
            </div>
          )}
        </div>
      </Modal>

      <ConfirmModal
        open={!!delUser}
        onClose={() => setDelUser(null)}
        onConfirm={() => delUser && del.mutate(delUser.id)}
        title="Delete account"
        message={`Permanently delete ${delUser?.name ?? "this account"} (${delUser?.email ?? ""})? This cannot be undone.`}
        pending={del.isPending}
      />

      <AssignModal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        ids={[...selected]}
        properties={props.data?.properties ?? []}
        customerNounPlural={customerNounPlural}
        onDone={() => {
          setAssignOpen(false);
          setSelected(new Set());
        }}
      />

      <ClientDrawer person={detail} properties={props.data?.properties ?? []} onClose={() => setDetail(null)} />
    </PageWrap>
  );
}

/**
 * Put the selected people at a property (made here if it's new), or take them
 * off theirs. Moving several keeps each person's unit; one person can be given
 * a unit as they move.
 */
function AssignModal({
  open,
  onClose,
  ids,
  properties,
  customerNounPlural,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  ids: string[];
  properties: PropertyItem[];
  customerNounPlural: string;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [choice, setChoice] = useState("");
  const [newName, setNewName] = useState("");
  const [unit, setUnit] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setChoice("");
    setNewName("");
    setUnit("");
    setErr("");
  }, [open]);

  const assign = useMutation({
    mutationFn: async () => {
      let propertyId: string | null = choice === NONE ? null : choice;
      if (choice === "new") {
        const res = await api.directory.properties.$post({ json: { name: newName.trim() } });
        const data = await res.json();
        if (!res.ok) throw new Error((data as { message?: string }).message || "Couldn't add the property");
        propertyId = (data as { id: string }).id;
      }
      const res = await api.directory.assign.$post({
        json: { userIds: ids, propertyId, ...(ids.length === 1 && propertyId && unit.trim() ? { unit: unit.trim() } : {}) },
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { message?: string }).message || "Couldn't move them");
      return data;
    },
    onSuccess: () => {
      invalidateDirectory(qc);
      onDone();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const who = ids.length === 1 ? "this person" : `these ${ids.length.toLocaleString()} ${customerNounPlural.toLowerCase()}`;
  const ready = choice === "new" ? !!newName.trim() : !!choice;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Assign to property"
      subtitle={`Where ${who} live${ids.length === 1 ? "s" : ""}`}
      size="sm"
      footer={
        <>
          <BtnGhost onClick={onClose}>Cancel</BtnGhost>
          <BtnPrimary disabled={!ready || assign.isPending} onClick={() => assign.mutate()}>
            {assign.isPending ? "Saving…" : choice === NONE ? "Remove from property" : "Assign"}
          </BtnPrimary>
        </>
      }
    >
      <div className="space-y-3">
        {err && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{err}</p>}
        <Field label="Property">
          <select aria-label="Property" className={inputCls} value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="" disabled>
              Pick a property…
            </option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.managerName ? ` · ${p.managerName}` : ""}
              </option>
            ))}
            <option value="new">+ New property…</option>
            <option value={NONE}>No property (take them off theirs)</option>
          </select>
        </Field>
        {choice === "new" && (
          <Field label="New property name">
            <input aria-label="New property name" className={inputCls} value={newName} maxLength={120} onChange={(e) => setNewName(e.target.value)} placeholder="Maple Court" />
          </Field>
        )}
        {ids.length === 1 && choice !== NONE && choice !== "" && (
          <Field label="Unit (optional)">
            <input aria-label="Unit" className={inputCls} value={unit} maxLength={40} onChange={(e) => setUnit(e.target.value)} placeholder="4B" />
          </Field>
        )}
        {ids.length > 1 && choice !== NONE && choice !== "" && (
          <p className="text-xs text-slate-500">Everyone keeps their own unit. Set a unit on each person's record.</p>
        )}
        {choice === "new" && <p className="text-xs text-slate-500">Add its address and manager afterwards on the Properties tab.</p>}
      </div>
    </Modal>
  );
}

const PAGE_SIZE_OPTIONS = [25, 50, 100];

/**
 * Bottom-of-table controls: a page-size picker on the left (25/50/100 rows —
 * 25 is the default so a big tenant's directory never dumps hundreds of rows
 * onto one screen), and page number buttons plus prev/next on the right. Page
 * numbers collapse to first/last + a window around the current page with "…"
 * once there are more pages than fit, so a 500-row directory at 25/page (20
 * pages) never turns into 20 buttons in a row.
 */
function PaginationBar({
  page,
  totalPages,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  totalPages: number;
  pageSize: number;
  total: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (n: number) => void;
}) {
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(total, page * pageSize);

  const pageNumbers = (() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const nums = new Set<number>([1, 2, totalPages - 1, totalPages, page - 1, page, page + 1]);
    return [...nums].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  })();

  return (
    <div className="flex flex-col gap-3 border-t border-white/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span>
          {rangeStart}–{rangeEnd} of {total}
        </span>
        <span className="text-slate-700">·</span>
        <label className="flex items-center gap-1.5">
          Show
          <select
            aria-label="Rows per page"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="rounded-lg border border-white/10 bg-ink-2 px-1.5 py-1 text-xs text-slate-200 outline-none focus:border-brand"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          per page
        </label>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label="Previous page"
            className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 text-slate-300 transition hover:bg-white/5 disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          {pageNumbers.map((n, i) => {
            const prev = pageNumbers[i - 1];
            const gap = prev != null && n - prev > 1;
            return (
              <span key={n} className="flex items-center gap-1">
                {gap && <span className="px-1 text-slate-600">…</span>}
                <button
                  onClick={() => onPageChange(n)}
                  aria-label={`Page ${n}`}
                  aria-current={n === page ? "page" : undefined}
                  className={`grid h-8 min-w-[2rem] place-items-center rounded-lg px-2 text-xs font-semibold transition ${
                    n === page
                      ? "bg-brand text-white"
                      : "border border-white/10 text-slate-300 hover:bg-white/5"
                  }`}
                >
                  {n}
                </button>
              </span>
            );
          })}
          <button
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            aria-label="Next page"
            className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 text-slate-300 transition hover:bg-white/5 disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function updateArr(
  form: any,
  setForm: (v: any) => void,
  key: string,
  index: number,
  patch: Record<string, any>,
) {
  const next = form[key].map((item: any, i: number) =>
    i === index ? { ...item, ...patch } : item,
  );
  setForm({ ...form, [key]: next });
}

/**
 * Best-effort split of a formatted address ("123 Main St, Toronto, ON M5V 2T6,
 * Canada") into the structured fields the additional-site rows use. The street
 * line keeps everything before the first comma; the rest is parsed loosely so a
 * single autocomplete pick fills city / region / postal where we can detect them.
 */
function parseAddressFields(formatted: string): {
  line: string;
  city?: string;
  region?: string;
  postalCode?: string;
} {
  const parts = formatted.split(",").map((p) => p.trim()).filter(Boolean);
  const line = parts[0] ?? formatted;
  const city = parts.length >= 2 ? parts[1] : undefined;
  // "ON M5V 2T6" -> region "ON", postal "M5V 2T6"
  const regionChunk = parts[2] ?? "";
  const m = regionChunk.match(/^([A-Za-z]{2,})\s*(.*)$/);
  return {
    line,
    ...(city ? { city } : {}),
    ...(m?.[1] ? { region: m[1] } : {}),
    ...(m?.[2] ? { postalCode: m[2].trim() } : {}),
  };
}

/** Same parse but mapped onto the primary-address form's flat field names. */
function applyAddressParts(prev: any, formatted: string) {
  const p = parseAddressFields(formatted);
  return {
    address: formatted,
    ...(p.city ? { city: p.city } : { city: prev.city }),
    ...(p.region ? { region: p.region } : { region: prev.region }),
    ...(p.postalCode ? { postalCode: p.postalCode } : { postalCode: prev.postalCode }),
  };
}

function ClientDrawer({
  person,
  properties,
  onClose,
}: {
  /** The Directory row that was clicked; the full record loads from it. */
  person: DirectoryRow | null;
  properties: PropertyItem[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const record = useQuery({
    queryKey: ["admin-user", person?.id],
    enabled: !!person,
    queryFn: async () => (await ok(await api.admin.users[":id"].$get({ param: { id: person!.id } }))).user,
  });
  const full = record.data && record.data.id === person?.id ? record.data : null;
  // Where they live: saved with the profile, through POST /directory/assign.
  const [placement, setPlacement] = useState({ propertyId: "", unit: "" });
  const [tab, setTab] = useState<"profile" | "jobs" | "files">("profile");
  const [viewJob, setViewJob] = useState<any>(null);
  const [, navigate] = useLocation();
  // Completed jobs are historical now — open the read-only report instead
  // of the editable work order.
  const openJob = (b: any) => {
    if (b.status === "completed") navigate(`/admin/jobs/${b.id}/report`);
    else setViewJob(b);
  };
  const [form, setForm] = useState<any>({
    name: "",
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    altPhone: "",
    company: "",
    website: "",
    customerType: "",
    address: "",
    city: "",
    region: "",
    postalCode: "",
    country: "",
    notes: "",
    addresses: [] as any[],
    contacts: [] as any[],
  });
  const [saveErr, setSaveErr] = useState("");

  useEffect(() => {
    setPlacement({ propertyId: person?.propertyId ?? "", unit: person?.unit ?? "" });
  }, [person]);

  useEffect(() => {
    const user = full;
    if (user) {
      // Records created before the name split only have a single `name`; fall
      // back to splitting it so the fields are never blank for old clients.
      const [fallbackFirst, ...fallbackRest] = (user.name ?? "").trim().split(/\s+/);
      setForm({
        name: user.name ?? "",
        firstName: user.firstName || fallbackFirst || "",
        lastName: user.lastName || fallbackRest.join(" "),
        email: user.email ?? "",
        phone: user.phone ?? "",
        altPhone: user.altPhone ?? "",
        company: user.company ?? "",
        website: user.website ?? "",
        customerType: user.customerType || "one_time",
        address: user.address ?? "",
        city: user.city ?? "",
        region: user.region ?? "",
        postalCode: user.postalCode ?? "",
        country: user.country ?? "",
        notes: user.notes ?? "",
        addresses: Array.isArray(user.addresses) ? user.addresses : [],
        contacts: Array.isArray(user.contacts) ? user.contacts : [],
      });
      setSaveErr("");
    }
  }, [full]);

  const placementChanged =
    !!person && person.kind === "customer" && (placement.propertyId !== (person.propertyId ?? "") || placement.unit.trim() !== person.unit);

  const save = useMutation({
    mutationFn: async () => {
      const res = await api.admin.users[":id"].$patch({ param: { id: person!.id }, json: form });
      const data = await res.json();
      if (!res.ok) throw new Error((data as any).message || "Save failed");
      if (placementChanged) {
        const r = await api.directory.assign.$post({
          json: { userIds: [person!.id], propertyId: placement.propertyId || null, unit: placement.unit.trim() },
        });
        const d = await r.json();
        if (!r.ok) throw new Error((d as { message?: string }).message || "Saved, but their property didn't change");
      }
      return data;
    },
    onSuccess: () => {
      invalidateDirectory(qc);
      qc.invalidateQueries({ queryKey: ["admin-user", person?.id] });
      setSaveErr("");
    },
    onError: (e: any) => setSaveErr(e.message),
  });

  const bookings = useQuery({
    queryKey: ["admin-bookings"],
    enabled: !!person,
    queryFn: async () => ok(await api.bookings.$get()),
  });

  if (!person) return null;
  const user = full ?? person;
  const isClient = person.kind === "customer";
  const placedAt = properties.find((p) => p.id === placement.propertyId);
  const allBookings = (() => {
    const d: any = bookings.data;
    if (Array.isArray(d)) return d;
    if (Array.isArray(d?.bookings)) return d.bookings;
    return [];
  })();
  const jobs = allBookings.filter((b: any) => b && b.customerId === user.id);

  return (
    <div className="fixed inset-0 z-[1000] flex justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" {...dismiss(onClose)} />
      <DialogPanel onClose={onClose} label={`Client details: ${user.name ?? ""}`} className="relative h-full w-full max-w-4xl overflow-y-auto border-l border-white/10 bg-ink shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-white/10 bg-ink/95 px-5 py-4 backdrop-blur">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-brand/15 text-base font-extrabold text-cyan-glow">
            {user.name?.[0]?.toUpperCase() ?? "U"}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold text-white">{user.name}</h2>
            <p className="flex items-center gap-3 text-xs text-slate-400">
              {user.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {user.email}</span>}
              {user.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {user.phone}</span>}
            </p>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex gap-1 border-b border-white/10 px-5 pt-3">
          {(["profile", "jobs", "files"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded-t-lg px-3 py-2 text-sm font-semibold capitalize transition ${tab === t ? "border-b-2 border-brand text-white" : "text-slate-400 hover:text-white"}`}>
              {t === "jobs" ? "Job history" : t}
            </button>
          ))}
        </div>

        <div className="space-y-5 p-5">
          {tab === "profile" && !full && (
            <p className="py-8 text-center text-sm text-slate-500">{record.isError ? "Couldn't load this record. Please try again." : "Loading…"}</p>
          )}
          {tab === "profile" && full && (
            <>
              {saveErr && (
                <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{saveErr}</p>
              )}
              {/* --- Contact --- */}
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Contact</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="First name">
                    <input aria-label="First name" className={inputCls} value={form.firstName}
                      onChange={(e) => setForm({ ...form, firstName: e.target.value })} placeholder="Jane" />
                  </Field>
                  <Field label="Last name">
                    <input aria-label="Last name" className={inputCls} value={form.lastName}
                      onChange={(e) => setForm({ ...form, lastName: e.target.value })} placeholder="Doe" />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Company">
                    <input aria-label="Acme Inc." className={inputCls} value={form.company}
                      onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Acme Inc." />
                  </Field>
                  <Field label="Company website">
                    <input aria-label="Company website" className={inputCls} value={form.website}
                      onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="acme.com" />
                  </Field>
                </div>
                {isClient && (
                  <Field label="Account type">
                    <select aria-label="Account type" className={inputCls} value={form.customerType}
                      onChange={(e) => setForm({ ...form, customerType: e.target.value })}>
                      <option value="one_time">One-time client</option>
                      <option value="repeat">Repeat customer</option>
                    </select>
                  </Field>
                )}
                <Field label="Email">
                  <input aria-label="jane@email.com" className={inputCls} type="email" value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jane@email.com" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Primary phone">
                    <input aria-label="+1 416 555 9999" className={inputCls} value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 416 555 9999" />
                  </Field>
                  <Field label="Secondary phone">
                    <input aria-label="+1 416 555 0000" className={inputCls} value={form.altPhone}
                      onChange={(e) => setForm({ ...form, altPhone: e.target.value })} placeholder="+1 416 555 0000" />
                  </Field>
                </div>
              </div>

              {/* --- Property: where they live, and who manages it --- */}
              {isClient && (
                <div className="space-y-3 border-t border-white/10 pt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Property</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <Field label="Property">
                        <select
                          aria-label="Property"
                          className={inputCls}
                          value={placement.propertyId}
                          onChange={(e) => setPlacement({ ...placement, propertyId: e.target.value })}
                        >
                          <option value="">No property</option>
                          {properties.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <Field label="Unit">
                      <input
                        aria-label="Unit"
                        className={inputCls}
                        value={placement.unit}
                        maxLength={40}
                        disabled={!placement.propertyId}
                        onChange={(e) => setPlacement({ ...placement, unit: e.target.value })}
                        placeholder="4B"
                      />
                    </Field>
                  </div>
                  <p className="text-xs text-slate-500">
                    {placedAt
                      ? placedAt.managerName
                        ? `Manager: ${placedAt.managerName}${placedAt.address ? ` · ${placedAt.address}` : ""}`
                        : `No manager yet${placedAt.address ? ` · ${placedAt.address}` : ""}. Pick one on the Properties tab.`
                      : properties.length
                        ? "Not at a property yet."
                        : "No properties yet. Add them on the Properties tab."}
                  </p>
                </div>
              )}

              {/* --- Primary address --- */}
              <div className="space-y-3 border-t border-white/10 pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Primary address</p>
                <Field label="Street address">
                  <AddressAutocomplete
                    value={form.address}
                    placeholder="123 Main St, Unit 4"
                    onResolve={({ address }) =>
                      setForm((f: any) => ({ ...f, ...applyAddressParts(f, address) }))
                    }
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="City">
                    <input aria-label="Toronto" className={inputCls} value={form.city}
                      onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Toronto" />
                  </Field>
                  <Field label="Province / State">
                    <input aria-label="ON" className={inputCls} value={form.region}
                      onChange={(e) => setForm({ ...form, region: e.target.value })} placeholder="ON" />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Postal / ZIP">
                    <input aria-label="M5V 2T6" className={inputCls} value={form.postalCode}
                      onChange={(e) => setForm({ ...form, postalCode: e.target.value })} placeholder="M5V 2T6" />
                  </Field>
                  <Field label="Country">
                    <input aria-label="Canada" className={inputCls} value={form.country}
                      onChange={(e) => setForm({ ...form, country: e.target.value })} placeholder="Canada" />
                  </Field>
                </div>
              </div>

              {/* --- Additional addresses --- */}
              <div className="space-y-3 border-t border-white/10 pt-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Additional sites / addresses</p>
                  <button
                    onClick={() => setForm({ ...form, addresses: [...form.addresses, { label: "", line: "", city: "", region: "", postalCode: "", notes: "" }] })}
                    className="flex items-center gap-1 rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:border-brand/50 hover:text-white"
                  >
                    <Plus className="h-3 w-3" /> Add address
                  </button>
                </div>
                {form.addresses.length === 0 && (
                  <p className="text-xs text-slate-600">No additional addresses. Use this for multiple job sites or billing locations.</p>
                )}
                {form.addresses.map((a: any, i: number) => (
                  <div key={i} className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
                    <div className="flex items-center gap-2">
                      <input aria-label="Label (e.g. Warehouse, Billing)" className={`${inputCls} flex-1`} value={a.label}
                        onChange={(e) => updateArr(form, setForm, "addresses", i, { label: e.target.value })}
                        placeholder="Label (e.g. Warehouse, Billing)" />
                      <button onClick={() => setForm({ ...form, addresses: form.addresses.filter((_: any, j: number) => j !== i) })}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-red-500/10 hover:text-red-400">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <AddressAutocomplete
                      value={a.line}
                      placeholder="Street address"
                      onResolve={({ address }) =>
                        updateArr(form, setForm, "addresses", i, parseAddressFields(address))
                      }
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <input aria-label="City" className={inputCls} value={a.city}
                        onChange={(e) => updateArr(form, setForm, "addresses", i, { city: e.target.value })} placeholder="City" />
                      <input aria-label="Prov." className={inputCls} value={a.region}
                        onChange={(e) => updateArr(form, setForm, "addresses", i, { region: e.target.value })} placeholder="Prov." />
                      <input aria-label="Postal" className={inputCls} value={a.postalCode}
                        onChange={(e) => updateArr(form, setForm, "addresses", i, { postalCode: e.target.value })} placeholder="Postal" />
                    </div>
                  </div>
                ))}
              </div>

              {/* --- Additional contacts --- */}
              <div className="space-y-3 border-t border-white/10 pt-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Additional contacts</p>
                  <button
                    onClick={() => setForm({ ...form, contacts: [...form.contacts, { name: "", role: "", phone: "", email: "" }] })}
                    className="flex items-center gap-1 rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:border-brand/50 hover:text-white"
                  >
                    <Plus className="h-3 w-3" /> Add contact
                  </button>
                </div>
                {form.contacts.length === 0 && (
                  <p className="text-xs text-slate-600">No extra contacts. Add property managers, tenants, or billing contacts.</p>
                )}
                {form.contacts.map((ct: any, i: number) => (
                  <div key={i} className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
                    <div className="flex items-center gap-2">
                      <input aria-label="Contact name" className={`${inputCls} flex-1`} value={ct.name}
                        onChange={(e) => updateArr(form, setForm, "contacts", i, { name: e.target.value })} placeholder="Contact name" />
                      <input aria-label="Role" className={`${inputCls} flex-1`} value={ct.role}
                        onChange={(e) => updateArr(form, setForm, "contacts", i, { role: e.target.value })} placeholder="Role" />
                      <button onClick={() => setForm({ ...form, contacts: form.contacts.filter((_: any, j: number) => j !== i) })}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-red-500/10 hover:text-red-400">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input aria-label="Phone" className={inputCls} value={ct.phone}
                        onChange={(e) => updateArr(form, setForm, "contacts", i, { phone: e.target.value })} placeholder="Phone" />
                      <input aria-label="Email" className={inputCls} value={ct.email}
                        onChange={(e) => updateArr(form, setForm, "contacts", i, { email: e.target.value })} placeholder="Email" />
                    </div>
                  </div>
                ))}
              </div>

              {/* --- Notes --- */}
              <div className="space-y-2 border-t border-white/10 pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</p>
                <textarea aria-label="Account notes, gate codes, preferences, history…" className={inputCls} rows={4} value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Account notes, gate codes, preferences, history…" />
              </div>

              <div className="sticky bottom-0 -mx-5 flex justify-end border-t border-white/10 bg-ink/95 px-5 py-3 backdrop-blur">
                <BtnPrimary onClick={() => save.mutate()} disabled={save.isPending}>
                  {save.isPending ? "Saving…" : "Save client record"}
                </BtnPrimary>
              </div>

              <div className="border-t border-white/10 pt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Custom fields</p>
                <CustomFieldsForm entity="client" entityType="client" entityId={user.id} />
              </div>
              {isClient && (
                <div className="border-t border-white/10 pt-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Tags</p>
                  <TagPicker scope="client" entityType="client" entityId={user.id} />
                </div>
              )}
            </>
          )}

          {tab === "jobs" && (
            bookings.isLoading ? (
              <p className="py-8 text-center text-sm text-slate-500">Loading job history…</p>
            ) : bookings.isError ? (
              <p className="py-8 text-center text-sm text-slate-500">Couldn't load job history. Please try again.</p>
            ) : jobs.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">No bookings for this client yet.</p>
            ) : (
              <div className="space-y-2">
                {jobs.map((b: any, idx: number) => {
                  const liCount = (() => {
                    try {
                      const a = typeof b?.lineItems === "string" ? JSON.parse(b.lineItems || "[]") : b?.lineItems;
                      return Array.isArray(a) ? a.length : 0;
                    } catch { return 0; }
                  })();
                  const dateLabel = (() => {
                    if (!b?.createdAt) return "—";
                    const d = new Date(b.createdAt);
                    return isNaN(d.getTime()) ? "—" : fmtDateShort(b.createdAt);
                  })();
                  const totalNum = Number(b?.total);
                  return (
                  <div
                    key={b?.id ?? idx}
                    {...activate(() => openJob(b))}
                    aria-label={`View ${b?.title || b?.service?.name || b?.serviceName || "job"} from ${dateLabel}`}
                    className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5 transition hover:border-brand/30 hover:bg-white/[0.05]"
                  >
                    <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand/15 text-cyan-glow"><ClipboardList className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">{b?.title || b?.service?.name || b?.serviceName || "Service"}</p>
                      <p className="text-[11px] text-slate-500">
                        {dateLabel} · {b?.status ?? "—"}
                        {liCount > 0 && <span className="ml-1 text-cyan-glow">· {liCount} line item{liCount > 1 ? "s" : ""}</span>}
                      </p>
                    </div>
                    {Number.isFinite(totalNum) && <span className="text-sm font-bold text-emerald-live">{money(totalNum)}</span>}
                  </div>
                  );
                })}
              </div>
            )
          )}

          {tab === "files" && <AttachmentManager entityType="client" entityId={user.id} />}
        </div>
      </DialogPanel>

      <WorkOrderModal
        open={viewJob !== null}
        editBooking={viewJob ?? undefined}
        onClose={() => setViewJob(null)}
      />
    </div>
  );
}
