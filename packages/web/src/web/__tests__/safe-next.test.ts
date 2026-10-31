/**
 * SIGN-IN ?next=
 *   Only a same-site relative path is honoured; anything that could leave the
 *   site (scheme, protocol-relative, backslash tricks, stripped whitespace)
 *   falls back to null so the caller uses the role's home page.
 */
import { describe, it, expect } from "bun:test";
import { safeNextPath, nextFromSearch } from "../lib/safe-next";

describe("safeNextPath", () => {
  it("accepts same-site paths, keeping query and hash", () => {
    expect(safeNextPath("/join-company/abc-123")).toBe("/join-company/abc-123");
    expect(safeNextPath("/admin/jobs?open=j1#notes")).toBe("/admin/jobs?open=j1#notes");
    expect(safeNextPath("/")).toBe("/");
  });

  it("rejects empty and missing values", () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath("")).toBeNull();
  });

  it("rejects absolute URLs and schemes", () => {
    expect(safeNextPath("https://evil.example/x")).toBeNull();
    expect(safeNextPath("http:/evil.example")).toBeNull();
    expect(safeNextPath("javascript:alert(1)")).toBeNull();
    expect(safeNextPath("data:text/html,hi")).toBeNull();
    expect(safeNextPath("join-company/abc")).toBeNull();
  });

  it("rejects protocol-relative and backslash forms", () => {
    expect(safeNextPath("//evil.example")).toBeNull();
    expect(safeNextPath("///evil.example")).toBeNull();
    expect(safeNextPath("/\\evil.example")).toBeNull();
    expect(safeNextPath("\\\\evil.example")).toBeNull();
    expect(safeNextPath("/foo\\bar")).toBeNull();
  });

  it("rejects whitespace and control characters browsers would strip", () => {
    expect(safeNextPath("/\t/evil.example")).toBeNull();
    expect(safeNextPath("/\n/evil.example")).toBeNull();
    expect(safeNextPath(" /admin")).toBeNull();
    expect(safeNextPath("/admin\u0000")).toBeNull();
  });

  it("rejects absurdly long values", () => {
    expect(safeNextPath("/" + "a".repeat(3000))).toBeNull();
  });
});

describe("nextFromSearch", () => {
  it("reads and decodes ?next", () => {
    expect(nextFromSearch(`?next=${encodeURIComponent("/join-company/m1")}`)).toBe("/join-company/m1");
  });
  it("drops an unsafe ?next", () => {
    expect(nextFromSearch(`?next=${encodeURIComponent("//evil.example")}`)).toBeNull();
    expect(nextFromSearch("?next=https%3A%2F%2Fevil.example")).toBeNull();
  });
  it("returns null with no ?next", () => {
    expect(nextFromSearch("")).toBeNull();
    expect(nextFromSearch("?foo=1")).toBeNull();
  });
});
