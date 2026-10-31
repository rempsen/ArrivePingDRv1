/**
 * The Meta pixel on the marketing site behaves like the HubSpot tracker: it
 * loads only after cookie consent, only on marketing pages, and is dropped
 * when consent is withdrawn.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "https://arriveping.com/" });
const w = dom.window as unknown as Window & typeof globalThis;
(globalThis as any).window = w;
(globalThis as any).document = w.document;
(globalThis as any).navigator = w.navigator;
(globalThis as any).location = w.location;
(globalThis as any).Event = w.Event;
(globalThis as any).CustomEvent = w.CustomEvent;

const consent = await import("../site/lib/hubspot-tracking");
const pixel = await import("../site/lib/meta-pixel");

const scripts = () => [...w.document.querySelectorAll("script")].map((s) => s.getAttribute("src") ?? "");

describe("meta pixel", () => {
  beforeEach(() => {
    w.localStorage.clear();
    for (const s of w.document.querySelectorAll("script")) s.remove();
    delete (w as any).fbq;
    delete (w as any)._fbq;
    pixel._reset();
  });

  it("has the ArrivePing site dataset id", () => {
    expect(pixel.META_PIXEL_ID).toBe("2074568893189246");
  });

  it("does nothing without consent", () => {
    pixel.trackPixelRoute("/pricing");
    expect(scripts()).toEqual([]);
    expect((w as any).fbq).toBeUndefined();
  });

  it("loads once consent is granted on a marketing page, and counts later page views", () => {
    consent.setConsent("granted");
    pixel.trackPixelRoute("/pricing");
    expect(scripts().some((s) => s.includes("connect.facebook.net/en_US/fbevents.js"))).toBe(true);
    const calls = pixel._calls();
    expect(calls).toEqual([["init", "2074568893189246"], ["track", "PageView"]]);
    pixel.trackPixelRoute("/blog/end-the-4-hour-service-window");
    expect(pixel._calls()[pixel._calls().length - 1]).toEqual(["track", "PageView"]);
    expect(pixel._calls().length).toBe(3);
    // the same path again is not a second view
    pixel.trackPixelRoute("/blog/end-the-4-hour-service-window");
    expect(pixel._calls().length).toBe(3);
  });

  it("never loads inside the product or on customer tracking links", () => {
    consent.setConsent("granted");
    pixel.trackPixelRoute("/admin/jobs");
    pixel.trackPixelRoute("/t/7k2q9x");
    expect(scripts()).toEqual([]);
  });

  it("stops queuing events once consent is withdrawn", () => {
    consent.setConsent("granted");
    pixel.trackPixelRoute("/");
    consent.setConsent("denied");
    pixel.trackPixelRoute("/pricing");
    expect(pixel._calls().length).toBe(2); // init + the first PageView only
  });
});
