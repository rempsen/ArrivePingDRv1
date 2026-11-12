import { describe, expect, test } from "bun:test";
import { backoffMs, initialStreamState, isLive, streamReducer } from "../stream-state";

describe("streamReducer", () => {
  test("two errors in a row mark the stream down", () => {
    const s1 = streamReducer(initialStreamState, "error");
    expect(s1).toEqual({ status: "idle", failures: 1 });
    const s2 = streamReducer(s1, "error");
    expect(s2).toEqual({ status: "down", failures: 2 });
  });

  test("an open connection clears the failure count", () => {
    const down = streamReducer(streamReducer(initialStreamState, "error"), "error");
    expect(streamReducer(down, "open")).toEqual({ status: "open", failures: 0 });
  });

  test("closing a healthy stream goes idle; closing a down stream stays down", () => {
    expect(streamReducer({ status: "open", failures: 0 }, "close")).toEqual({ status: "idle", failures: 0 });
    expect(streamReducer({ status: "down", failures: 3 }, "close")).toEqual({ status: "down", failures: 3 });
  });

  test("reset returns to the initial state", () => {
    expect(streamReducer({ status: "down", failures: 5 }, "reset")).toEqual(initialStreamState);
  });

  test("backoff doubles and caps", () => {
    expect(backoffMs(1)).toBe(1_000);
    expect(backoffMs(2)).toBe(2_000);
    expect(backoffMs(4)).toBe(8_000);
    expect(backoffMs(10)).toBe(30_000);
  });
});

describe("isLive", () => {
  test("only an open stream counts as live", () => {
    expect(isLive(streamReducer(initialStreamState, "open"))).toBe(true);
  });

  test("connecting, retrying, closed and down are not live", () => {
    expect(isLive(initialStreamState)).toBe(false);
    const oneFail = streamReducer(initialStreamState, "error");
    expect(isLive(oneFail)).toBe(false);
    expect(isLive(streamReducer(oneFail, "error"))).toBe(false);
    expect(isLive(streamReducer(streamReducer(initialStreamState, "open"), "close"))).toBe(false);
  });
});
