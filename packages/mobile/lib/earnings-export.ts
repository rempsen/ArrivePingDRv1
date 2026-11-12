/**
 * "Export my earnings": download the CSV from the server (full history, all
 * the companies the tech works for) and hand it to the phone's share sheet.
 */
import Constants from "expo-constants";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { authHeaders } from "./auth";
import { throwIfNotOk } from "./api-error";

const API = (Constants.expoConfig?.extra?.apiUrl as string) ?? process.env.EXPO_PUBLIC_API_URL;

export async function exportEarnings(): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing isn't available on this device.");
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const res = await fetch(`${API}/api/me/earnings/export?tz=${encodeURIComponent(tz)}`, { headers: authHeaders() });
  await throwIfNotOk(res, "Couldn't export your earnings. Check your connection and try again.");
  const csv = await res.text();
  const name = `arriveping-earnings-${new Date().toISOString().slice(0, 10)}.csv`;
  const file = new File(Paths.cache, name);
  file.write(csv);
  await Sharing.shareAsync(file.uri, { mimeType: "text/csv", UTI: "public.comma-separated-values-text", dialogTitle: "Export my earnings" });
}
