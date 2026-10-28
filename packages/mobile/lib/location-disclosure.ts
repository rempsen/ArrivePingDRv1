import { Alert, Platform } from "react-native";
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import { disclosureDecision } from "./location-disclosure-core";

/**
 * Google Play's prominent disclosure for background location (Android only;
 * see location-disclosure-core.ts for the rules). Shown once, before the
 * system location prompts, while the technician is signed in and on the
 * clock. "Not now" is remembered for a few days, then we ask again.
 *
 * The Play Console's location-permission declaration asks for a short video
 * of this screen followed by the system prompt — docs/PLAY_STORE_RELEASE.md.
 */

const DECLINED_KEY = "bg_location_disclosure_declined_at";

export const DISCLOSURE_TITLE = "Share your location while on the clock";
// Play checks the wording: it must say "location", say it's used "even when
// the app is closed or not in use", name each feature that uses it, and say
// who sees it. Keep those parts if you edit this.
export const DISCLOSURE_BODY =
  "ArrivePing collects your location to show your dispatcher where you are while you're on the clock, " +
  "and to give the customer you're travelling to a live arrival time, even when the app is closed or not in use. " +
  "Going off the clock or signing out stops it.\n\n" +
  "On the next screens, allow location access and choose \"Allow all the time\".";

function declinedAt(): number | null {
  try {
    const raw = SecureStore.getItem(DECLINED_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

function rememberDecline(): void {
  try {
    SecureStore.setItem(DECLINED_KEY, String(Date.now()));
  } catch {
    /* we'll ask again next launch; harmless */
  }
}

function forgetDecline(): void {
  void SecureStore.deleteItemAsync(DECLINED_KEY).catch(() => {});
}

function showDisclosure(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      DISCLOSURE_TITLE,
      DISCLOSURE_BODY,
      [
        { text: "Not now", style: "cancel", onPress: () => resolve(false) },
        { text: "Continue", onPress: () => resolve(true) },
      ],
      { cancelable: false },
    );
  });
}

/**
 * Call before requesting location permissions for background tracking.
 * Resolves true when it's fine to show the system prompts (always on iOS),
 * false when the technician declined the disclosure — now or recently.
 */
export async function okToAskForBackgroundLocation(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  try {
    const [background, foreground] = await Promise.all([
      Location.getBackgroundPermissionsAsync(),
      Location.getForegroundPermissionsAsync(),
    ]);
    const decision = disclosureDecision({
      os: Platform.OS,
      background,
      foreground,
      declinedAt: declinedAt(),
      now: Date.now(),
    });
    if (decision === "proceed") return true;
    if (decision === "skip") return false;
    const ok = await showDisclosure();
    if (!ok) rememberDecline();
    return ok;
  } catch {
    // Can't read permissions: don't prompt without the disclosure.
    return false;
  }
}

/**
 * Report how the system prompts went. A refusal there counts like "Not now",
 * so a technician who said no isn't walked through the notice and Android's
 * settings screen on every launch; granting clears it.
 */
export function noteBackgroundLocationAnswer(granted: boolean): void {
  if (Platform.OS !== "android") return;
  if (granted) forgetDecline();
  else rememberDecline();
}
