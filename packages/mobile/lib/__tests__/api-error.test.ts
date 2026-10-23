import { describe, expect, test } from "bun:test";
import { apiErrorMessage, messageFromBody } from "../api-error";

const res = (status: number, body?: unknown) =>
  new Response(body === undefined ? "not json" : JSON.stringify(body), { status });

describe("api error messages", () => {
  test("reads both server error shapes", () => {
    expect(messageFromBody({ message: "Forbidden" })).toBe("Forbidden");
    expect(messageFromBody({ error: { code: "not_found", message: "Not found" } })).toBe("Not found");
    expect(messageFromBody(null)).toBeNull();
    expect(messageFromBody({ message: "" })).toBeNull();
  });

  test("falls back when the body has no message", async () => {
    expect(await apiErrorMessage(res(500), "Couldn't delete it")).toBe("Couldn't delete it");
    expect(await apiErrorMessage(res(404, {}), "Couldn't delete it")).toBe("Couldn't delete it");
  });

  test("prefers the server's message, and prompts sign-in on a bare 401", async () => {
    expect(await apiErrorMessage(res(404, { error: { message: "Not found" } }), "x")).toBe("Not found");
    expect(await apiErrorMessage(res(401), "x")).toContain("signed out");
  });
});
