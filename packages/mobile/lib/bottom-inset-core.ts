/**
 * Room to leave under anything pinned to the bottom of the screen: tab bars,
 * sticky action buttons, bottom sheets, the message composer.
 * Pure (no React Native imports) so it runs under `bun test`.
 *
 * Android draws the app edge to edge (app.json `edgeToEdgeEnabled`), so
 * Android's own navigation sits on top of our bottom edge. How much space it
 * takes depends on the phone's settings, which the system reports as the
 * bottom safe-area inset:
 *   - 3-button navigation (◁ ○ □): about 48 dp. Our bar has to sit above it.
 *   - Gesture navigation: a thin strip for the gesture pill (about 16–24 dp).
 *     The app stays full screen, with only that strip kept clear.
 *   - No navigation shown: 0. Fully full screen.
 * Modals are edge to edge as well on Android (React Native forces it when
 * edge-to-edge is on), so bottom sheets need the same room.
 *
 * iOS keeps the padding each bar was designed with: those values already
 * clear the home indicator, and changing them would move every iPhone screen.
 */

/** A bar's bottom padding: its iOS value, or Android's navigation inset plus the bar's own breathing room. */
export function bottomBarPadding(os: string, insetBottom: number, iosPadding: number, androidGap: number): number {
  if (os !== "android") return iosPadding;
  const inset = Number.isFinite(insetBottom) && insetBottom > 0 ? Math.round(insetBottom) : 0;
  return inset + androidGap;
}

/**
 * Space to add under scrolling content whose screen doesn't pad its bottom
 * edge, so the last button can scroll clear of Android's navigation. 0 on iOS,
 * where those screens already scroll under the home indicator by design.
 */
export function androidBottomInset(os: string, insetBottom: number): number {
  if (os !== "android") return 0;
  return Number.isFinite(insetBottom) && insetBottom > 0 ? Math.round(insetBottom) : 0;
}

/** Content height of a tab bar (icon, label and the space above them), not counting its bottom padding. */
export const TAB_BAR_CONTENT = 56;
