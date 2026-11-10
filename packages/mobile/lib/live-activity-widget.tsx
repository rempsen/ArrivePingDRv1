/**
 * The ArrivePing driver Live Activity (Lock Screen banner + Dynamic Island).
 *
 * expo-widgets compiles the function below to a separate JS bundle that runs
 * inside the widget extension, so it must be self-contained: no hooks, no
 * async work and no references to top-level values — keep every constant
 * inline. Only `@expo/ui/swift-ui` components can be rendered.
 *
 * `name` must match the Live Activity name the server targets in APNs pushes
 * (`packages/web/src/services/apns.ts`). Props mirror `LiveActivityProps`.
 */
import { createLiveActivity } from "expo-widgets";
import { HStack, Image, ProgressView, Text, VStack } from "@expo/ui/swift-ui";
import { containerBackground, font, foregroundStyle, padding } from "@expo/ui/swift-ui/modifiers";

export interface LiveActivityProps {
  title: string;
  subtitle: string;
  /** ETA as epoch milliseconds; omitted when unknown. */
  etaEndMs?: number;
  /** 0–1, used when there is no ETA countdown. */
  progress: number;
  /** True once the job is completed — switches the card to the success colour. */
  done: boolean;
}

const ArrivePingActivity = (props: LiveActivityProps) => {
  "widget";

  return {
    banner: (
      <VStack
        alignment="leading"
        spacing={6}
        modifiers={[
          padding({ horizontal: 16, vertical: 14 }),
          containerBackground(props.done ? "#064e3b" : "#070b12", "widget"),
        ]}
      >
        <HStack spacing={8}>
          <Image systemName="location.fill" size={16} color="#0ea5e9" />
          <Text modifiers={[font({ weight: "semibold", size: 17 }), foregroundStyle("#FFFFFF")]}>
            {props.title}
          </Text>
        </HStack>
        <Text modifiers={[font({ size: 13 }), foregroundStyle("#8FA3B8")]}>{props.subtitle}</Text>
        {props.etaEndMs ? (
          <Text
            date={new Date(props.etaEndMs)}
            dateStyle="timer"
            modifiers={[font({ weight: "semibold", size: 15, design: "rounded" }), foregroundStyle("#FFFFFF")]}
          />
        ) : (
          <ProgressView value={props.progress} modifiers={[foregroundStyle("#0ea5e9")]} />
        )}
      </VStack>
    ),
    compactLeading: <Image systemName="location.fill" size={14} color="#0ea5e9" />,
    compactTrailing: props.etaEndMs ? (
      <Text date={new Date(props.etaEndMs)} dateStyle="timer" modifiers={[font({ size: 13 })]} />
    ) : (
      <Text modifiers={[font({ size: 13 })]}>{props.done ? "Done" : "Live"}</Text>
    ),
    minimal: <Image systemName="location.fill" size={14} color="#0ea5e9" />,
    expandedLeading: <Image systemName="location.fill" size={22} color="#0ea5e9" />,
    expandedCenter: (
      <VStack alignment="leading" spacing={2}>
        <Text modifiers={[font({ weight: "semibold", size: 15 })]}>{props.title}</Text>
        <Text modifiers={[font({ size: 12 }), foregroundStyle("#8FA3B8")]}>{props.subtitle}</Text>
      </VStack>
    ),
    expandedTrailing: props.etaEndMs ? (
      <Text date={new Date(props.etaEndMs)} dateStyle="timer" modifiers={[font({ weight: "semibold", size: 15 })]} />
    ) : (
      <Text modifiers={[font({ size: 13 })]}>{props.done ? "Done" : ""}</Text>
    ),
  };
};

export const arrivePingActivity = createLiveActivity<LiveActivityProps>("ArrivePingActivity", ArrivePingActivity);
