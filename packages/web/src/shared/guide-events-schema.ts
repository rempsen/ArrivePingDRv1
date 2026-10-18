/** Validation for POST /api/me/guide-events (server-only; see ./guide-events.ts). */
import { z } from "zod";

const Id = z.string().regex(/^[a-z0-9-]{1,40}$/);

export const GuideEventSchema = z.discriminatedUnion("name", [
  z.object({ name: z.literal("guide.chapter_started"), chapter: Id, source: z.enum(["welcome", "panel", "checklist", "article", "ask", "deeplink"]) }).strict(),
  z.object({ name: z.literal("guide.step_viewed"), chapter: Id, step: Id, index: z.number().int().min(0).max(20) }).strict(),
  z.object({ name: z.literal("guide.step_missing"), chapter: Id, step: Id }).strict(),
  z.object({ name: z.literal("guide.ask_question"), answered: z.boolean(), actions: z.number().int().min(0).max(5) }).strict(),
  z.object({ name: z.literal("guide.ask_action"), type: z.enum(["tour", "page", "article"]) }).strict(),
]);

export const GuideEventsBody = z.object({ events: z.array(GuideEventSchema).min(1).max(30) }).strict();
