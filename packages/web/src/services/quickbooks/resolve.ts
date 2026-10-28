/**
 * Which QuickBooks record stands for one of ours.
 *
 *   technician (riders.id)  → Vendor     saved link → exact DisplayName → create
 *   job's customer          → Customer   saved link → exact DisplayName → create
 *                                        (under the tenant's parent customer if set)
 *   job template            → Item       saved link → tenant default item
 *
 * Nothing is guessed: two records with the same name become an issue for a
 * person. Links are kept in qbo_links so each lookup costs one API call once.
 */
import { and, eq } from "drizzle-orm";
import { sdb } from "../../api/database";
import * as schema from "../../api/database/schema";
import { q, qboFetch, qboQuery } from "./client";
import type { Customer, Vendor } from "./entities";

export type BillMode = "arriveping" | "subtrade";

export interface QboSettings {
  /** Who creates the subtrade's Bill: us on completion, or the subtrade invoices and the bookkeeper enters it. */
  billMode: BillMode;
  /** Purchase tax code applied to every PO/Bill line (BMD: GST only). */
  taxCodeId: string;
  /** Item used for templates with no mapping. */
  defaultItemId: string;
  /** Customers we create go under this parent (empty: top level). */
  parentCustomerId: string;
  /** Log what would be sent instead of writing to QuickBooks. */
  shadow: boolean;
}

export const DEFAULT_SETTINGS: QboSettings = { billMode: "arriveping", taxCodeId: "", defaultItemId: "", parentCustomerId: "", shadow: true };

export function parseSettings(config: string | null | undefined): QboSettings {
  let raw: Partial<Record<keyof QboSettings, unknown>> = {};
  try {
    raw = config ? JSON.parse(config) : {};
  } catch {
    raw = {};
  }
  return {
    billMode: raw.billMode === "subtrade" ? "subtrade" : "arriveping",
    taxCodeId: typeof raw.taxCodeId === "string" ? raw.taxCodeId : "",
    defaultItemId: typeof raw.defaultItemId === "string" ? raw.defaultItemId : "",
    parentCustomerId: typeof raw.parentCustomerId === "string" ? raw.parentCustomerId : "",
    shadow: typeof raw.shadow === "boolean" ? raw.shadow : true,
  };
}

export async function settings(companyId: string): Promise<QboSettings> {
  const [row] = await sdb
    .select({ config: schema.integrations.config })
    .from(schema.integrations)
    .where(and(eq(schema.integrations.companyId, companyId), eq(schema.integrations.provider, "quickbooks")));
  return parseSettings(row?.config);
}

export type LinkKind = "vendor" | "customer" | "item" | "taxcode" | "purchase_order" | "bill";

export async function getLink(companyId: string, kind: LinkKind, localId: string) {
  const [row] = await sdb
    .select()
    .from(schema.qboLinks)
    .where(and(eq(schema.qboLinks.companyId, companyId), eq(schema.qboLinks.kind, kind), eq(schema.qboLinks.localId, localId)));
  return row ?? null;
}

export async function findByQboId(companyId: string, kind: LinkKind, qboId: string) {
  const [row] = await sdb
    .select()
    .from(schema.qboLinks)
    .where(and(eq(schema.qboLinks.companyId, companyId), eq(schema.qboLinks.kind, kind), eq(schema.qboLinks.qboId, qboId)));
  return row ?? null;
}

/** Save (or replace) the link for a local record. */
export async function setMapping(companyId: string, kind: LinkKind, localId: string, qboId: string, extra: { syncToken?: string; fingerprint?: string } = {}): Promise<void> {
  const existing = await getLink(companyId, kind, localId);
  const values = { qboId, syncToken: extra.syncToken ?? "", fingerprint: extra.fingerprint ?? "", lastSyncedAt: new Date() };
  if (existing) {
    await sdb.update(schema.qboLinks).set(values).where(eq(schema.qboLinks.id, existing.id));
  } else {
    await sdb.insert(schema.qboLinks).values({ companyId, kind, localId, ...values });
  }
}

