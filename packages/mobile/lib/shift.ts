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
    // Show the new colour straight away; put it back if the server says no.
    onMutate: async (status) => {
      await qc.cancelQueries({ queryKey: ["me"] });
      const prev = qc.getQueryData<Me | null>(["me"]);
      if (prev) qc.setQueryData<Me>(["me"], { ...prev, status });
      return { prev };
    },
    onError: (_e, status, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(["me"], ctx.prev);
      Alert.alert(
        status === "offline" ? "Couldn't sign out" : "Couldn't sign in",
        "Check your connection and try again.",
      );
    },
    onSuccess: (_rider, status) => {
      // Off the clock: stop background GPS now rather than on the layout's next
      // refetch, and end any Live Activity (iOS keeps one until the app ends it).
      if (status === "offline") {
        stopLocationSharing().catch(() => {});
        endAllLiveActivities().catch(() => {});
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });

  const status = me.data?.status ?? null;
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
