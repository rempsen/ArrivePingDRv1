import { describe, expect, it } from "bun:test";
import { signatureKey } from "../signatures";

const job = "job-1";

describe("signatureKey", () => {
  it("reads the key out of each kind of url", () => {
    expect(signatureKey("/api/public/file/signatures%2Fjob-1%2Fa-b.svg", job)).toBe("signatures/job-1/a-b.svg");
    expect(signatureKey("https://cdn.example.com/signatures/job-1/a-b.svg?x=1", job)).toBe("signatures/job-1/a-b.svg");
    expect(signatureKey("/uploads/signatures_job-1_a-b.svg", job)).toBe("signatures/job-1/a-b.svg");
  });
  it("only ever names this job's signature folder", () => {
    expect(signatureKey("/api/public/file/signatures%2Fjob-2%2Fa.svg", job)).toBeNull();
    expect(signatureKey("/api/public/file/avatars%2Fme.png", job)).toBeNull();
    expect(signatureKey("/api/public/file/signatures%2Fjob-1%2F..%2Fjob-2%2Fa.svg", job)).toBeNull();
    expect(signatureKey("/api/public/file/signatures%2Fjob-1%2F", job)).toBeNull();
    expect(signatureKey("/uploads/signatures_job-2_a.svg", job)).toBeNull();
  });
  it("is null with no url", () => {
    expect(signatureKey("", job)).toBeNull();
    expect(signatureKey(undefined, job)).toBeNull();
  });
});
