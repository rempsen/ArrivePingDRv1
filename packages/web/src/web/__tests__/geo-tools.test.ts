/**
 * The free tools' maths and wording (site/tools/*): what the prerendered pages
 * show and what the browser computes must be the same, and the numbers quoted
 * in the page copy (content/tools.ts) must come from these functions.
 */
import { describe, expect, it } from "bun:test";
import { cleanEta, describeSms, generateTexts, LINK_PLACEHOLDER, OMW_DEFAULTS, OPT_OUT, smsInfo, TONES, TRADES, type OmwInput } from "../site/tools/omw-text";
import { convertUnit, formulaLine, KM_PER_MILE, money, NO_SHOW_DEFAULTS, noShowCost, num } from "../site/tools/no-show";

describe("no-show cost calculator", () => {
  it("prices one wasted trip as loaded time plus vehicle cost", () => {
    // $35 × (40 + 10) ÷ 60 = $29.17 of time; 20 mi × $0.76 = $15.20 of vehicle.
    const r = noShowCost(NO_SHOW_DEFAULTS);
    expect(r.labour).toBe(29.17);
    expect(r.vehicle).toBe(15.2);
    expect(r.perTrip).toBe(44.37);
    expect(r.monthly).toBe(354.93);
    expect(r.yearly).toBe(4259.2);
    // 50 minutes × 8 a month × 12 months = 80 hours.
    expect(r.hoursPerYear).toBe(80);
  });

  it("matches a hand calculation for other inputs", () => {
    const r = noShowCost({ hourlyRate: 60, driveMinutes: 30, onSiteMinutes: 15, distance: 40, unit: "km", vehicleRate: 0.5, perMonth: 3 });
    expect(r.labour).toBe(45);
    expect(r.vehicle).toBe(20);
    expect(r.perTrip).toBe(65);
    expect(r.monthly).toBe(195);
    expect(r.yearly).toBe(2340);
    expect(r.hoursPerYear).toBe(27);
  });

  it("treats blank, negative and non-numeric inputs as zero instead of NaN", () => {
    expect(num("")).toBe(0);
    expect(num("-5")).toBe(0);
    expect(num("abc")).toBe(0);
    expect(num("$1,200")).toBe(1200);
    const r = noShowCost({ ...NO_SHOW_DEFAULTS, hourlyRate: Number.NaN, perMonth: -2 });
    expect(r.labour).toBe(0);
    expect(r.perTrip).toBe(15.2);
    expect(r.monthly).toBe(0);
    expect(r.yearly).toBe(0);
  });

  it("switching units converts distance and rate together, so the cost barely moves", () => {
    const km = convertUnit(NO_SHOW_DEFAULTS, "km");
    expect(km.unit).toBe("km");
    expect(km.distance).toBe(32.2); // 20 mi
    expect(km.vehicleRate).toBe(0.47); // $0.76 / 1.609344
    expect(Math.abs(noShowCost(km).perTrip - noShowCost(NO_SHOW_DEFAULTS).perTrip)).toBeLessThan(0.1);
    const back = convertUnit(km, "mi");
    expect(back.unit).toBe("mi");
    expect(Math.abs(back.distance - 20)).toBeLessThan(0.1);
    expect(convertUnit(NO_SHOW_DEFAULTS, "mi")).toBe(NO_SHOW_DEFAULTS);
    expect(KM_PER_MILE).toBeCloseTo(1.609344, 6);
  });

  it("shows the working with the visitor's numbers", () => {
    expect(formulaLine(NO_SHOW_DEFAULTS)).toBe("$35.00 × (40 + 10) ÷ 60 + $0.76 × 20 mi = $44.37 per wasted trip");
    expect(money(4259.2, 0)).toBe("$4,259");
  });
});

