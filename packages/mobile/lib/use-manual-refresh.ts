import { useCallback, useRef, useState } from "react";

/**
 * Pull-to-refresh state that only shows for a pull. A query's `isFetching` is
 * also true during the background refreshes (the live feed, the board's own
 * poll), and wiring that to `RefreshControl` made the spinner flash every
 * few seconds on its own. Here `refreshing` is true only while a refresh the
 * user started is running.
 */
export function useManualRefresh(refresh: () => Promise<unknown> | void) {
  const [refreshing, setRefreshing] = useState(false);
  // Always call the latest `refresh` without re-creating `onRefresh` each render.
  const latest = useRef(refresh);
  latest.current = refresh;
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    Promise.resolve(latest.current())
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, []);
  return { refreshing, onRefresh };
}
