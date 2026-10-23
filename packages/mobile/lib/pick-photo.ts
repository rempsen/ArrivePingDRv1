/**
 * Getting a photo onto a job: ask whether to take one now or use one already
 * on the phone, then run the matching picker (asking for that permission
 * first). Camera and photo library are different iOS permissions, and
 * app.json already carries the usage text for both.
 */
import { Alert, Linking } from "react-native";
import * as ImagePicker from "expo-image-picker";

export type PhotoSource = "camera" | "library";

/** "Take photo" / "Choose from library" sheet; `onPick` gets the choice. */
export function choosePhotoSource(onPick: (source: PhotoSource) => void, title = "Add photo") {
  Alert.alert(title, undefined, [
    { text: "Take photo", onPress: () => onPick("camera") },
    { text: "Choose from library", onPress: () => onPick("library") },
    { text: "Cancel", style: "cancel" },
  ]);
}

/**
 * Open the camera or the photo library for one image. `purpose` finishes the
 * permission message ("Allow camera to attach …"). Resolves to null if the
 * permission is refused or the picker is cancelled.
 */
export async function pickPhoto(
  source: PhotoSource,
  purpose: string,
  opts: Pick<ImagePicker.ImagePickerOptions, "allowsEditing" | "aspect" | "quality"> = {},
): Promise<ImagePicker.ImagePickerAsset | null> {
  const { quality = 0.6, ...rest } = opts;
  // The library opens the system photo picker, which runs out-of-process and
  // needs no permission (and never re-prompts after a past denial). Only the
  // camera needs one.
  if (source === "camera") {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Camera needed", `Allow camera access to ${purpose}.`, [
        { text: "Not now", style: "cancel" },
        { text: "Open Settings", onPress: () => Linking.openSettings() },
      ]);
      return null;
    }
  }
  const result =
    source === "camera"
      ? await ImagePicker.launchCameraAsync({ quality, ...rest })
      : await ImagePicker.launchImageLibraryAsync({ quality, mediaTypes: ["images"], ...rest });
  if (result.canceled || !result.assets?.[0]) return null;
  return result.assets[0];
}
