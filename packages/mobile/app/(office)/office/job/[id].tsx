import { useLocalSearchParams } from "expo-router";
import { JobDetail } from "../../../../components/office/job-detail";
import { FocusOnly } from "../../../../components/office/focus-only";

/**
 * Full-screen work order: phones, push taps and deep links. iPad's Jobs tab embeds the same component.
 * A hidden tab of the office tabs (the tab bar stays visible), keyed by job so a new id starts clean.
 */
export default function OfficeJob() {
  const { id, assign } = useLocalSearchParams<{ id: string; assign?: string }>();
  return (
    <FocusOnly>
      <JobDetail key={id} id={id} assign={assign === "1"} />
    </FocusOnly>
  );
}
