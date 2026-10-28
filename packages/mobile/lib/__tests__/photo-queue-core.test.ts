import { describe, expect, it } from "bun:test";
import {
  afterFailure,
  dueForRetry,
  isPermanentFailure,
  newPhotoId,
  parseQueue,
  pendingLabel,
  resetForRetry,
  retryDelayMs,
  type PendingPhoto,
} from "../photo-queue-core";

const base: PendingPhoto = {
  clientId: "0f8b2c4e-1a2b-4c3d-8e9f-a0b1c2d3e4f5",
  bookingId: "job-1",
  uri: "file:///doc/pending-photos/x.jpg",
  fileName: "job.jpg",
  mimeType: "image/jpeg",
  phase: "during",
  createdAt: 0,
  attempts: 0,
};

describe("waiting photos", () => {
  it("are sent at once, then back off to every 5 minutes", () => {
    expect(dueForRetry(base, 0)).toBe(true);
    const once = afterFailure(base, 503, "Server busy", 1_000);
    expect(dueForRetry(once, 1_000 + 14_000)).toBe(false);
    expect(dueForRetry(once, 1_000 + 15_000)).toBe(true);
    expect(retryDelayMs(2)).toBe(30_000);
    expect(retryDelayMs(40)).toBe(300_000);
  });

  it("keep trying on no signal, sign-out, rate limits and server errors", () => {
    for (const s of [0, 401, 408, 429, 500, 502, 503]) expect(isPermanentFailure(s)).toBe(false);
    const p = afterFailure(base, 0, "Network request failed", 5);
    expect(p.stuck).toBe(false);
    expect(p.lastError).toBe("No connection");
    expect(p.attempts).toBe(1);
  });

  it("stop and wait for the technician when the server refuses them for good", () => {
    for (const s of [400, 404, 409, 413, 415]) expect(isPermanentFailure(s)).toBe(true);
    const p = afterFailure(base, 409, "That photo belongs to another job.", 5);
    expect(p.stuck).toBe(true);
    expect(dueForRetry(p, 10_000_000)).toBe(false);
    expect(pendingLabel(p)).toBe("Not uploaded");
    const again = resetForRetry(p);
    expect(dueForRetry(again, 6)).toBe(true);
  });

  it("say what's happening on their badge", () => {
    expect(pendingLabel(base)).toBe("Uploading…");
    expect(pendingLabel(afterFailure(base, 503, "x", 1))).toBe("Waiting to upload");
  });
});

describe("photo ids", () => {
  it("are UUIDs the server accepts, and different every time", () => {
    const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    const ids = new Set(Array.from({ length: 200 }, () => newPhotoId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(re);
  });
});

describe("the saved queue", () => {
  it("reads back what was saved and drops anything unreadable", () => {
    expect(parseQueue(JSON.stringify([base]))).toEqual([base]);
    expect(parseQueue(JSON.stringify([base, { nope: 1 }, null]))).toEqual([base]);
    expect(parseQueue("not json")).toEqual([]);
    expect(parseQueue(null)).toEqual([]);
    expect(parseQueue("{}")).toEqual([]);
  });
});
