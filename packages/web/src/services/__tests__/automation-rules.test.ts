import { describe, it, expect } from "bun:test";
import {
  AUTOMATION_TEMPLATES,
  AUTOMATION_ACTIONS,
  AUTOMATION_TRIGGERS,
  TEMPLATE_BY_KEY,
  actionAssigns,
  draftFromTemplate,
  getPath,
  setPath,
  coerceKnobValue,
} from "../../shared/automation-templates";

// The suite shares one db instance across files and ../automation pulls it
// in. Static imports are hoisted, so the sentinel must be set before a
// dynamic import — same pattern as the other service tests.
process.env.DATABASE_URL = ":memory:";
process.env.DATABASE_AUTH_TOKEN = "";
const { conditionsMatch, pickRoundRobin, zoneFor, startsSoon } = await import("../automation");

describe("conditionsMatch — flat form (backward compatible)", () => {
  it("empty conditions match anything", () => {
    expect(conditionsMatch({}, { priority: "low" })).toBe(true);
  });
  it("scalar equality, blanks ignored", () => {
    expect(conditionsMatch({ priority: "urgent" }, { priority: "urgent" })).toBe(true);
    expect(conditionsMatch({ priority: "urgent" }, { priority: "low" })).toBe(false);
    expect(conditionsMatch({ priority: "" }, { priority: "low" })).toBe(true);
  });
  it("arrays are OR lists; empty array = no filter", () => {
    expect(conditionsMatch({ priority: ["high", "urgent"] }, { priority: "high" })).toBe(true);
    expect(conditionsMatch({ priority: ["high", "urgent"] }, { priority: "low" })).toBe(false);
    expect(conditionsMatch({ priority: [] }, { priority: "low" })).toBe(true);
  });
  it("min*/max* thresholds", () => {
    expect(conditionsMatch({ minMinutes: 30 }, { minutes: 45 })).toBe(true);
    expect(conditionsMatch({ minMinutes: 30 }, { minutes: 10 })).toBe(false);
    expect(conditionsMatch({ maxMinutes: 30 }, { minutes: 10 })).toBe(true);
    expect(conditionsMatch({ maxMinutes: 30 }, { minutes: 45 })).toBe(false);
  });
  it("boolean facts", () => {
    expect(conditionsMatch({ assigned: false }, { assigned: false })).toBe(true);
    expect(conditionsMatch({ assigned: false }, { assigned: true })).toBe(false);
  });
});

describe("conditionsMatch — tree form + hours", () => {
  it("beforeHour / fromHour against hourOfDay", () => {
    expect(conditionsMatch({ beforeHour: 8 }, { hourOfDay: 7 })).toBe(true);
    expect(conditionsMatch({ beforeHour: 8 }, { hourOfDay: 8 })).toBe(false);
    expect(conditionsMatch({ fromHour: 18 }, { hourOfDay: 18 })).toBe(true);
    expect(conditionsMatch({ fromHour: 18 }, { hourOfDay: 17 })).toBe(false);
  });
  it("after-hours template: before 8 OR from 18", () => {
    const cond = TEMPLATE_BY_KEY.after_hours!.conditions;
    expect(conditionsMatch(cond, { hourOfDay: 6 })).toBe(true);
    expect(conditionsMatch(cond, { hourOfDay: 12 })).toBe(false);
    expect(conditionsMatch(cond, { hourOfDay: 21 })).toBe(true);
  });
  it("all / not", () => {
    expect(conditionsMatch({ all: [{ priority: "high" }, { zone: "North" }] }, { priority: "high", zone: "North" })).toBe(true);
    expect(conditionsMatch({ all: [{ priority: "high" }, { zone: "North" }] }, { priority: "high", zone: "South" })).toBe(false);
    expect(conditionsMatch({ not: { priority: "low" } }, { priority: "low" })).toBe(false);
    expect(conditionsMatch({ not: { priority: "low" } }, { priority: "high" })).toBe(true);
  });
  it("tree keys coexist with flat keys", () => {
    expect(conditionsMatch({ priority: "high", any: [{ beforeHour: 8 }] }, { priority: "high", hourOfDay: 7 })).toBe(true);
    expect(conditionsMatch({ priority: "high", any: [{ beforeHour: 8 }] }, { priority: "low", hourOfDay: 7 })).toBe(false);
  });
});

describe("pickRoundRobin", () => {
  const pool = [{ id: "c" }, { id: "a" }, { id: "b" }];
  it("starts at the first id when nothing has gone before", () => {
    expect(pickRoundRobin(pool, undefined)?.id).toBe("a");
  });
  it("rotates and wraps", () => {
    expect(pickRoundRobin(pool, "a")?.id).toBe("b");
    expect(pickRoundRobin(pool, "b")?.id).toBe("c");
    expect(pickRoundRobin(pool, "c")?.id).toBe("a");
  });
  it("skips techs no longer in the pool", () => {
    expect(pickRoundRobin([{ id: "a" }, { id: "c" }], "b")?.id).toBe("c");
  });
  it("empty pool → null", () => {
    expect(pickRoundRobin([], "a")).toBeNull();
  });
});

