/**
 * Scheduled-task kinds for the dispatch notices held through an Undo window
 * (services/dispatch-assign.ts, services/dispatch-schedule.ts). In their own
 * module so services/assign.ts can name them without an import cycle.
 */
export const ASSIGNED_NOTICE_TASK = "dispatch_assigned";
export const RESCHEDULED_NOTICE_TASK = "dispatch_rescheduled";
