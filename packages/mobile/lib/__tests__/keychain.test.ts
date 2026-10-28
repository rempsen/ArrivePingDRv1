/**
 * The session and active company must be readable by the background location
 * task on a LOCKED phone. Items saved with the default accessibility refuse
 * every read while locked; the task took that as "signed out" and stopped
 * tracking. These run against a fake Keychain that behaves like iOS: an item
 * saved without AFTER_FIRST_UNLOCK throws on read while the phone is locked.
 */
import { describe, expect, test, beforeEach } from "bun:test";
import { makeBackgroundKeychain, type KeychainApi } from "../keychain-core";

const AFTER_FIRST_UNLOCK = 0;
type Item = { value: string; bgReadable: boolean };
const items = new Map<string, Item>();
let locked = false;
let failNextBgWrite = false;

function readItem(key: string): string | null {
  const it = items.get(key);
  if (!it) return null;
  if (locked && !it.bgReadable) throw new Error("User interaction is not allowed.");
  return it.value;
}
function writeItem(key: string, value: string, options?: { keychainAccessible?: number }) {
  const bg = options?.keychainAccessible === AFTER_FIRST_UNLOCK;
  if (bg && failNextBgWrite) {
    failNextBgWrite = false;
    throw new Error("Keychain error");
  }
  const existing = items.get(key);
  // Like expo-secure-store: an existing item keeps its accessibility; only the value changes.
  items.set(key, { value, bgReadable: existing ? existing.bgReadable : bg });
}

const fakeKeychain: KeychainApi = {
  AFTER_FIRST_UNLOCK,
  getItem: (key) => readItem(key),
  setItem: (key, value, options) => writeItem(key, value, options),
  setItemAsync: async (key, value, options) => writeItem(key, value, options),
  deleteItemAsync: async (key) => {
    items.delete(key);
  },
};
const backgroundKeychain = (key: string) => makeBackgroundKeychain(key, fakeKeychain, false);

beforeEach(() => {
  items.clear();
  locked = false;
  failNextBgWrite = false;
});

describe("backgroundKeychain", () => {
  test("a value saved by an older build can't be read while locked — and says so", () => {
    items.set("bearer_token", { value: "tok", bgReadable: false });
    const store = backgroundKeychain("bearer_token");
    expect(store.read()).toEqual({ value: "tok", state: "present" });
    locked = true;
    // Not "missing": the tech is still signed in, the Keychain just refused.
    expect(store.read()).toEqual({ value: "", state: "unreadable" });
  });

  test("after the upgrade it reads on a locked phone, and the old copy is gone", async () => {
    items.set("bearer_token", { value: "tok", bgReadable: false });
    const store = backgroundKeychain("bearer_token");
    await store.upgrade();
    expect(items.has("bearer_token")).toBe(false);
    locked = true;
    expect(store.read()).toEqual({ value: "tok", state: "present" });
  });

  test("a failed upgrade keeps the old copy, so nobody is signed out", async () => {
    items.set("bearer_token", { value: "tok", bgReadable: false });
    failNextBgWrite = true;
    const store = backgroundKeychain("bearer_token");
    await store.upgrade();
    expect(store.read()).toEqual({ value: "tok", state: "present" });
  });

  test("an upgrade while locked does nothing and doesn't throw", async () => {
    items.set("bearer_token", { value: "tok", bgReadable: false });
    locked = true;
    const store = backgroundKeychain("bearer_token");
    await store.upgrade();
    locked = false;
    expect(items.get("bearer_token")?.value).toBe("tok");
  });

  test("new values are saved readable while locked, replacing an old copy", async () => {
    items.set("active_company_id", { value: "old-co", bgReadable: false });
    const store = backgroundKeychain("active_company_id");
    await store.writeAsync("bmd");
    locked = true;
    expect(store.read()).toEqual({ value: "bmd", state: "present" });
    expect(items.has("active_company_id")).toBe(false);
  });

  test("signed out is missing, not unreadable", async () => {
    const store = backgroundKeychain("bearer_token");
    store.write("tok");
    await store.clear();
    locked = true;
    expect(store.read()).toEqual({ value: "", state: "missing" });
  });
});
