/**
 * The dispatch channel on the realtime bus: one channel per company, so an
 * open map only ever hears about its own company's technicians and jobs.
 */
import { describe, it, expect } from "bun:test";
import { publishDispatch, subscribeDispatch, publishTrack, type DispatchSignal } from "../realtime";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("dispatch channel", () => {
  it("delivers a company's signals only to that company", async () => {
    const a: DispatchSignal[] = [];
    const b: DispatchSignal[] = [];
    const offA = subscribeDispatch("rt-co-a", (s) => a.push(s));
    const offB = subscribeDispatch("rt-co-b", (s) => b.push(s));
    await publishDispatch("rt-co-a", { kind: "location", techId: "t1", lat: 49.9, lng: -97.1, at: 1 });
    await publishDispatch("rt-co-a", { kind: "job", jobId: "j1" });
    await tick();
    expect(a).toEqual([
      { kind: "location", techId: "t1", lat: 49.9, lng: -97.1, at: 1 },
      { kind: "job", jobId: "j1" },
    ]);
    expect(b).toEqual([]);
    offA();
    offB();
  });

  it("stops delivering after unsubscribe", async () => {
    const got: DispatchSignal[] = [];
    const off = subscribeDispatch("rt-co-c", (s) => got.push(s));
    off();
    await publishDispatch("rt-co-c", { kind: "tech", techId: "t2" });
    await tick();
    expect(got).toEqual([]);
  });

  it("keeps fanning out when one subscriber throws", async () => {
    const got: DispatchSignal[] = [];
    const offBad = subscribeDispatch("rt-co-d", () => {
      throw new Error("boom");
    });
    const offGood = subscribeDispatch("rt-co-d", (s) => got.push(s));
    await publishDispatch("rt-co-d", { kind: "tech", techId: "t3" });
    await tick();
    expect(got).toEqual([{ kind: "tech", techId: "t3" }]);
    offBad();
    offGood();
  });

  it("ignores a missing company and other channels' traffic", async () => {
    const got: DispatchSignal[] = [];
    const off = subscribeDispatch("rt-co-e", (s) => got.push(s));
    await expect(publishDispatch(null, { kind: "tech", techId: "t4" })).resolves.toBeUndefined();
    await expect(publishDispatch("", { kind: "tech", techId: "t4" })).resolves.toBeUndefined();
    await publishTrack({ type: "location", token: "rt-co-e", data: { lat: 1, lng: 2 } });
    await tick();
    expect(got).toEqual([]);
    off();
  });
});
