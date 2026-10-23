import { useLocalSearchParams } from "expo-router";
import { JobDetail } from "../../../components/office/job-detail";

/** Full-screen work order: phones, push taps and deep links. iPad's Jobs tab embeds the same component. */
export default function OfficeJob() {
  const { id, assign } = useLocalSearchParams<{ id: string; assign?: string }>();
  return <JobDetail id={id} assign={assign === "1"} />;
}
