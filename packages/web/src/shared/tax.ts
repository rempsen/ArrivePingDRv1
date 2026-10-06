/**
 * Sales-tax lookup. Canada (GST/HST/PST/QST) + US states.
 * Region codes:
 *   Canada provinces: "AB","BC","MB","NB","NL","NS","NT","NU","ON","PE","QC","SK","YT"
 *   US states:        "US-CA","US-NY", ... (prefixed with US-)
 * Combined rate returned as a single % plus a label.
 */

export interface TaxInfo {
  code: string;
  region: string; // display name
  country: "CA" | "US";
  rate: number;   // combined %
  label: string;  // e.g. "HST 13%", "GST 5% + PST 7%"
}

// Canada — combined federal+provincial sales tax
const CA: Record<string, { region: string; rate: number; label: string }> = {
  AB: { region: "Alberta", rate: 5, label: "GST 5%" },
  BC: { region: "British Columbia", rate: 12, label: "GST 5% + PST 7%" },
  MB: { region: "Manitoba", rate: 12, label: "GST 5% + PST 7%" },
  NB: { region: "New Brunswick", rate: 15, label: "HST 15%" },
  NL: { region: "Newfoundland and Labrador", rate: 15, label: "HST 15%" },
  NS: { region: "Nova Scotia", rate: 14, label: "HST 14%" },
  NT: { region: "Northwest Territories", rate: 5, label: "GST 5%" },
  NU: { region: "Nunavut", rate: 5, label: "GST 5%" },
  ON: { region: "Ontario", rate: 13, label: "HST 13%" },
  PE: { region: "Prince Edward Island", rate: 15, label: "HST 15%" },
  QC: { region: "Quebec", rate: 14.975, label: "GST 5% + QST 9.975%" },
  SK: { region: "Saskatchewan", rate: 11, label: "GST 5% + PST 6%" },
  YT: { region: "Yukon", rate: 5, label: "GST 5%" },
};

// US — combined state-level base sales tax (statewide; local rates vary, not included)
const US: Record<string, { region: string; rate: number }> = {
  AL: { region: "Alabama", rate: 4 }, AK: { region: "Alaska", rate: 0 },
  AZ: { region: "Arizona", rate: 5.6 }, AR: { region: "Arkansas", rate: 6.5 },
  CA: { region: "California", rate: 7.25 }, CO: { region: "Colorado", rate: 2.9 },
  CT: { region: "Connecticut", rate: 6.35 }, DE: { region: "Delaware", rate: 0 },
  FL: { region: "Florida", rate: 6 }, GA: { region: "Georgia", rate: 4 },
  HI: { region: "Hawaii", rate: 4 }, ID: { region: "Idaho", rate: 6 },
  IL: { region: "Illinois", rate: 6.25 }, IN: { region: "Indiana", rate: 7 },
  IA: { region: "Iowa", rate: 6 }, KS: { region: "Kansas", rate: 6.5 },
  KY: { region: "Kentucky", rate: 6 }, LA: { region: "Louisiana", rate: 4.45 },
  ME: { region: "Maine", rate: 5.5 }, MD: { region: "Maryland", rate: 6 },
  MA: { region: "Massachusetts", rate: 6.25 }, MI: { region: "Michigan", rate: 6 },
  MN: { region: "Minnesota", rate: 6.875 }, MS: { region: "Mississippi", rate: 7 },
  MO: { region: "Missouri", rate: 4.225 }, MT: { region: "Montana", rate: 0 },
  NE: { region: "Nebraska", rate: 5.5 }, NV: { region: "Nevada", rate: 6.85 },
  NH: { region: "New Hampshire", rate: 0 }, NJ: { region: "New Jersey", rate: 6.625 },
  NM: { region: "New Mexico", rate: 4.875 }, NY: { region: "New York", rate: 4 },
  NC: { region: "North Carolina", rate: 4.75 }, ND: { region: "North Dakota", rate: 5 },
  OH: { region: "Ohio", rate: 5.75 }, OK: { region: "Oklahoma", rate: 4.5 },
  OR: { region: "Oregon", rate: 0 }, PA: { region: "Pennsylvania", rate: 6 },
  RI: { region: "Rhode Island", rate: 7 }, SC: { region: "South Carolina", rate: 6 },
  SD: { region: "South Dakota", rate: 4.2 }, TN: { region: "Tennessee", rate: 7 },
  TX: { region: "Texas", rate: 6.25 }, UT: { region: "Utah", rate: 6.1 },
  VT: { region: "Vermont", rate: 6 }, VA: { region: "Virginia", rate: 5.3 },
  WA: { region: "Washington", rate: 6.5 }, WV: { region: "West Virginia", rate: 6 },
  WI: { region: "Wisconsin", rate: 5 }, WY: { region: "Wyoming", rate: 4 },
  DC: { region: "District of Columbia", rate: 6 },
};

