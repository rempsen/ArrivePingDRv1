# Onboarding UX overhaul (Gregor/Joel meeting asks, 2026-10-01)

Confirmed with Dan:
1. Provisioning pop-up — CLIENT-SIDE staged narrative, snaps to real seeded counts on API resolve.
2. Wording cut ~50% char count — applies to the MODEL'S ACTUAL REPLIES (system prompt brevity rules + hard char budget).
3. Progress bar "X of Y" always visible, Y extends live — compute client-side from tool events + checklist, no backend change needed.
4. Fact-extraction side panel — ALL extracted facts, chat stays centered, panel added beside it.
5. Provisioning pop-up ships on BOTH superadmin "New Company" panel AND public self-serve signup page.

## Build plan
- [x] Discovery (prior session)
- [ ] `services/provisioning-jokes.ts` — ICP-id -> humorous aside line, generic fallback. Covers all 18 ICPs confirmed in industry-presets.ts.
- [ ] `web/components/provisioning-progress.tsx` — reusable staged pop-up:
      props: `website`, `industryId`, `done`, `result` (ProvisionResult["seeded"]|null), `error`.
      Stages: visiting site -> found brand -> branded notifications -> intake forms -> work-order templates -> JOKE -> catalog -> pricing tiers -> admin login -> [on done] final summary with real counts.
      Timed auto-advance (~7-8s/stage), holds + "still working" pulse on last stage if API not done yet, jumps straight to final the instant `done` flips true. Uses tw-animate-css slide/fade utilities already in repo.
- [ ] Wire into `admin/companies.tsx` create modal (replace static "Provisioning…" subtitle/button).
- [ ] Wire into `signup-company.tsx` submit flow (replace plain spinner).
- [ ] Tighten onboarding chat system prompt (`api/routes/onboarding.ts`) — hard character budget + rewritten brevity rule with before/after example, trim prose elsewhere in the prompt opportunistically.
- [ ] `onboarding-chat.tsx` overhaul:
      - Progress bar/label "N of M" at bottom of chat card: M = brand items (3) + baseline (5) + estimatedIcpTotal (starts 4, bumps live if icpAnswered catches up), N = answered so far. Snaps to done on finish_onboarding.
      - Right-hand fact panel (new sibling column, chat card stays centered): accumulates ALL extracted facts from tool events (brand fields, industry, catalog items added, baseline numbers, ICP Q/A) as animated chips/rows, grouped.
      - Keep existing checklist pills, tool pills, transcript untouched in spirit.
- [ ] Build (`bun run build` in packages/web) + visual check via dev server (tmux `web`, port 4200).
- [ ] Commit + push to rempsen/ArrivePingDRv1 main.

## Notes
- `ProvisionResult.seeded` shape: `{ forms, templates, services, catalogItems, optionCategories, notificationCopyBranded }`.
- Superadmin create mutation returns the full `ProvisionResult` (has `.company`, `.seeded`).
- Self-serve signup returns `{ companySlug, companyName, admin, seeded }`.
- `form.industry` available in both forms at submit time for joke selection.
- tw-animate-css already imported in styles.css — use `animate-in fade-in slide-in-from-*` utility classes, no new deps needed.
- `motion` package is installed but unused anywhere yet — NOT introducing it; tw-animate-css covers everything needed, keeps the diff smaller.
