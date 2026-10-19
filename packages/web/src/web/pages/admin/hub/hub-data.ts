/**
 * Control Hub data: the shapes /api/hub returns and one fetch helper. Kept in
 * one file so every hub screen agrees on them.
 */
import { apiFetch, apiHeaders } from "../../../lib/api";

export type PlatformRole = "owner" | "staff" | "sales";
export type TenantKind = "customer" | "demo" | "test" | "internal";

export interface HubMe {
  role: PlatformRole;
  can: { switchAnyTenant: boolean; actAs: boolean; editPlans: boolean; editKinds: boolean; manageTeam: boolean; deleteTenants: boolean; seeAudit: boolean };
}

export interface HubTenant {
  id: string;
  name: string;
  kind: TenantKind;
  plan: string;
  status: string;
  industry: string;
  industryLabel: string;
  billingStatus: string;
  trialEndsAt: string | null;
  demoExpiresAt: string | null;
  createdAt: string | null;
  health: string;
  team: number;
  techs: number;
  customers: number;
  jobs30: number;
  lastActive: string | null;
  mrr: number;
  overrides: number;
  city: string;
}

export interface AttentionItem {
  id: string;
  severity: "high" | "medium" | "low";
  kind: string;
  title: string;
  detail: string;
  companyId?: string;
  action: { label: string; href: string };
}

export interface AuditEntry {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  companyId: string;
  entityType: string;
  entityId: string;
  summary: string;
  createdAt: string;
}

export interface Overview {
  kpis: {
    mrr: number;
    activeTenants: number;
    customers: number;
    paying: number;
    trialing: number;
    trialsEndingSoon: number;
    signupsToday: number;
    openLeads: number;
    demos: number;
    jobsCompleted30: number;
    customerUpdates30: number;
  };
  attention: AttentionItem[];
  activity: AuditEntry[];
  generatedAt: string;
}

export interface FeatureRow {
  key: string;
  label: string;
  description: string;
  kind: "entitlement" | "rollout" | "ops";
  group: string;
  on: boolean;
  source: "default" | "kind" | "plan" | "override";
  inherited: boolean;
  override?: { enabled: boolean; reason?: string; expiresAt?: string | null; setByName?: string; setAt?: string | null };
}

export interface Person {
  userId: string;
  name: string;
  email: string;
  role: string;
  status: string;
  sample: boolean;
}

export interface Session {
  id: string;
  actorName: string;
  targetName: string;
  reason: string;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  endedReason: string;
  companyId: string;
}

export interface TenantDetail {
  company: {
    id: string;
    name: string;
    kind: TenantKind;
    plan: string;
    status: string;
    industry: string;
    contactEmail: string;
    phone: string;
    officeAddress: string;
    createdAt: string | null;
    onboardingCompletedAt: string | null;
    demoExpiresAt: string | null;
    billing: { status: string; seats: number; trialEndsAt: string | null; customerId: string | null };
    stripe: { connected: boolean; chargesEnabled: boolean; payoutsEnabled: boolean; usePlatform: boolean };
    hubspot: { companyId: string | null; dealId: string | null; syncedAt: string | null };
    allowSupportAccess: boolean;
  };
  summary: HubTenant | null;
  settings: Record<string, unknown>;
  features: FeatureRow[];
  people: Person[];
  integrations: { provider: string; status: string; accountLabel: string; lastSyncAt: string | null }[];
  tenantAudit: { id: string; actorName: string; action: string; entityType: string; summary: string; createdAt: string; supportActorName?: string }[];
  hubAudit: AuditEntry[];
  sessions: Session[];
  plans: { id: string; label: string }[];
  readOnly: boolean;
}

export interface FeatureSummary {
  key: string;
  label: string;
  description: string;
  kind: "entitlement" | "rollout" | "ops";
  group: string;
  removeBy: string | null;
  kindDefaults: Partial<Record<TenantKind, boolean>> | null;
  onCount: number;
  total: number;
  overrides: { companyId: string; companyName: string; enabled: boolean; reason: string; expiresAt: string | null; setByName: string; setAt: string | null }[];
}

export interface StaffMember {
  userId: string;
  name: string;
  email: string;
  role: PlatformRole;
  addedBy: string;
  createdAt: string | null;
}

export interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  source: string;
  status: string;
  createdAt: string;
}

/** GET/POST/PUT/PATCH/DELETE against /api/hub (or any /api path), throwing a readable error. */
export async function hub<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const url = path.startsWith("/api/") ? path : `/api/hub${path}`;
  const res = await apiFetch(url, {
    method: init.method ?? "GET",
    credentials: "include",
    headers: { ...apiHeaders(), ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  return (await res.json()) as T;
}

export const KIND_LABEL: Record<TenantKind, string> = { customer: "Customer", demo: "Demo", test: "Test", internal: "ArrivePing" };

export const ROLE_LABEL: Record<PlatformRole, string> = { owner: "Owner", staff: "Staff", sales: "Sales" };

export const PLAN_LABEL: Record<string, string> = { starter: "Starter", pro: "Pro", enterprise: "Enterprise" };

export const OFFICE_ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  manager: "Manager",
  dispatcher: "Dispatcher",
  project_manager: "Project manager",
  rider: "Field staff",
  customer: "Client",
};