export function lookupTax(code: string | null | undefined): TaxInfo | null {
  if (!code) return null;
  const c = code.trim().toUpperCase();
  if (c.startsWith("US-")) {
    const st = c.slice(3);
    const m = US[st];
    if (!m) return null;
    return { code: c, region: m.region, country: "US", rate: m.rate, label: m.rate ? `Sales tax ${m.rate}%` : "No sales tax" };
  }
  const m = CA[c];
  if (!m) return null;
  return { code: c, region: m.region, country: "CA", rate: m.rate, label: m.label };
}

/** Full ordered list for dropdowns. */
export function taxRegionOptions(): { code: string; label: string; group: string }[] {
  const out: { code: string; label: string; group: string }[] = [];
  for (const [code, v] of Object.entries(CA)) out.push({ code, label: `${v.region} — ${v.label}`, group: "Canada" });
  for (const [st, v] of Object.entries(US)) out.push({ code: `US-${st}`, label: `${v.region} — ${v.rate}%`, group: "United States" });
  return out;
}

/** Best-effort: detect a region code from a free-text address. */
export function regionFromAddress(address: string): string | null {
  if (!address) return null;
  const a = address.toLowerCase();
  // Canadian provinces by name or abbrev
  const caNames: Record<string, string> = {
    alberta: "AB", "british columbia": "BC", manitoba: "MB", "new brunswick": "NB",
    newfoundland: "NL", "nova scotia": "NS", "northwest territories": "NT", nunavut: "NU",
    ontario: "ON", "prince edward": "PE", quebec: "QC", québec: "QC", saskatchewan: "SK", yukon: "YT",
  };
  for (const [name, code] of Object.entries(caNames)) if (a.includes(name)) return code;
  // Major Canadian cities -> province
  const caCities: Record<string, string> = {
    toronto: "ON", ottawa: "ON", mississauga: "ON", brampton: "ON", hamilton: "ON",
    london: "ON", markham: "ON", "richmond hill": "ON", kitchener: "ON", windsor: "ON",
    vancouver: "BC", surrey: "BC", burnaby: "BC", victoria: "BC", richmond: "BC", kelowna: "BC",
    calgary: "AB", edmonton: "AB", "red deer": "AB", lethbridge: "AB",
    montreal: "QC", montréal: "QC", laval: "QC", gatineau: "QC", "quebec city": "QC",
    winnipeg: "MB", regina: "SK", saskatoon: "SK", halifax: "NS", "st. john's": "NL",
    fredericton: "NB", moncton: "NB", charlottetown: "PE", whitehorse: "YT", yellowknife: "NT",
  };
  for (const [city, code] of Object.entries(caCities)) if (a.includes(city)) return code;
  const caAbbr = a.match(/\b(ab|bc|mb|nb|nl|ns|nt|nu|on|pe|qc|sk|yt)\b/);
  if (caAbbr && /canada|,\s*(ab|bc|mb|nb|nl|ns|nt|nu|on|pe|qc|sk|yt)\b/.test(a)) return caAbbr[1]!.toUpperCase();
  // US states by abbrev
  const usAbbr = a.match(/\b([a-z]{2})\b\s*\d{5}/); // "NY 10001"
  if (usAbbr) {
    const st = usAbbr[1]!.toUpperCase();
    if (US[st]) return `US-${st}`;
  }
  return null;
}
