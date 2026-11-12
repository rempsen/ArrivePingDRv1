import { useLocalSearchParams } from "expo-router";
import { ThreadView } from "../../../../components/office/thread-view";
import { FocusOnly } from "../../../../components/office/focus-only";

/** Full-screen thread: phones and push taps. iPad's Messages tab embeds the same component. */
export default function OfficeThread() {
  const { techId } = useLocalSearchParams<{ techId: string }>();
  return (
    <FocusOnly>
      <ThreadView key={techId} techId={techId} />
    </FocusOnly>
  );
}
