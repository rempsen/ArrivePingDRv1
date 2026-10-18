export const MAP_KEY = "arriveping.mapV2";

/** Remember the choice and reload into it. */
export function setMapV2(on: boolean) {
  try {
    localStorage.setItem(MAP_KEY, on ? "1" : "0");
  } catch {
    /* private mode: the URL flag still works */
  }
  const u = new URL(window.location.href);
  u.searchParams.set("map", on ? "v2" : "classic");
  window.location.assign(u);
}
