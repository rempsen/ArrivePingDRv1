import { Platform } from "react-native";
import { initialWindowMetrics, useSafeAreaInsets } from "react-native-safe-area-context";
import { androidBottomInset, bottomBarPadding } from "./bottom-inset-core";

export { TAB_BAR_CONTENT } from "./bottom-inset-core";

/**
 * Bottom padding for a bar pinned to the bottom edge. On Android it follows the
 * phone's navigation setting (see bottom-inset-core.ts); on iOS it is the
 * bar's existing `iosPadding`.
 */
export function useBottomBarPadding(iosPadding: number, androidGap: number): number {
  const insets = useSafeAreaInsets();
  return bottomBarPadding(Platform.OS, insets.bottom, iosPadding, androidGap);
}

/** Extra space under scrolling content on Android so its last item clears the navigation bar. */
export function useAndroidBottomInset(): number {
  const insets = useSafeAreaInsets();
  return androidBottomInset(Platform.OS, insets.bottom);
}

/**
 * The same padding, for places that can't use hooks (the crash screen's class
 * component). Uses the insets measured at launch.
 */
export function launchBottomBarPadding(iosPadding: number, androidGap: number): number {
  return bottomBarPadding(Platform.OS, initialWindowMetrics?.insets.bottom ?? 0, iosPadding, androidGap);
}
