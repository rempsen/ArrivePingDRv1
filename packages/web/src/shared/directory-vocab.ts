/**
 * The Directory's words for places, per tenant (Dan, 2026-10-19).
 *
 * Grouping people by a named place (a property and its units, a community
 * and its lots, a building and its suites, a team) is how some industries
 * work and not others. A property manager sorts residents by property; an
 * HVAC or plumbing company has customers, and "Property / Unit / Property
 * Manager" columns would be someone else's vocabulary.
 *
 * So the place layer (the Properties tab, its columns, filters, grouping,
 * "Assign to …", the import columns and the AI search's place questions)
 * is on, and named in the tenant's words, when:
 *   - the company's industry (ICP preset `places`) works by place, or
 *   - its own words for the people it serves say so (Residents, Tenants), or
 *   - it already has named places (never hide data someone entered), or
 *   - an admin turned it on in Settings (mode "on").
 * Mode "off" hides it whatever the industry. People's tabs already use the
 * tenant's nouns (workerNoun / customerNoun) everywhere.
 */

/** How one industry names its places. `unit` null = its places have no units (a team). */
export interface PlaceVocab {
  place: string;
  places: string;
  unit: string | null;
  units: string | null;
  /** The team member responsible for a place. */
  manager: string;
}

export type DirectoryPlacesMode = "auto" | "on" | "off";
export const DIRECTORY_PLACES_MODES: readonly DirectoryPlacesMode[] = ["auto", "on", "off"];

export function parsePlacesMode(v: unknown): DirectoryPlacesMode {
  return v === "on" || v === "off" ? v : "auto";
}

export interface DirectoryVocab extends PlaceVocab {
  /** Show the place layer at all. */
  enabled: boolean;
  /** Why it's on or off, for Settings. */
  reason: "industry" | "nouns" | "data" | "setting-on" | "setting-off" | "not-used";
}

/** Property management: residents or tenants in units, a property manager per property. */
export const PROPERTY_PLACES: PlaceVocab = { place: "Property", places: "Properties", unit: "Unit", units: "Units", manager: "Property Manager" };
/** What a tenant gets when it turns places on and its industry has no words of its own. */
export const GENERIC_PLACES: PlaceVocab = { place: "Site", places: "Sites", unit: "Unit", units: "Units", manager: "Account Manager" };

/** Words for the people a company serves that mean they live in units at a property. */
const RESIDENTIAL_CUSTOMER = /^(residents?|tenants?|occupants?|unit owners?|condo owners?|strata owners?|renters?)$/i;

export function resolveDirectoryVocab(input: {
  /** The industry preset's place words (undefined/null when the industry doesn't work by place). */
  industryPlaces?: PlaceVocab | null;
  customerNoun?: string | null;
  workerNoun?: string | null;
  mode?: DirectoryPlacesMode | string | null;
  /** The company already has named places. */
  hasPlaces?: boolean;
}): DirectoryVocab {
  const mode = parsePlacesMode(input.mode);
  const byNouns = RESIDENTIAL_CUSTOMER.test((input.customerNoun ?? "").trim()) || /property manager/i.test(input.workerNoun ?? "");
  const words = input.industryPlaces ?? (byNouns ? PROPERTY_PLACES : GENERIC_PLACES);
  if (mode === "off") return { ...words, enabled: false, reason: "setting-off" };
  if (mode === "on") return { ...words, enabled: true, reason: "setting-on" };
  if (input.industryPlaces) return { ...words, enabled: true, reason: "industry" };
  if (byNouns) return { ...words, enabled: true, reason: "nouns" };
  if (input.hasPlaces) return { ...words, enabled: true, reason: "data" };
  return { ...words, enabled: false, reason: "not-used" };
}

/** "Property Manager" → "Property Managers", "Coach" → "Coaches". */
export function pluralOf(word: string): string {
  if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + "ies";
  if (/(s|x|z|ch|sh)$/i.test(word)) return word + "es";
  return word + "s";
}

/** Lower-case a label for use mid-sentence ("Property Manager" → "property manager"). */
export const lc = (s: string) => s.toLowerCase();

/** "a property", "an account manager". */
export function aWord(s: string): string {
  return `${/^[aeiou]/i.test(s) ? "an" : "a"} ${lc(s)}`;
}
