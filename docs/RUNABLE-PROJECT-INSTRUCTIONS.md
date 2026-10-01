# ArrivePing APP — project instructions (paste into Runable → ArrivePing APP → Instructions)

You are working on ArrivePing by NVC360 (field-service scheduling/tracking SaaS). Dan is non-technical: plain English, step-by-step, screenshots before edits.

## Source of truth
- Code: github.com/rempsen/ArrivePingDRv1, branch `main` (SSH: git@github.com:rempsen/ArrivePingDRv1.git). Clone to `/home/user/nvc360-v4`.
- Every round of changes is committed AND pushed to that repo without being asked. Never push anywhere else. Never commit `.env`, `*.p8`, or credentials.
- Live site: https://arriveping.com (uberize.ai is legacy). Deploys are published ONLY from the "NVCV4 August 2026" chat: tell it `git pull origin main`, then Publish. Verify with https://arriveping.com/api/ready → `"database":"ok"`.
- Database is Supabase Postgres (project ujrzjdzcqrvquwasneaq). Never describe it as Turso.

## First thing in any new chat
1. Load the skill `arriveping-git-push` and run `bash /home/user/.skills/arriveping-git-push/scripts/ensure-remote.sh`.
2. If push access fails: generate an SSH key, show Dan the public key, ask him to add it as a write-enabled Deploy key on the repo (Settings → Deploy keys). Do not ask for a personal access token.
3. Ask Dan for secrets through the secure secrets form (never in chat): `DATABASE_URL`, `DATABASE_SYSTEM_URL`, `SUPABASE_MIGRATION_URL`, plus the rest of `.env.example` as needed. For iOS work also `EXPO_TOKEN` and the ASC key (`AuthKey.p8`, key Y95T77F934).
4. Boot the real server (`packages/web`, tmux `web`, port 4200) and confirm `/api/ready` is ok before claiming anything works. `tsc --noEmit` is NOT a valid check in this repo.

## Hard rules
- Never rotate a database password while any instance is running (Supavisor circuit breaker took the site down 2026-09-30). Stop everything → update Secrets in NVCV4 chat → rotate → Publish.
- Frontend changes need `bun x vite build` before they show locally; production rebuilds automatically.
- iOS TestFlight: manual EAS CLI flow from `packages/mobile` (`eas build --platform ios --profile production`, then `eas submit`), bundle `com.nvc360.uberize`, Apple ID 6776464675. Never use Runable's one-click iOS publish.
- Brand: dark theme, cyan #0ea5e9, ink #070b12. Product name "ArrivePing by NVC360"; NVC360 stays in footers.
