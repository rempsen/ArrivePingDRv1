/**
 * On /get-started the card is saved with stripe.confirmSetup BEFORE the
 * signup request. When that request then fails (live, 2026-11-04), pressing
 * "Start my free trial" again confirmed the same SetupIntent a second time,
 * and Stripe refuses that ("already succeeded"), so the person was stuck on
 * an error under the card form with no way forward except Back.
 * A retry after a saved card must go straight to the signup request.
 */
import { describe, expect, test } from "bun:test";
import { saveCardOnce } from "../lib/setup-intent";

describe("saveCardOnce", () => {
  test("confirms the card once, then skips Stripe on a retry", async () => {
    let calls = 0;
    const confirm = async () => {
      calls++;
      return {};
    };
    const state = { saved: false };
    expect(await saveCardOnce(confirm, state)).toEqual({ ok: true });
    expect(await saveCardOnce(confirm, state)).toEqual({ ok: true });
    expect(calls).toBe(1);
  });

  test("treats Stripe's 'already succeeded' answer as saved", async () => {
    const state = { saved: false };
    const confirm = async () => ({
      error: { code: "setup_intent_unexpected_state", message: "already succeeded", setup_intent: { status: "succeeded" } },
    });
    expect(await saveCardOnce(confirm, state)).toEqual({ ok: true });
    expect(state.saved).toBe(true);
  });

  test("a real card error is reported and nothing is marked saved", async () => {
    const state = { saved: false };
    const confirm = async () => ({ error: { code: "card_declined", message: "Your card was declined." } });
    expect(await saveCardOnce(confirm, state)).toEqual({ ok: false, message: "Your card was declined." });
    expect(state.saved).toBe(false);
  });
});
