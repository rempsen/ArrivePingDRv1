/**
 * "Ask ArrivePing" evaluation set (blueprint Phase 4: ≥ 18 of 20).
 *
 * Each question is something a new office user actually types. An answer
 * passes when the assistant offers one of `tours` (start_tour) or `articles`
 * (show_article), or opens one of `pages` (open_page). Used by:
 *   - shared/__tests__/guide-ask.test.ts — the retrieval step must put an
 *     expected article in front of the model (no model needed, runs in CI);
 *   - scripts/guide-ask-eval.ts — the live run against the real model.
 */
export interface AskEvalCase {
  q: string;
  tours?: string[];
  articles?: string[];
  pages?: string[];
}

export const ASK_EVAL: AskEvalCase[] = [
  { q: "How do I change the reply-to address on our emails?", tours: ["reply-to"], articles: ["set-your-reply-to-email"] },
  { q: "how do i add a technician", tours: ["people"], articles: ["invite-your-technicians"] },
  { q: "Where do I create a new job?", tours: ["create-job"], articles: ["your-first-job"] },
  { q: "Can I see the whole week on a calendar?", tours: ["scheduler"], articles: ["scheduler-views"], pages: ["/admin/scheduler"] },
  { q: "How do I export my jobs to Excel?", tours: ["export"], articles: ["exports-and-integrations"] },
  { q: "Can I change the text customers get when the tech is on the way?", tours: ["milestones"], articles: ["customize-messages"] },
  { q: "Where are the revenue reports?", tours: ["reports"], articles: ["run-a-report"], pages: ["/admin/reports"] },
  { q: "How do my customers track the technician?", tours: ["notifications"], articles: ["what-customers-receive", "on-the-way-and-arrival"] },
  { q: "A customer says they never got the text message", articles: ["customer-did-not-get-the-text", "check-what-was-sent"] },
  { q: "How do I give a dispatcher access?", tours: ["people"], articles: ["roles-and-permissions"] },
  { q: "What happens when a tech is running late?", tours: ["milestones"], articles: ["running-late"] },
  { q: "Can I stop texts going out at night?", tours: ["notifications"], articles: ["quiet-hours"], pages: ["/admin/notifications"] },
  { q: "where's the live map", tours: ["find-your-way"], articles: ["live-map"], pages: ["/admin/fleet"] },
  { q: "How much does it cost per technician?", articles: ["pricing-and-seats", "add-or-remove-drivers"] },
  { q: "Can I import my customer list from a spreadsheet?", tours: ["people"], pages: ["/admin/clients"] },
  { q: "Can I see our jobs in Google Calendar?", tours: ["export"], articles: ["exports-and-integrations"] },
  { q: "Where can I check whether a message was actually sent?", tours: ["notifications"], articles: ["check-what-was-sent"] },
  { q: "How do I assign a job to one of my techs?", tours: ["scheduler"], articles: ["assigning-jobs"] },
  { q: "I want to add my own custom milestone", tours: ["milestones"], pages: ["/admin/automation", "/admin/notifications"] },
  { q: "The ETA on the tracking page isn't updating", articles: ["eta-not-updating"] },
];
