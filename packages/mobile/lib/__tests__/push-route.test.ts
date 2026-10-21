import { describe, expect, test } from "bun:test";
import { routeForNotification } from "../push-route";

describe("routeForNotification", () => {
  test("field routes are unchanged", () => {
    expect(routeForNotification({ bookingId: "b1", type: "assigned" }, "field")).toBe("/job/b1");
    expect(routeForNotification({ type: "direct_message", techId: "t1" }, "field")).toBe("/(rider)/messages");
    expect(routeForNotification({ type: "something_else" }, "field")).toBeNull();
    expect(routeForNotification(undefined, "field")).toBeNull();
  });

  test("office routes open the job or the tech's thread", () => {
    expect(routeForNotification({ bookingId: "b1", type: "created" }, "office")).toBe("/office/job/b1");
    expect(routeForNotification({ type: "tech_message", techId: "t1" }, "office")).toBe("/office/thread/t1");
    expect(routeForNotification({ type: "tech_message" }, "office")).toBe("/(office)/messages");
    expect(routeForNotification({ type: "unknown" }, "office")).toBeNull();
  });
});