describe("on-my-way text generator", () => {
  it("writes the three default texts the page prerenders", () => {
    const t = generateTexts(OMW_DEFAULTS);
    expect(t.onMyWay).toBe(
      "Hi! Jordan from Prairie Comfort HVAC is on the way and should be there in about 20 minutes. Follow along live: [tracking link] If you can, clear a path to the furnace or AC unit.",
    );
    expect(t.runningLate).toBe(
      "Hi, quick update from Prairie Comfort HVAC: Jordan is running a little behind and should reach you in about 20 minutes. Sorry to keep you waiting. Live status: [tracking link] Reply if that time no longer works.",
    );
    expect(t.arrived).toBe("Hi! Jordan from Prairie Comfort HVAC has arrived for your heating and cooling appointment.");
  });

  it("uses the trade's own words in the professional tone", () => {
    const t = generateTexts({ ...OMW_DEFAULTS, trade: "plumbing", tone: "professional", company: "Bluestem Plumbing", tech: "Sam", eta: 15 });
    expect(t.onMyWay).toBe(
      "Bluestem Plumbing: Your plumber Sam is on the way to your plumbing appointment. Estimated arrival: about 15 minutes. Live tracking: [tracking link]",
    );
    expect(t.arrived).toBe("Bluestem Plumbing: Your plumber Sam has arrived for your plumbing appointment.");
  });

  it("keeps the brief tone short and drops the link and adds the opt-out when asked", () => {
    const t = generateTexts({ ...OMW_DEFAULTS, tone: "brief", link: false, optOut: true, eta: 1 });
    expect(t.onMyWay).toBe(`Prairie Comfort HVAC: Jordan is on the way, ETA 1 min. ${OPT_OUT}`);
    expect(t.runningLate).toBe(`Prairie Comfort HVAC: Running late. Jordan now 1 min away. ${OPT_OUT}`);
    expect(t.arrived).toBe(`Prairie Comfort HVAC: Jordan has arrived. ${OPT_OUT}`);
    for (const s of Object.values(t)) expect(s).not.toContain(LINK_PLACEHOLDER);
  });

  it("says 1 minute, not 1 minutes", () => {
    expect(generateTexts({ ...OMW_DEFAULTS, eta: 1 }).onMyWay).toContain("about 1 minute.");
  });

  it("falls back to placeholders and sane ETAs when fields are blank or odd", () => {
    const t = generateTexts({ ...OMW_DEFAULTS, company: "  ", tech: "\n", eta: Number.NaN });
    expect(t.onMyWay).toContain("[tech name] from [your company]");
    expect(t.onMyWay).toContain("about 20 minutes");
    expect(cleanEta("0")).toBe(OMW_DEFAULTS.eta);
    expect(cleanEta(-3)).toBe(OMW_DEFAULTS.eta);
    expect(cleanEta(12.6)).toBe(13);
    expect(cleanEta(999)).toBe(240);
    // Line breaks and runs of spaces never reach the text.
    expect(generateTexts({ ...OMW_DEFAULTS, company: "Acme\n\n  Heating" }).arrived).toContain("from Acme Heating has");
  });

  it("produces GSM-7 text for every trade and tone, and the brief on-my-way text fits one segment", () => {
    for (const trade of TRADES) {
      for (const tone of TONES) {
        const input: OmwInput = { ...OMW_DEFAULTS, trade: trade.key, tone: tone.key, optOut: true };
        const t = generateTexts(input);
        for (const s of Object.values(t)) {
          expect(s.length).toBeGreaterThan(10);
          expect(smsInfo(s).encoding).toBe("GSM-7");
        }
        if (tone.key === "brief") expect(smsInfo(t.onMyWay).segments).toBe(1);
      }
    }
  });
});

describe("SMS length", () => {
  it("counts GSM-7 at 160 per segment, then 153", () => {
    expect(smsInfo("a".repeat(160))).toEqual({ characters: 160, encoding: "GSM-7", segments: 1, perSegment: 160 });
    expect(smsInfo("a".repeat(161)).segments).toBe(2);
    expect(smsInfo("a".repeat(306)).segments).toBe(2);
    expect(smsInfo("a".repeat(307)).segments).toBe(3);
  });

  it("counts extension characters twice", () => {
    expect(smsInfo("~").characters).toBe(2);
    expect(smsInfo("€{}").characters).toBe(6);
  });

  it("switches to UCS-2 at 70, then 67, for an emoji or a curly quote", () => {
    expect(smsInfo("It’s here").encoding).toBe("UCS-2");
    const withEmoji = `${"a".repeat(68)}🙂`; // the emoji is two UTF-16 units: 70
    expect(smsInfo(withEmoji)).toEqual({ characters: 70, encoding: "UCS-2", segments: 1, perSegment: 70 });
    expect(smsInfo(`${"a".repeat(168)}🙂`).segments).toBe(3); // 170 units / 67
  });

  it("describes the count for the page", () => {
    expect(describeSms("Hello")).toBe("5 characters · 1 SMS segment (GSM-7)");
    expect(describeSms("")).toBe("0 characters · 0 SMS segments (GSM-7)");
  });
});
