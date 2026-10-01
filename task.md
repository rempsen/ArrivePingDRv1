# task.md — ArrivePing main chat

## 2026-10-01 Agentic onboarding remediation (approved by Dan)
Source docs: docs/chat-archive/agentic-onboarding-gap-analysis-2026-09-30.md, -remediation-plan-.md
Approved: 1, 2, 3, 4, 6a, 7. Skipped: 5 (regex→role tag). Test: throwaway tenant on live, screenshots, delete.
Order: 7 → 4 → 2 → 6a → 1 → 3

- [x] 7 toolLabel pills (onboarding-chat.tsx) — c0833e0
- [x] 4 option-catalog presets for property-management-maintenance, equipment-rental, sports-organization — bc6a3e0
- [x] 2 fitNote (tenant-safe) per outlier ICP + product-fit block in concierge prompt — aa11660
- [x] 6a technicianCount/jobsPerDay → service/template duration density; vehicles/team → AI dispatch context — 28a6a68
- [x] 1 icpAnswers[] → provisioning actions at finish_onboarding (services/icp-answer-tuning.ts, once per tenant) — 76d7aa5; verified live on test-sunny-sitters (6 actions, all grounded)
- [x] 3 brand-scout: ≤3 sub-pages (services/coverage/about) + JSON-LD parse + deterministic fallback — e28a6ed; verified on mrrooter.ca/winnipeg (Plumber JSON-LD, service area from /locations/)
- [x] vite build + local server boot on new code (/api/ready database ok); public /scout endpoint smoke OK
- [ ] Dan: NVCV4 `git pull origin main` → Publish → check https://arriveping.com/api/ready
- [ ] After publish: throwaway tenant E2E on live via public signup → onboarding chat → screenshots → delete tenant
- [x] commit + push each step

## Stripe (parked by Dan until later today/tomorrow)
- Connect works E2E (12ec366). Needs NVCV4 pull+Publish. $1 ArrivePing-tenant test unpaid. Orphan acct_1ULmueC8cpzmChbM to remove in dashboard. Test tenant test-sunny-sitters + acct_1ULmvQCA4pHmrpfB to delete when done.
