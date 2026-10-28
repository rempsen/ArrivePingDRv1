import { useState } from "react";
import { Alert } from "react-native";
import { useDispatchActions } from "../../lib/use-dispatch-actions";
import { showToast } from "./undo-toast";

/**
 * Assign one job to one technician, the way every office screen does it:
 * Undo toast on success, the server's reason with "Assign anyway" on a
 * forceable refusal. Shared by the Assign sheet and the job's suggested
 * technicians.
 *
 * The server keeps two overrides apart: `force` interrupts a job that is
 * already in the field (or re-offers one the tech accepted); `forceBusy`
 * double-books over a clash or time off. A refusal with a `reason` is the
 * availability kind; one without is the in-flight kind. Each confirm adds
 * only the override the server asked about, so saying yes to "interrupt the
 * current visit" never silently double-books the same person as well.
 */
export function useAssign(bookingId: string, currentRiderId: string | null, jobLabel: string) {
  const { assign, undo } = useDispatchActions();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function assignTo(techId: string, name: string, onDone?: () => void, overrides: { force?: boolean; forceBusy?: boolean } = {}) {
    setBusyId(techId);
    const r = await assign(bookingId, techId, {
      force: !!overrides.force,
      // Explicit false keeps the availability check on while `force` is set.
      forceBusy: !!overrides.forceBusy,
      expectRiderId: currentRiderId,
    });
    setBusyId(null);
    if (r.ok) {
      onDone?.();
      const undoToken = r.undo;
      showToast(`${jobLabel} → ${name}`, {
        onUndo: undoToken
          ? async () => {
              const u = await undo(undoToken, bookingId);
              if (!u.ok) Alert.alert("Couldn't undo", u.message);
            }
          : undefined,
      });
      return;
    }
    if (r.forceable) {
      const next = r.reason ? { ...overrides, forceBusy: true } : { ...overrides, force: true };
      Alert.alert(`Send ${name} anyway?`, r.message, [
        { text: "Cancel", style: "cancel" },
        { text: "Assign anyway", style: "destructive", onPress: () => assignTo(techId, name, onDone, next) },
      ]);
      return;
    }
    Alert.alert("Couldn't assign", r.message);
  }

  return { assignTo, busyId };
}
