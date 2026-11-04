/**
 * Saving a card with a Stripe SetupIntent, once.
 *
 * The signup card step saves the card first and only then asks the server to
 * create the account. If that second request fails, the person presses the
 * button again; confirming the same SetupIntent twice is refused by Stripe
 * ("setup_intent_unexpected_state", status "succeeded"), which left them
 * stuck. So: remember a successful save, and read Stripe's "already
 * succeeded" answer as success too.
 */

type ConfirmResult = {
  error?: { code?: string; message?: string; setup_intent?: { status?: string } | null };
};

export async function saveCardOnce(
  confirm: () => Promise<ConfirmResult>,
  state: { saved: boolean },
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (state.saved) return { ok: true };
  const { error } = await confirm();
  if (!error || (error.code === "setup_intent_unexpected_state" && error.setup_intent?.status === "succeeded")) {
    state.saved = true;
    return { ok: true };
  }
  return { ok: false, message: error.message ?? "We couldn't save that card. Please check the details." };
}