export async function raiseIssue(companyId: string, kind: string, message: string, opts: { bookingId?: string | null; detail?: unknown; resolved?: boolean } = {}): Promise<string> {
  const [row] = await sdb
    .insert(schema.qboIssues)
    .values({
      companyId,
      bookingId: opts.bookingId ?? null,
      kind,
      message,
      detail: JSON.stringify(opts.detail ?? {}),
      status: opts.resolved ? "resolved" : "open",
      resolvedAt: opts.resolved ? new Date() : null,
    })
    .returning({ id: schema.qboIssues.id });
  return row!.id;
}

type Resolved = { qboId: string } | { issue: string };

export async function resolveVendor(companyId: string, rider: { id: string; userId: string; name: string; email: string }): Promise<Resolved> {
  const linked = await getLink(companyId, "vendor", rider.id);
  if (linked) return { qboId: linked.qboId };
  const name = rider.name.trim();
  if (!name) return { issue: "vendor_unnamed" };
  const hits = await qboQuery<Vendor>(companyId, `SELECT * FROM Vendor WHERE DisplayName = ${q(name)}`);
  if (hits.length > 1) {
    await raiseIssue(companyId, "vendor_ambiguous", `More than one QuickBooks vendor is called "${name}". Pick one on the Integrations page.`, {
      detail: { riderId: rider.id, candidates: hits.map((h) => ({ id: h.Id, name: h.DisplayName })) },
    });
    return { issue: "vendor_ambiguous" };
  }
  let vendor = hits[0];
  if (!vendor) {
    const created = await qboFetch<{ Vendor: Vendor }>(companyId, "/vendor", {
      method: "POST",
      body: { DisplayName: name, ...(rider.email ? { PrimaryEmailAddr: { Address: rider.email } } : {}) },
    });
    vendor = created.Vendor;
  }
  await setMapping(companyId, "vendor", rider.id, vendor.Id, { syncToken: vendor.SyncToken });
  return { qboId: vendor.Id };
}

export async function resolveCustomer(companyId: string, job: { customerId: string; customerName: string; address: string }): Promise<Resolved> {
  const linked = await getLink(companyId, "customer", job.customerId);
  if (linked) return { qboId: linked.qboId };
  const name = job.customerName.trim();
  if (!name) return { issue: "customer_unnamed" };
  const hits = await qboQuery<Customer>(companyId, `SELECT * FROM Customer WHERE DisplayName = ${q(name)}`);
  if (hits.length > 1) {
    await raiseIssue(companyId, "customer_ambiguous", `More than one QuickBooks customer is called "${name}". Pick one on the Integrations page.`, {
      detail: { customerId: job.customerId, candidates: hits.map((h) => ({ id: h.Id, name: h.DisplayName })) },
    });
    return { issue: "customer_ambiguous" };
  }
  let customer = hits[0];
  if (!customer) {
    const cfg = await settings(companyId);
    const displayName = [name, job.address.trim()].filter(Boolean).join(" - ").slice(0, 100);
    const body: Record<string, unknown> = { DisplayName: displayName };
    if (cfg.parentCustomerId) {
      body.ParentRef = { value: cfg.parentCustomerId };
      body.Job = true;
    }
    const created = await qboFetch<{ Customer: Customer }>(companyId, "/customer", { method: "POST", body });
    customer = created.Customer;
    await raiseIssue(companyId, "customer_created", `Created QuickBooks customer "${displayName}".`, {
      detail: { customerId: job.customerId, qboId: customer.Id },
      resolved: true,
    });
  }
  await setMapping(companyId, "customer", job.customerId, customer.Id, { syncToken: customer.SyncToken });
  return { qboId: customer.Id };
}

export async function resolveItem(companyId: string, templateId: string | null): Promise<Resolved> {
  if (templateId) {
    const linked = await getLink(companyId, "item", templateId);
    if (linked) return { qboId: linked.qboId };
  }
  const cfg = await settings(companyId);
  if (cfg.defaultItemId) return { qboId: cfg.defaultItemId };
  await raiseIssue(companyId, "item_unmapped", "No QuickBooks item is mapped for this job's template and no default item is set.", {
    detail: { templateId },
  });
  return { issue: "item_unmapped" };
}
