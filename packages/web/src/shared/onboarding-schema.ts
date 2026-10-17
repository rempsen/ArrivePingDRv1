/**
 * Validation for PATCH /api/me/onboarding. Server-only (zod), so the web
 * bundle imports the plain types from ./onboarding instead.
 */
import { z } from "zod";

const CHAPTER_ID = z.string().regex(/^[a-z0-9-]{1,40}$/);

const ChapterProgress = z.object({
  status: z.enum(["completed", "skipped"]),
  at: z.string().datetime(),
  version: z.number().int().min(1).max(999).optional(),
});

export const OnboardingPatchSchema = z
  .object({
    persona: z.enum(["owner", "dispatcher", "manager", "other"]),
    teamSize: z.enum(["1-2", "3-9", "10-29", "30+"]),
    goal: z.enum(["track", "eta", "schedule", "explore"]),
    welcomeDoneAt: z.string().datetime(),
    tours: z.record(CHAPTER_ID, ChapterProgress),
    checklistHidden: z.boolean(),
  })
  .partial()
  .strict();
