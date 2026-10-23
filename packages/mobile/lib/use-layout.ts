import { useWindowDimensions } from "react-native";
import * as Device from "expo-device";
import { isWideLayout, type DeviceKind } from "./layout";

function deviceKind(): DeviceKind {
  if (Device.deviceType === Device.DeviceType.TABLET) return "tablet";
  if (Device.deviceType === Device.DeviceType.PHONE) return "phone";
  return "unknown";
}

/**
 * The live layout decision for office screens. Re-renders on rotation and on
 * iPad Split View resizes, since both change the window.
 */
export function useLayout() {
  const { width, height } = useWindowDimensions();
  return { wide: isWideLayout(width, deviceKind()), width, height, landscape: width > height };
}
