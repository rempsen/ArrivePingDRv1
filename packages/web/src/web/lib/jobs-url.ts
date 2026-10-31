/**
 * Links into the Jobs list from elsewhere in the dashboard.
 *
 *   ?open=<jobId>   open that job (Inbox "Open job", Running late)
 *   ?q=<text>       prefill the search box (Change Requests' job number)
 *   ?status=<s>     one of the list's quick filters ("pending", "completed"…),
 *                   or a comma list of statuses ("assigned,enroute,…") that
 *                   goes into the Status filter instead
 *
 * `open` and `q` are one-shot: the page uses them and takes them off the URL
 * so a refresh or Back doesn't reopen the job or reset the search. `status`
 * stays, so the filtered view can be bookmarked.
 */

/** The statuses the dashboard's "Active jobs" card counts (api/routes/admin.ts). */
export const ACTIVE_STATUSES = ["assigned", "enroute", "arrived", "in_progress"];

export type JobsUrlParams = {
  open: string;
  q: string;
  /** A quick-filter key, or "" when the status isn't one of them. */
  quick: string;
  /** Statuses for the Status filter when `status` wasn't a single quick key. */
  statusList: string[];
  /** The search string without the one-shot params ("" or "?…"). */
  rest: string;
};

export function readJobsUrl(search: string, quickKeys: string[]): JobsUrlParams {
  const p = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const open = (p.get("open") ?? "").trim();
  const q = (p.get("q") ?? "").trim();
  const status = (p.get("status") ?? "").trim();
  const isQuick = !!status && !status.includes(",") && quickKeys.includes(status);
  const statusList = status && !isQuick
    ? status.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  p.delete("open");
  p.delete("q");
  const restStr = p.toString();
  return {
    open,
    q,
    quick: isQuick ? status : "",
    statusList,
    rest: restStr ? `?${restStr}` : "",
  };
}
