/**
 * SIGNUP THAT OUTLASTS THE EDGE PROXY.
 *   - Cloudflare's HTML error page (or a dropped connection) counts as "the
 *     server may still be working", a JSON error from the API doesn't;
 *   - the page then waits on the signup's status until it's done, stuck, or
 *     clearly never started;
 *   - an HTML body is never shown to a person as an error message.
 */
import { describe, it, expect } from "bun:test";
import { ApiError, messageFromBody } from "../lib/api-error";
import { isGatewayFailure, waitForSignup, SignupWaitError, type SignupStatus } from "../lib/signup-wait";

const CF_PAGE = `<!DOCTYPE html>\n<!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US"> <![endif]-->\n<html><body>Error 524</body></html>`;
const err = (status: number, body: unknown) => new ApiError({ status, message: messageFromBody(body, status), body });

describe("isGatewayFailure", () => {
  it("is true for the proxy's HTML page, an empty 5xx, or a dropped connection", () => {
    expect(isGatewayFailure(err(524, CF_PAGE))).toBe(true);
    expect(isGatewayFailure(err(502, undefined))).toBe(true);
    expect(isGatewayFailure(new TypeError("Failed to fetch"))).toBe(true);
  });
  it("is false when the API itself answered", () => {
    expect(isGatewayFailure(err(500, { message: "Email already in use" }))).toBe(false);
    expect(isGatewayFailure(err(400, { message: "Add a payment method" }))).toBe(false);
    expect(isGatewayFailure(err(429, "Too many requests"))).toBe(false);
    expect(isGatewayFailure(new Error("boom"))).toBe(false);
  });
});

describe("messageFromBody", () => {
  it("never returns HTML", () => {
    const m = messageFromBody(CF_PAGE, 524);
    expect(m).not.toContain("<");
    expect(m).toContain("524");
    expect(messageFromBody("plain words", 500)).toBe("plain words");
  });
});

function seq(...answers: Array<SignupStatus | Error>) {
  let i = 0;
  return async () => {
    const a = answers[Math.min(i++, answers.length - 1)]!;
    if (a instanceof Error) throw a;
    return a;
  };
}
const fast = { sleep: async () => {}, everyMs: 1 };

describe("waitForSignup", () => {
  it("waits through pending (and a failed check) until done", async () => {
    const out = await waitForSignup({ ...fast, check: seq({ state: "pending" }, new Error("blip"), { state: "pending" }, { state: "done", companySlug: "acme", admin: { id: "u1" } }) });
    expect(out).toEqual({ companySlug: "acme", admin: { id: "u1" } });
  });
  it("stops with the server's message when the signup is stuck or the card is taken", async () => {
    await expect(waitForSignup({ ...fast, check: seq({ state: "pending" }, { state: "stalled", message: "contact support" }) })).rejects.toThrow("contact support");
    await expect(waitForSignup({ ...fast, check: seq({ state: "taken", message: "card used" }) })).rejects.toBeInstanceOf(SignupWaitError);
  });
  it("gives up when the signup never started", async () => {
    let n = 0;
    await expect(
      waitForSignup({
        ...fast,
        noneLimit: 3,
        check: async () => {
          n++;
          return { state: "none" };
        },
      }),
    ).rejects.toThrow("try again");
    expect(n).toBe(3);
  });
  it("a pending answer resets the 'never started' count", async () => {
    const out = await waitForSignup({ ...fast, noneLimit: 2, check: seq({ state: "none" }, { state: "pending" }, { state: "none" }, { state: "done", companySlug: "x" }) });
    expect(out.companySlug).toBe("x");
  });
  it("gives up after the time limit", async () => {
    let t = 0;
    await expect(waitForSignup({ ...fast, maxMs: 10, now: () => (t += 4), check: seq({ state: "pending" }) })).rejects.toThrow("longer than usual");
  });
});
