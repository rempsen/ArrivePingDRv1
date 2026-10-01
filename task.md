# Main-chat migration — 2026-09-30

Goal: make THIS chat the home for ArrivePing / NVC360 (web + iOS + working files),
replacing the "NVCV4 August 2026" chat (shared: runable.com/shared/c416dd9b-...).

## Done
- Cloned github.com/rempsen/ArrivePingDRv1 → /home/user/nvc360-v4 @ b8c584c (same HEAD the old chat had). bun install OK.
- Recovered from old chat (text previews on the shared page): nvc360-sandbox-env-FULL.env (Aug 24 snapshot),
  nvc360-local-dev-SCOPED.env, remediation-plan.md, 11× content.md reports → committed to docs/chat-archive/ (8bce423).
  NOT recoverable via public share (binary, login-gated download): NVC360-Technical-Architecture-Specification.docx,
  punchlist-edge-functions.zip, job-report-*.pdf, dl3.pdf, screenshots. Ask Dan to drop them in Attachments if needed.
- .env written (root): all live third-party creds from the recovered file; DB vars point at LOCAL Postgres 17 stand-in.
- Local Postgres 17: db `nvc`, migrations 0000–0003 applied (58 tables), roles app_runtime/app_system passworded.
  Login: dan@nvc360.com / phu9Yae423! (superadmin, created via sign-up + role update). /api/seed fails under RLS — expected.
- Web: vite build done, server in tmux `web` on :4200. Redis Cloud connected (cred still live).
- Mobile: packages/mobile/.env (EXPO_PUBLIC_SENTRY_DSN), Metro in tmux `metro` on :4300.
- Skill recreated: ~/.skills/arriveping-git-push (SKILL.md + scripts/ensure-remote.sh).
- SSH key generated: ~/.ssh/id_ed25519 — NOT yet authorized on GitHub.

## Done 2026-09-30 (evening)
- Deploy key authorized; 8bce423 pushed. `git push origin main` works.
- Supabase wired: project ujrzjdzcqrvquwasneaq, session pooler aws-0-ca-central-1. `web` on :4200 now runs
  against the REAL DB (5 companies / 150 users); dan@nvc360.com superadmin login verified.
  app_runtime / app_system passwords were ROTATED (old ones unrecoverable) → arriveping.com /api/ready
  reported database:down until its Runable env is updated with the new DATABASE_URL / DATABASE_SYSTEM_URL.
  Local-Postgres .env kept as .env.local-postgres.bak.
- packages/mobile/keys/AuthKey.p8 restored (validated EC P-256). eas-cli installed globally; `eas whoami` = nvc360.
  EXPO_TOKEN lives in packages/mobile/.env (gitignored).

## Still open
5. Google Drive zip (1H8LLu5zx3LliRInVan9J1V2n259kwRCT) is not public — share as "anyone with link" or drop in Attachments.
6. Confirm whether this chat has a Publish button (Runable project). If it's "Unmanaged", publishing still goes through the old chat.

## 2026-10-01 — arriveping.com DB outage resolved
- Cause: app_runtime/app_system passwords rotated (2026-09-30) while the deployed container and
  the old chat's sandbox server still used the old ones → Supavisor circuit breaker + stale deploy.
- Fix: new URLs added to home chat Dashboard → Secrets, old sandbox .env updated + server restarted,
  Publish of 4b8bf98. /api/ready = ok, live sign-in = 200.
- /api/ready now reports database_error + database_target on failure (a97cb02, 4b8bf98).
