/**
 * Phone layout or iPad layout?
 *
 * One decision, made from the window and the device, drives every office
 * screen: on a wide tablet a tab shows a list beside its detail (see
 * components/office/split-screen.tsx); otherwise it shows exactly the phone
 * screen. "Wide" needs both — a phone turned sideways is still a phone, and an
 * iPad squeezed into a narrow Split View column gets the phone layout, which
 * already fits.
 */
export type DeviceKind = "phone" | "tablet" | "unknown";

/** The narrowest window that gets two panes (iPad Split View's wide column is 768+). */
export const WIDE_MIN = 768;
/** The list pane's width when two panes show; the detail takes the rest. */
export const LIST_PANE_W = 380;
/** Today's two-column dashboard needs more room than a list + detail does. */
export const TWO_COLUMN_MIN = 1000;

export function isWideLayout(width: number, device: DeviceKind): boolean {
  return device === "tablet" && width >= WIDE_MIN;
}
