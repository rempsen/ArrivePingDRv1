# task.md — ArrivePing main chat

## 2026-10-01 Agentic onboarding remediation (approved by Dan)
Source docs: docs/chat-archive/agentic-onboarding-gap-analysis-2026-09-30.md, -remediation-plan-.md
Approved: 1, 2, 3, 4, 6a, 7. Skipped: 5 (regex→role tag). Test: throwaway tenant on live, screenshots, delete.
Order: 7 → 4 → 2 → 6a → 1 → 3

- [ ] 7 toolLabel pills (onboarding-chat.tsx)
- [ ] 4 option-catalog presets for property-management-maintenance, equipment-rental, sports-organization
- [ ] 2 fitScore/tier/outlier note into onboarding chat system prompt
- [ ] 6a wire technicianCount/vehicleCount/jobsPerDay → capacity defaults
- [ ] 1 icpAnswers[] → provisioning actions at finish_onboarding (AI translation pass, idempotent)
- [ ] 3 brand-scout: bounded crawl (services/about) + JSON-LD parse
- [ ] vite build, boot server, throwaway tenant E2E on live, screenshots, delete tenant
- [ ] commit + push each step

## Stripe (parked by Dan until later today/tomorrow)
- Connect works E2E (12ec366). Needs NVCV4 pull+Publish. $1 ArrivePing-tenant test unpaid. Orphan acct_1ULmueC8cpzmChbM to remove in dashboard. Test tenant test-sunny-sitters + acct_1ULmvQCA4pHmrpfB to delete when done.
