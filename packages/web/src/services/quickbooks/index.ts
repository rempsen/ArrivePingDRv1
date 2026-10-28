/**
 * QuickBooks Sync. Importing this module registers the scheduler handlers
 * (server.ts does so at boot); the pieces are in client.ts, resolve.ts,
 * mapping.ts, sync.ts and pull.ts.
 */
export { enqueueQboSync, isQboActive, onJobEvent, syncBookingNow, docNumberFor } from "./sync";
export { settings, parseSettings, setMapping, type QboSettings, type BillMode } from "./resolve";
export { QboError, loadConnection } from "./client";
