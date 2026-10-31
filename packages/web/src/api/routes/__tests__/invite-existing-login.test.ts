/**
 * Inviting a technician whose email already has an ArrivePing login (they
 * work for another company): they're invited with that login, and get a
 * technician profile here, as Add technician does, so they show on the
 * Technicians page as "Invite pending". Ids prefixed "iel-".
 */
import { beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { PgTable } from "drizzle-orm/pg-core";
import { and, eq } from "drizzle-orm";
import type { AppEnv } from "../../env";

process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";

const { sdb } = await import("../../database/index");
const schema = await import("../../database/schema");
const { ensureTables } = await import("../../../test-support/tables");
const { invitesRoutes } = await import("../invites");

const CO = "iel-co";
const app = new Hono<AppEnv>()
  .use("*", async (c, next) => {
    c.set("companyId", CO);
    c.set("user", { id: "iel-admin", role: "admin", email: "a@iel.test", name: "Admin", companyId: CO } as never);
    return next();
  })
  .route("/invites", invitesRoutes);

beforeAll(async () => {
  await ensureTables(...(Object.values(schema).filter((v) => v instanceof PgTable) as PgTable[]));
  await sdb.insert(schema.user).values([
    { id: "iel-admin", name: "Admin", email: "a@iel.test", role: "admin", companyId: CO },
    { id: "iel-tech", name: "Contract Tech", email: "tech@other.test", role: "rider", companyId: "iel-other", phone: "+12045550100" },
  ] as never);
  await sdb.insert(schema.memberships).values([
    { id: "iel-m-admin", userId: "iel-admin", companyId: CO, role: "admin", status: "active" },
    { id: "iel-m-other", userId: "iel-tech", companyId: "iel-other", role: "rider", status: "active" },
  ] as never);
});

const invite = (body: unknown) => app.request("/invites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("POST /invites with an email that already has a login", () => {
  it("invites them and gives them a technician profile here, once", async () => {
    const res = await invite({ email: "tech@other.test", skillClass: "Carpet installation" });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ existingAccount: true, status: "invited" });
    const [m] = await sdb.select().from(schema.memberships).where(and(eq(schema.memberships.userId, "iel-tech"), eq(schema.memberships.companyId, CO)));
    expect(m?.status).toBe("invited");
    const riders = await sdb.select().from(schema.riders).where(and(eq(schema.riders.userId, "iel-tech"), eq(schema.riders.companyId, CO)));
    expect(riders.length).toBe(1);
    expect(riders[0]!.skillClass).toBe("Carpet installation");
    // Inviting again (they haven't accepted) re-sends the invitation, without a second profile.
    expect((await invite({ email: "tech@other.test" })).status).toBe(201);
    expect((await sdb.select().from(schema.riders).where(eq(schema.riders.userId, "iel-tech"))).length).toBe(1);
  });
});
