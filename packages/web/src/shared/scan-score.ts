/**
 * Scoring a website scan, so "is the scan good?" is a number that can be
 * tracked instead of an impression from the last signup someone watched.
 *
 * Pure: takes what the scan returned (and, optionally, what we know to be
 * true about the site) and returns points per area with the reasons. Used by
 * the reference-set runner (tools/scan-eval.ts).
 */

/** The parts of a scan result the score reads (brand-scout's BrandProposal has all of them). */
export interface ScoredScan {
  scan?: { status?: string; via?: string | null; pagesRead?: number } | null;
  companyName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  description?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
  suggestedIndustry?: string | null;
  suggestedIndustryOther?: string | null;
  services?: string[] | null;
  pages?: unknown[] | null;
}

/** What a person has confirmed about the site. Every field is optional. */
export interface SiteTruth {
  name?: string;
  phone?: string;
  industry?: string;
  /** Services the site clearly offers; each is matched loosely against what the scan listed. */
  services?: string[];
}

export type ScoreArea = "read" | "identity" | "brand" | "industry" | "services" | "depth";
export const AREA_MAX: Record<ScoreArea, number> = { read: 20, identity: 25, brand: 10, industry: 15, services: 20, depth: 10 };
export const AREA_LABEL: Record<ScoreArea, string> = {
  read: "Site was read",
  identity: "Name and contact details",
  brand: "Logo and colour",
  industry: "Industry",
  services: "Services",
  depth: "Pages read",
};

export interface ScanScore {
  total: number;
  grade: "excellent" | "good" | "thin" | "poor";
  areas: Record<ScoreArea, number>;
  /** What cost points, in plain words. */
  missing: string[];
}

/** The colour the scan falls back to when it finds none. */
const DEFAULT_COLOR = "#06b6d4";
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, " ").trim();
const digits = (s: string) => s.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
const has = (v: unknown) => typeof v === "string" && v.trim().length > 0;

export function scoreScan(p: ScoredScan, truth: SiteTruth = {}): ScanScore {
  const areas: Record<ScoreArea, number> = { read: 0, identity: 0, brand: 0, industry: 0, services: 0, depth: 0 };
  const missing: string[] = [];
  const status = p.scan?.status ?? "";

  // Read
  if (status === "ok") areas.read = 20;
  else if (status === "partial") {
    areas.read = 10;
    missing.push("the site was read but had little on it");
  } else missing.push(`the site was not read (${status || "no result"})`);

  // Identity: name 10, phone 5, email 3, address 4, description 3
  if (has(p.companyName)) {
    if (truth.name && !norm(p.companyName!).includes(norm(truth.name)) && !norm(truth.name).includes(norm(p.companyName!))) {
      areas.identity += 3;
      missing.push(`name is "${p.companyName}", expected "${truth.name}"`);
    } else areas.identity += 10;
  } else missing.push("no company name");
  if (has(p.phone)) {
    if (truth.phone && digits(p.phone!) !== digits(truth.phone)) missing.push(`phone is ${p.phone}, expected ${truth.phone}`);
    else areas.identity += 5;
  } else missing.push("no phone");
  if (has(p.email)) areas.identity += 3;
  else missing.push("no email");
  if (has(p.address)) areas.identity += 4;
  else missing.push("no address");
  if (has(p.description)) areas.identity += 3;
  else missing.push("no description");

  // Brand
  if (has(p.logoUrl)) areas.brand += 5;
  else missing.push("no logo");
  if (has(p.primaryColor) && p.primaryColor!.toLowerCase() !== DEFAULT_COLOR) areas.brand += 5;
  else missing.push("no brand colour");

  // Industry
  const ind = (p.suggestedIndustry ?? "").trim();
  if (truth.industry) {
    if (ind === truth.industry) areas.industry = 15;
    else missing.push(`industry is "${ind || "none"}", expected "${truth.industry}"`);
  } else if (ind && ind !== "other") areas.industry = 15;
  else if (ind === "other" && has(p.suggestedIndustryOther)) {
    areas.industry = 7;
    missing.push(`no industry matched ("${p.suggestedIndustryOther}")`);
  } else missing.push("no industry suggested");

  // Services
  const services = (p.services ?? []).filter(has);
  if (truth.services?.length) {
    const got = services.map(norm);
    const found = truth.services.filter((want) => {
      const w = norm(want);
      return got.some((g) => g.includes(w) || w.includes(g));
    });
    areas.services = Math.round((found.length / truth.services.length) * 20);
    const lost = truth.services.filter((s) => !found.includes(s));
    if (lost.length) missing.push(`services not found: ${lost.join(", ")}`);
  } else {
    areas.services = services.length >= 8 ? 20 : services.length >= 5 ? 15 : services.length >= 3 ? 10 : services.length >= 1 ? 5 : 0;
    if (services.length < 8) missing.push(services.length ? `only ${services.length} service${services.length === 1 ? "" : "s"} found` : "no services found");
  }

  // Depth
  const pages = p.pages?.length ?? p.scan?.pagesRead ?? 0;
  areas.depth = pages >= 5 ? 10 : pages >= 3 ? 6 : pages >= 1 ? 3 : 0;
  if (pages < 5) missing.push(pages ? `only ${pages} page${pages === 1 ? "" : "s"} read` : "no pages read");

  const total = Object.values(areas).reduce((a, b) => a + b, 0);
  const grade = total >= 85 ? "excellent" : total >= 70 ? "good" : total >= 50 ? "thin" : "poor";
  return { total, grade, areas, missing };
}

export interface SetSummary {
  sites: number;
  average: number;
  /** Share of sites that were read at all, 0 to 100. */
  readPct: number;
  byGrade: Record<ScanScore["grade"], number>;
  /** Average points lost per area, biggest first: where the scan is weakest. */
  weakest: { area: ScoreArea; lostPct: number }[];
}

export function summarizeSet(scores: ScanScore[]): SetSummary {
  const n = scores.length;
  const byGrade: SetSummary["byGrade"] = { excellent: 0, good: 0, thin: 0, poor: 0 };
  for (const s of scores) byGrade[s.grade]++;
  const weakest = (Object.keys(AREA_MAX) as ScoreArea[])
    .map((area) => ({ area, lostPct: n ? Math.round((1 - scores.reduce((a, s) => a + s.areas[area], 0) / (n * AREA_MAX[area])) * 100) : 0 }))
    .sort((a, b) => b.lostPct - a.lostPct);
  return {
    sites: n,
    average: n ? Math.round(scores.reduce((a, s) => a + s.total, 0) / n) : 0,
    readPct: n ? Math.round((scores.filter((s) => s.areas.read > 0).length / n) * 100) : 0,
    byGrade,
    weakest,
  };
}