describe("zoneFor", () => {
  const sq = (id: string, name: string, x: number) =>
    ({
      id,
      name,
      polygon: JSON.stringify([[0, x], [0, x + 1], [1, x + 1], [1, x]]),
      active: true,
      companyId: "t",
      color: "#000",
      surgeMultiplier: 1,
      createdAt: new Date(),
    }) as any;
  const zones = [sq("z1", "West", 0), sq("z2", "East", 1)];
  it("finds the containing zone", () => {
    expect(zoneFor(0.5, 0.5, zones)?.id).toBe("z1");
    expect(zoneFor(0.5, 1.5, zones)?.id).toBe("z2");
  });
  it("null outside every zone or without coordinates", () => {
    expect(zoneFor(5, 5, zones)).toBeNull();
    expect(zoneFor(null, null, zones)).toBeNull();
  });
});

describe("template catalogue", () => {
  const triggers = new Set(AUTOMATION_TRIGGERS.map((t) => t.key as string));
  const actions = new Set(AUTOMATION_ACTIONS.map((a) => a.key as string));
  it("every template uses a known trigger and action", () => {
    for (const t of AUTOMATION_TEMPLATES) {
      expect(triggers.has(t.trigger)).toBe(true);
      expect(actions.has(t.action)).toBe(true);
    }
  });
  it("keys are unique", () => {
    expect(new Set(AUTOMATION_TEMPLATES.map((t) => t.key)).size).toBe(AUTOMATION_TEMPLATES.length);
  });
  it("assigning actions are the four assign_* plus legacy auto_assign", () => {
    expect(actionAssigns("assign_nearest")).toBe(true);
    expect(actionAssigns("assign_round_robin")).toBe(true);
    expect(actionAssigns("auto_assign")).toBe(true);
    expect(actionAssigns("send_sms")).toBe(false);
  });
  it("drafts start disabled and in suggest mode", () => {
    for (const t of AUTOMATION_TEMPLATES) {
      const d = draftFromTemplate(t);
      expect(d.enabled).toBe(false);
      expect(d.mode).toBe("suggest");
      expect(d.templateKey).toBe(t.key);
      // a deep copy — editing the draft must not mutate the catalogue
      d.actionConfig.__x = 1;
      expect((t.actionConfig as any).__x).toBeUndefined();
    }
  });
  it("every knob path resolves inside its template's draft shape", () => {
    for (const t of AUTOMATION_TEMPLATES) {
      const d = draftFromTemplate(t);
      for (const k of t.knobs) {
        expect(k.path.startsWith("conditions.") || k.path.startsWith("actionConfig.")).toBe(true);
        // setting then getting round-trips
        const d2 = setPath(d, k.path, "probe");
        expect(getPath(d2, k.path)).toBe("probe");
      }
    }
  });
});

describe("setPath / getPath / coerceKnobValue", () => {
  it("creates intermediate objects and arrays", () => {
    const d = setPath({ conditions: {} } as any, "conditions.any.1.fromHour", 19);
    expect(d.conditions.any).toEqual([undefined, { fromHour: 19 }]);
    expect(getPath(d, "conditions.any.1.fromHour")).toBe(19);
  });
  it("is immutable", () => {
    const a = { actionConfig: { maxKm: 10 } };
    const b = setPath(a, "actionConfig.maxKm", 20);
    expect(a.actionConfig.maxKm).toBe(10);
    expect(b.actionConfig.maxKm).toBe(20);
  });
  it("coerces numbers, booleans and multiselects", () => {
    expect(coerceKnobValue({ key: "k", label: "", type: "number", path: "" }, "15")).toBe(15);
    expect(coerceKnobValue({ key: "k", label: "", type: "number", path: "" }, "")).toBeUndefined();
    expect(coerceKnobValue({ key: "k", label: "", type: "select", path: "" }, "true")).toBe(true);
    expect(coerceKnobValue({ key: "k", label: "", type: "select", path: "" }, "team")).toBe("team");
    expect(coerceKnobValue({ key: "k", label: "", type: "multiselect", path: "" }, ["a", ""])).toEqual(["a"]);
    expect(coerceKnobValue({ key: "k", label: "", type: "multiselect", path: "" }, [])).toBeUndefined();
  });
});

describe("startsSoon — when live presence matters", () => {
  const now = Date.parse("2026-10-07T12:00:00Z");
  it("a job with no time, or within two hours, needs someone free right now", () => {
    expect(startsSoon({ scheduledAt: null }, now)).toBe(true);
    expect(startsSoon({ scheduledAt: new Date("2026-10-07T13:30:00Z") }, now)).toBe(true);
    expect(startsSoon({ scheduledAt: new Date("2026-10-07T09:00:00Z") }, now)).toBe(true);
  });
  it("tomorrow's job considers the whole active team, offline or not", () => {
    expect(startsSoon({ scheduledAt: new Date("2026-10-08T15:00:00Z") }, now)).toBe(false);
  });
});
