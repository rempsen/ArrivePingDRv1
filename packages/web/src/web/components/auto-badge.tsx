/**
 * The "A in a circle" that marks a job an automation rule assigned on its
 * own. Dan's rule: every auto-assigned job is visibly marked everywhere it
 * appears — scheduler chips and tiles, calendar blocks, the bookings list,
 * and the job detail header — so the office can always tell what a human
 * decided and what the automation did.
 *
 * Driven by `booking.autoAssignedRuleId`; cleared the moment a dispatcher
 * reassigns, releases or the tech declines (see routes/bookings.ts).
 */
export function AutoBadge({
  booking,
  size = "sm",
  className = "",
}: {
  booking: { autoAssignedRuleId?: string | null } | null | undefined;
  /** xs = calendar blocks, sm = chips/lists, md = detail header */
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  if (!booking?.autoAssignedRuleId) return null;
  const dims =
    size === "xs" ? "h-3.5 w-3.5 text-[9px]" : size === "md" ? "h-5 w-5 text-xs" : "h-4 w-4 text-[10px]";
  return (
    <span
      data-testid="auto-badge"
      aria-label="Auto-assigned by automation"
      title="Auto-assigned by automation"
      className={`inline-grid shrink-0 place-items-center rounded-full bg-violet-500 font-bold leading-none text-white ring-1 ring-ink-3 ${dims} ${className}`}
    >
      A
    </span>
  );
}

/** Same mark, positioned in the top-right corner of a `relative` parent. */
export function AutoBadgeCorner({ booking }: { booking: { autoAssignedRuleId?: string | null } | null | undefined }) {
  if (!booking?.autoAssignedRuleId) return null;
  return (
    <span className="pointer-events-none absolute right-1 top-1 z-10">
      <AutoBadge booking={booking} size="xs" />
    </span>
  );
}
