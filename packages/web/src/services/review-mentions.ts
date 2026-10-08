/**
 * Google reviews → staff first names (scrape audit item F.2).
 *
 * Most trade websites never name their crews, so the "people found on your
 * website" list is usually empty. Their Google Business Profile reviews, on
 * the other hand, are full of "Mike was on time", "ask for Sarah". When
 * GOOGLE_MAPS_API_KEY is set we look the business up once (Places API (New)
 * Text Search, which can return up to 5 reviews inline) and pull the first
 * names customers praise. These are prompts for the onboarding concierge —
 * "your reviews mention Mike and Sarah, are they on the team?" — never
 * roster entries by themselves.
 *
 * Entirely optional and best-effort: no key, no match, or any error → null.
 */

const KEY = process.env.GOOGLE_MAPS_API_KEY;
const TIMEOUT_MS = 6_000;

import { log } from "../api/lib/logger";

export interface ReviewMentions {
  placeId: string;
  displayName: string;
  googleMapsUri: string | null;
  /** Direct "write a review" link — what Settings → Reviews wants. */
  writeReviewUrl: string;
  rating: number | null;
  userRatingCount: number | null;
  reviewCount: number;
  /** First names praised in the review text, most frequent first. */
  mentionedStaff: string[];
}

export function googlePlacesAvailable(): boolean {
  return Boolean(KEY);
}

/** Words that look like names but never are, in review prose. */
const STOP = new Set(
  [
    // sentence starters / pronouns / common capitalised words
    "i", "we", "he", "she", "it", "they", "you", "my", "our", "the", "this", "that", "these", "those", "a", "an",
    "great", "highly", "very", "thank", "thanks", "would", "will", "also", "after", "even", "then", "when", "what",
    "if", "so", "but", "and", "or", "not", "no", "yes", "all", "both", "every", "had", "have", "has", "was", "were",
    "did", "do", "does", "got", "get", "went", "came", "called", "call", "called", "service", "services", "company",
    "team", "crew", "staff", "guys", "guy", "tech", "technician", "technicians", "plumber", "plumbers", "electrician",
    "owner", "office", "customer", "customers", "job", "work", "price", "quote", "estimate", "amazing", "awesome",
    "excellent", "fantastic", "professional", "friendly", "fast", "quick", "honest", "fair", "recommend", "recommended",
    "definitely", "absolutely", "overall", "first", "second", "last", "next", "today", "yesterday", "tomorrow",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
    "google", "facebook", "yelp", "canada", "usa", "ontario", "manitoba", "alberta", "winnipeg", "toronto", "calgary",
    "edmonton", "vancouver", "regina", "saskatoon", "hvac", "ac", "furnace", "roof", "plumbing", "electrical",
    "lennox", "carrier", "trane", "goodman", "rheem", "bosch", "kohler", "moen", "delta",
    "god", "lord", "mr", "mrs", "ms", "dr",
  ].map((w) => w.toLowerCase()),
);

const NAME = "([A-Z][a-z]{2,14})";
// "Mike was", "Mike did", "Mike and his", "Mike showed up"
const AFTER = new RegExp(`\\b${NAME}\\s+(?:was|is|did|came|arrived|showed|fixed|installed|explained|diagnosed|repaired|replaced|took|went|made|had|knew|got|and\\s+(?:his|her|the)\\s+(?:team|crew|partner|apprentice|helper))\\b`, "g");
// "thanks Mike", "thank you Mike", "ask for Mike", "shout out to Mike", "technician Mike", "our tech Mike"
const BEFORE = new RegExp(`\\b(?:thanks?(?:\\s+you)?(?:\\s+to)?|ask\\s+for|shout\\s*out\\s+to|kudos\\s+to|tech(?:nician)?|plumber|electrician|installer|driver|owner|dispatcher)\\s+${NAME}\\b`, "gi");

/** Pull likely staff first names out of free-text reviews. Exported for tests. */
export function extractMentionedNames(texts: string[], exclude: string[] = []): string[] {
  const counts = new Map<string, number>();
  const skip = new Set([...STOP, ...exclude.map((w) => w.toLowerCase())]);
  const bump = (raw: string) => {
    const n = raw.trim();
    const key = n.toLowerCase();
    if (!/^[A-Z][a-z]{2,14}$/.test(n) || skip.has(key)) return;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  for (const text of texts) {
    if (!text) continue;
    for (const m of text.matchAll(AFTER)) bump(m[1]!);
    for (const m of text.matchAll(BEFORE)) {
      // case-insensitive regex — the name group must still be capitalised in source
      const cand = m[1]!;
      if (/^[A-Z]/.test(cand)) bump(cand);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k.charAt(0).toUpperCase() + k.slice(1))
    .slice(0, 8);
}

function hostOf(u: string | null | undefined): string {
  if (!u) return "";
  try {
    return new URL(u.startsWith("http") ? u : `https://${u}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Look the business up and read its Google reviews. `name` + `address` (or
 * at least a city in `area`) make up the query; `website` is used to confirm
 * we matched the right listing when Google returns several.
 */
export async function fetchGoogleReviewMentions(input: {
  name: string;
  address?: string | null;
  area?: string | null;
  website?: string | null;
}): Promise<ReviewMentions | null> {
  if (!KEY) return null;
  const name = (input.name || "").trim();
  if (!name) return null;
  const locality = (input.address || input.area || "").trim();
  const textQuery = locality ? `${name} ${locality}` : name;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": KEY,
        "X-Goog-FieldMask": "places.id,places.displayName,places.websiteUri,places.googleMapsUri,places.rating,places.userRatingCount,places.reviews",
      },
      body: JSON.stringify({ textQuery, maxResultCount: 3, languageCode: "en" }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const msg = body.match(/"message":\s*"([^"]{0,200})/)?.[1] ?? "";
      log.warn("review-mentions: Places API error", { status: res.status, msg });
      return null;
    }
    const data = (await res.json()) as { places?: any[] };
    const places = Array.isArray(data.places) ? data.places : [];
    if (!places.length) return null;
    const wantHost = hostOf(input.website);
    const place =
      (wantHost ? places.find((p) => hostOf(p?.websiteUri) === wantHost) : null) ??
      places.find((p) => String(p?.displayName?.text ?? "").toLowerCase().includes(name.toLowerCase().split(/\s+/)[0] ?? "")) ??
      places[0];
    if (!place?.id) return null;
    const reviews: string[] = (Array.isArray(place.reviews) ? place.reviews : [])
      .map((r: any) => String(r?.text?.text ?? r?.originalText?.text ?? "").trim())
      .filter(Boolean);
    const exclude = name.split(/\s+/);
    return {
      placeId: String(place.id),
      displayName: String(place.displayName?.text ?? name),
      googleMapsUri: place.googleMapsUri ? String(place.googleMapsUri) : null,
      writeReviewUrl: `https://search.google.com/local/writereview?placeid=${encodeURIComponent(String(place.id))}`,
      rating: typeof place.rating === "number" ? place.rating : null,
      userRatingCount: typeof place.userRatingCount === "number" ? place.userRatingCount : null,
      reviewCount: reviews.length,
      mentionedStaff: extractMentionedNames(reviews, exclude),
    };
  } catch (e) {
    log.warn("review-mentions: Places lookup failed", { err: String(e) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
