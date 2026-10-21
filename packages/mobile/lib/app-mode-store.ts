import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { AppMode } from "./app-mode";

/**
 * The mode a dual-role person last chose, kept on the device. Separate from
 * `app-mode.ts` so the pure resolver stays importable from bun tests, which
 * cannot load react-native.
 */
const KEY = "app_mode";
const isWeb = Platform.OS === "web";

/** Sync read, same Keychain path as the active company. Never throws. */
export function getSavedMode(): AppMode | null {
  try {
    const v = isWeb ? localStorage.getItem(KEY) : SecureStore.getItem(KEY);
    return v === "field" || v === "office" ? v : null;
  } catch {
    return null;
  }
}

export async function setSavedMode(mode: AppMode): Promise<void> {
  try {
    if (isWeb) localStorage.setItem(KEY, mode);
    else await SecureStore.setItemAsync(KEY, mode);
  } catch {
    // A preference that fails to persist only means the next launch asks the
    // default question again; it is not worth blocking the switch over.
  }
}
