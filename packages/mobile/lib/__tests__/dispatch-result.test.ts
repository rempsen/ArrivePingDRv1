import { describe, expect, test } from "bun:test";
import { classifyResponse } from "../dispatch-result";

describe("classifyResponse", () => {
  test("success carries the job and the undo token", () => {
    const r = classifyResponse(200, { job: { id: "j1" }, undo: "tok" });
    expect(r).toEqual({ ok: true, job: { id: "j1" }, undo: "tok", notified: undefined });
  });

  test("a booking create returns booking, not job", () => {
    const r = classifyResponse(201, { booking: { id: "b1" } });
    expect(r.ok && r.job).toEqual({ id: "b1" });
  });

  test("409 forceable keeps the server's message and reason", () => {
    const r = classifyResponse(409, { message: "Sam is on a job until 2:40 PM", forceable: true, reason: "busy" });
    expect(r).toEqual({ ok: false, status: 409, message: "Sam is on a job until 2:40 PM", forceable: true, reason: "busy" });
  });

  test("409 without forceable is a plain refusal", () => {
    const r = classifyResponse(409, { message: "Already assigned to Pat" });
    expect(r).toMatchObject({ ok: false, status: 409, forceable: false });
  });

  test("404 and 403 fall back to readable messages", () => {
    expect(classifyResponse(404, {})).toMatchObject({ ok: false, message: "That job no longer exists.", forceable: false });
    expect(classifyResponse(403, { message: "" })).toMatchObject({ ok: false, message: expect.stringContaining("role") });
  });

  test("a non-JSON body never throws", () => {
    expect(classifyResponse(500, "<html>")).toMatchObject({ ok: false, status: 500 });
  });
});
