
/**
 * A Keychain value the background location task can read while the phone is
 * LOCKED.
 *
 * The session token and the active company used to be saved with the default
 * accessibility (WHEN_UNLOCKED), which refuses every read on a locked phone.
 * The background task then saw "no token", took the tech for signed out and
 * stopped tracking a minute or two after the phone went in a pocket; a
 * request that did go out had no company header and landed on the driver's
 * home company. The pin froze until they signed out and back in.
 *
 * Values are now kept under a second key saved AFTER_FIRST_UNLOCK (readable
 * once the phone has been unlocked once since it started — Apple's setting for
 * background work). expo-secure-store can't change an existing item's
 * accessibility, and it has no synchronous delete, so the old item is not
 * rewritten in place: the new copy is written first and the old one removed
 * after, and reads fall back to the old key. At no moment is there no readable
 * copy, so nothing signs the tech out mid-upgrade.
 *
 * `state` tells "missing" (signed out / never chosen) from "unreadable" (the
 * Keychain refused: locked before the first unlock) — the background task
 * must wait out the second, never treat it as the first.
 */
export type KeychainRead = { value: string; state: "present" | "missing" | "unreadable" };

/** The slice of expo-secure-store this needs (injected so it can be tested without native modules). */
export type KeychainApi = {
  AFTER_FIRST_UNLOCK: number;
  getItem(key: string): string | null;
  setItem(key: string, value: string, options?: { keychainAccessible?: number }): void;
  setItemAsync(key: string, value: string, options?: { keychainAccessible?: number }): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

export function makeBackgroundKeychain(key: string, SecureStore: KeychainApi, isWeb: boolean) {
  const bgKey = `${key}_bg`;
  const BG = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

  function read(): KeychainRead {
    if (isWeb) {
      try {
        const v = localStorage.getItem(key) ?? "";
        return { value: v, state: v ? "present" : "missing" };
      } catch {
        return { value: "", state: "missing" };
      }
    }
    let newUnreadable = false;
    try {
      const v = SecureStore.getItem(bgKey);
      if (v) return { value: v, state: "present" };
    } catch {
      newUnreadable = true;
    }
    try {
      const v = SecureStore.getItem(key);
      if (v) return { value: v, state: "present" };
      return { value: "", state: newUnreadable ? "unreadable" : "missing" };
    } catch {
      return { value: "", state: "unreadable" };
    }
  }

  /** Save (sync). Throws on native if the Keychain refuses. */
  function write(value: string): void {
    if (isWeb) {
      localStorage.setItem(key, value);
      return;
    }
    SecureStore.setItem(bgKey, value, BG);
    void SecureStore.deleteItemAsync(key).catch(() => {});
  }

  /** Save (async). Throws on native if the Keychain refuses. */
  async function writeAsync(value: string): Promise<void> {
    if (isWeb) {
      localStorage.setItem(key, value);
      return;
    }
    await SecureStore.setItemAsync(bgKey, value, BG);
    await SecureStore.deleteItemAsync(key).catch(() => {});
  }

  async function clear(): Promise<void> {
    if (isWeb) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
      return;
    }
    await Promise.all([
      SecureStore.deleteItemAsync(bgKey).catch(() => {}),
      SecureStore.deleteItemAsync(key).catch(() => {}),
    ]);
  }

  /**
   * Copy a value saved by an older build to the background-readable key. Run
   * in the foreground (phone unlocked). Never throws; harmless to repeat.
   */
  async function upgrade(): Promise<void> {
    if (isWeb) return;
    try {
      if (SecureStore.getItem(bgKey)) {
        await SecureStore.deleteItemAsync(key).catch(() => {});
        return;
      }
      const old = SecureStore.getItem(key);
      if (!old) return;
      SecureStore.setItem(bgKey, old, BG);
      if (SecureStore.getItem(bgKey) === old) await SecureStore.deleteItemAsync(key).catch(() => {});
    } catch {
      /* locked or unavailable: the next launch tries again */
    }
  }

  return { read, write, writeAsync, clear, upgrade };
}
