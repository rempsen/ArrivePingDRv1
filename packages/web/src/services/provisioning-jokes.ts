/**
 * PROVISIONING POP-UP — the one humorous, ICP-tailored aside that drops into
 * the staged progress narrative shown while a new tenant is being built
 * (see web/components/provisioning-progress.tsx). Dan's own example, almost
 * verbatim: for a babysitting/childcare signup, "Making sure I have my
 * comfortable shoes for the babysitting job…" — i.e. a one-line, light,
 * trade-specific wink that signals "I actually know your business" rather
 * than a generic loading joke. Keep every line SHORT (under ~70 characters),
 * first person, present-tense, and never punching down at the trade.
 *
 * Deliberately a flat lookup table, not a field on IndustryPreset — this is
 * pure flavor copy with its own editorial voice, nothing else reads it.
 */
export const PROVISIONING_JOKES: Record<string, string> = {
  "home-builder-developer": "Double-checking the blueprints aren't upside down…",
  "painting-decorating": "Taping off the edges so nothing bleeds through…",
  "design-build": "Measuring twice, provisioning once…",
  "renovation-contractor": "Hiding the dust sheets before the big reveal…",
  "flooring": "Making sure everything lines up, seam to seam…",
  "concrete-foundation-repair": "Giving this a minute to cure properly…",
  "garage-door": "Oiling the hinges so this opens smoothly…",
  "electrical": "Flipping the breaker back on… carefully…",
  "exteriors": "Checking the forecast before we go up on the roof…",
  "hvac-plumbing": "Bleeding the lines so nothing's stuck in the pipes…",
  "landscaping-grounds-snow": "Sharpening the blades before the first pass…",
  "tree-care": "Eyeing the canopy for the safest angle…",
  "commercial-building-maintenance": "Doing one more walkthrough before handoff…",
  "property-management-maintenance": "Chasing down the spare key, as always…",
  "equipment-rental": "Topping off the fuel before it goes out the door…",
  "restoration": "Running the dehumidifiers one more cycle…",
  "sports-organization": "Lacing up before the whistle blows…",
  "childcare-babysitting": "Making sure I've got my comfortable shoes for this one…",
  other: "Putting the finishing touches exactly where they belong…",
};

const DEFAULT_JOKE = "Lining everything up just the way you'd do it yourself…";

export function provisioningJoke(industryId: string | null | undefined): string {
  if (!industryId) return DEFAULT_JOKE;
  return PROVISIONING_JOKES[industryId] ?? DEFAULT_JOKE;
}
