/**
 * Where a tapped notification lands, by which half of the app is open.
 * Pure (no react-native) so bun can test it. Field routes are unchanged
 * from before office mode existed.
 */
export type PushData = { type?: string; event?: string; bookingId?: string; techId?: string } & Record<string, unknown>;

export function routeForNotification(data: PushData | undefined, mode: "field" | "office"): string | null {
  if (!data) return null;
  if (mode === "office") {
    if (data.type === "tech_message" && data.techId) return `/office/thread/${data.techId}`;
    if (data.bookingId) return `/office/job/${data.bookingId}`;
    if (data.type === "direct_message" || data.type === "broadcast_message" || data.type === "tech_message") return "/(office)/messages";
    return null;
  }
  // A new offer opens its details, where the tech can accept or decline.
  if (data.bookingId && data.event === "assigned") return `/offer/${encodeURIComponent(data.bookingId)}`;
  if (data.bookingId) return `/job/${data.bookingId}`;
  if (data.type === "direct_message" || data.type === "broadcast_message") return "/(rider)/messages";
  return null;
}
