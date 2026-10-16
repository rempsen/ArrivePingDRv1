import { describe, it, expect } from "bun:test";

// The module imports the tenant db; every suite in this process must point it
// at the in-memory store before that import happens (see other tests here).
process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";
const { nounPairs, retermText, retermDesign, DEFAULT_NOUNS } = await import("../terminology");

const CONSULT = { workerNoun: "Consultant", customerNoun: "Client", jobNoun: "Engagement" };

describe("terminology", () => {
  it("re-terms whole words, keeps case, handles plurals, leaves variables alone", () => {
    const pairs = nounPairs(DEFAULT_NOUNS, CONSULT);
    expect(retermText("Technician: {{techName}}. Your technicians and customers. {{jobNoun}} #12 — new job and 3 jobs", pairs)).toBe(
      "Consultant: {{techName}}. Your consultants and clients. {{jobNoun}} #12 — new engagement and 3 engagements",
    );
    expect(retermText("TECHNICIAN ON THE WAY", pairs)).toBe("CONSULTANT ON THE WAY");
    // not a whole word: "jobsite" stays
    expect(retermText("at the jobsite", pairs)).toBe("at the jobsite");
  });

  it("walks an email design but never rewrites urls or types", () => {
    const design = JSON.stringify([
      { type: "details", rows: [{ label: "Technician", value: "{{techName}}" }] },
      { type: "button", label: "Track your technician", url: "https://x.test/technician" },
    ]);
    const out = JSON.parse(retermDesign(design, nounPairs(DEFAULT_NOUNS, CONSULT)));
    expect(out[0].rows[0].label).toBe("Consultant");
    expect(out[1].label).toBe("Track your consultant");
    expect(out[1].url).toBe("https://x.test/technician");
    expect(out[1].type).toBe("button");
  });

  it("no change when nouns are the same", () => {
    expect(nounPairs(DEFAULT_NOUNS, DEFAULT_NOUNS)).toEqual([]);
  });
});
