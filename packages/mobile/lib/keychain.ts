import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { makeBackgroundKeychain, type KeychainApi } from "./keychain-core";

export type { KeychainRead } from "./keychain-core";

/**
 * A Keychain value the background location task can read while the phone is
 * locked. The logic (and why) is in keychain-core.ts; this wires in the real
 * Keychain.
 */
export function backgroundKeychain(key: string) {
  return makeBackgroundKeychain(key, SecureStore as unknown as KeychainApi, Platform.OS === "web");
}
