// Elevate an existing user to the `superadmin` role.
//
// Superadmin is cross-tenant, so — mirroring canBeSuperadmin() in
// packages/web/src/api/lib/permissions.ts — the email must be on an operator
// domain (SUPERADMIN_EMAIL_DOMAINS, comma-separated; default nvc360.com).
// The user must already exist (sign up first); this only flips `role`.
//
// Connects as the system role (DATABASE_SYSTEM_URL, falling back to
// DATABASE_URL) because `user` lookups here happen outside any tenant context.
//
// Usage:
//   bun run make-superadmin someone@nvc360.com
//   bun run make-superadmin someone@nvc360.com --demote admin   # revert to a role
//
// Existing sessions keep the old role until the user signs out and back in.

import postgres from "postgres";

const args = process.argv.slice(2);
const demoteIdx = args.indexOf("--demote");
const demoteTo = demoteIdx >= 0 ? args[demoteIdx + 1] : undefined;
const email = args.find((a, i) => !a.startsWith("--") && (demoteIdx < 0 || i !== demoteIdx + 1))?.trim().toLowerCase();

if (!email || (demoteIdx >= 0 && !demoteTo)) {
  console.error("Usage: bun run make-superadmin <email> [--demote <role>]");
  process.exit(1);
}

const url = process.env.DATABASE_SYSTEM_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL (or DATABASE_SYSTEM_URL) is not set. Run via `bun run make-superadmin`, which loads .env.");
  process.exit(1);
}

const newRole = demoteTo ?? "superadmin";

if (newRole === "superadmin") {
  const allowed = (process.env.SUPERADMIN_EMAIL_DOMAINS ?? "nvc360.com")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  const domain = email.split("@")[1];
  if (!domain || !allowed.includes(domain)) {
    console.error(`Refusing: ${email} is not on an allowed superadmin domain (${allowed.join(", ")}).`);
    process.exit(1);
  }
}

const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const sql = postgres(url, { ssl: isLocal ? false : "require", max: 1, connect_timeout: 10 });

try {
  const [existing] = await sql<{ id: string; role: string | null; company_id: string }[]>`
    select id, role, company_id from "user" where lower(email) = ${email}
  `;
  if (!existing) {
    console.error(`No user found with email ${email}. They must sign up first.`);
    process.exit(1);
  }
  if (existing.role === newRole) {
    console.log(`${email} is already ${newRole}. Nothing to do.`);
  } else {
    await sql`update "user" set role = ${newRole}, updated_at = now() where id = ${existing.id}`;
    console.log(`${email}: ${existing.role ?? "(none)"} -> ${newRole}. They must sign out and back in.`);
  }
} finally {
  await sql.end();
}
