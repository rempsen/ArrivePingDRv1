import { useLocalSearchParams } from "expo-router";
import { ThreadView } from "../../../components/office/thread-view";

/** Full-screen thread: phones and push taps. iPad's Messages tab embeds the same component. */
export default function OfficeThread() {
  const { techId } = useLocalSearchParams<{ techId: string }>();
  return <ThreadView techId={techId} />;
}
