import { useIsFocused } from "expo-router";

/**
 * Tab screens stay mounted after you leave them. The job, thread and form
 * screens live inside the office tabs (so the tab bar stays visible), but they
 * are one-shot: a New job form must open blank every time, and a job screen
 * must not keep an old job's open sheets. Rendering nothing while the tab is
 * unfocused unmounts them, so each visit starts fresh.
 */
export function FocusOnly({ children }: { children: React.ReactNode }) {
  return useIsFocused() ? <>{children}</> : null;
}
