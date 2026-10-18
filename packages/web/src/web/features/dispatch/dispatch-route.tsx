/**
 * /admin/fleet: picks the new dispatch map or the classic one.
 * Precedence: ?map=v2|classic in the URL, then the person's saved choice,
 * then the company default (on for our own companies). WebGL2 is required for v2.
 */
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useEffect } from "react";
import { fetchSettings } from "./data/api";
import { MAP_KEY as KEY } from "./map-switch";

const ClassicFleet = lazy(() => import("../../pages/admin/fleet"));
const DispatchPage = lazy(() => import("./dispatch-page").then((m) => ({ default: m.DispatchPage })));


let webgl2: boolean | null = null;
/** Checked once, and the probe context is released straight away. */
function hasWebGL2(): boolean {
  if (webgl2 !== null) return webgl2;
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    webgl2 = !!gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webgl2 = false;
  }
  return webgl2;
}

function saved(): boolean | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "1" ? true : v === "0" ? false : null;
  } catch {
    return null;
  }
}

export function useMapV2(): boolean | null {
  const param = new URLSearchParams(window.location.search).get("map");
  const explicit = param === "v2" ? true : param === "classic" ? false : saved();
  const q = useQuery({ queryKey: ["dispatch-settings"], queryFn: fetchSettings, enabled: explicit === null, staleTime: 5 * 60_000, retry: 1 });
  useEffect(() => {
    if (param === "v2" || param === "classic") {
      try {
        localStorage.setItem(KEY, param === "v2" ? "1" : "0");
      } catch {
        /* ignore */
      }
    }
  }, [param]);
  let want: boolean | null;
  if (explicit !== null) want = explicit;
  else if (q.isError) want = false;
  else want = q.data ? q.data.mapV2Default : null;
  if (want === null) return null;
  return want && hasWebGL2();
}

export default function FleetRoute() {
  const v2 = useMapV2();
  if (v2 === null) return null;
  return <Suspense fallback={null}>{v2 ? <DispatchPage /> : <ClassicFleet />}</Suspense>;
}
