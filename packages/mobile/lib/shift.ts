import { Alert } from "react-native";
import * as Haptics from "expo-haptics";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { stopLocationSharing } from "./use-location-heartbeat";
import { endAllLiveActivities } from "./useLiveActivity";

/**
 * The presence states PATCH /riders/me accepts, derived from the Hono client so
 * a change to the server's enum (routes/riders.ts RIDER_STATUSES) is a type
 * error here rather than a runtime 400.
 */
export type RiderStatus = NonNullable<Parameters<typeof api.riders.me.$patch>[0]>["json"]["status"];

type Me = { status?: string | null } & Record<string, unknown>;

/**
 * On the clock or off it: the technician's shift, shared by the big Sign in
 * button on Jobs and the switch in Profile. "On the clock" is any status but a
 * deliberate offline (busy, en route and on site are still on shift).
 * Same ["me"] query as the tab layout, so tracking and badges follow at once.
 */
export function useShift() {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const res = await api.riders.me.$get();
      if (!res.ok) throw new Error("Failed");
      return (await res.json()).rider as Me | null;
    },
  });

  const set = useMutation({
    mutationFn: async (status: RiderStatus) => {
      const res = await api.riders.me.$patch({ json: { status } });
      if (!res.ok) throw new Error("Failed");
      return (await res.json()).rider;
    },
    // The shared ["me"] status changes only once the server has accepted it:
    // the tab layout stops GPS and ends Live Activities when it reads
    // "offline", and a slow or failed sign-out mustn't do that while the
    // server still has them on shift. The button shows the new colour from
    // the pending request instead (see `status` below).
    onError: (_e, status) => {
      Alert.alert(
        status === "offline" ? "Couldn't sign out" : "Couldn't sign in",
        "Check your connection and try again.",
      );
    },
    onSuccess: (rider, status) => {
      const prev = qc.getQueryData<Me | null>(["me"]);
      qc.setQueryData<Me | null>(["me"], (rider as Me | null) ?? (prev ? { ...prev, status } : prev));
      // Off the clock: stop background GPS now rather than on the layout's next
      // refetch, and end any Live Activity (iOS keeps one until the app ends it).
      if (status === "offline") {
        stopLocationSharing().catch(() => {});
        endAllLiveActivities().catch(() => {});
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });

  // While a change is on its way, show where it's going (this button only).
  const status = (set.isPending ? set.variables : null) ?? me.data?.status ?? null;
  const known = status != null || me.isSuccess;
  const onShift = status != null && status !== "offline";
  const busy = status === "busy" || status === "enroute" || status === "onsite";

  return {
    /** Status has loaded (until then, show neither on nor off). */
    known,
    onShift,
    busy,
    status,
    pending: set.isPending,
    setStatus: (s: RiderStatus) => set.mutate(s),
    toggle: () => {
      if (set.isPending || !known) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      set.mutate(onShift ? "offline" : "available");
    },
  };
}
