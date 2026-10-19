/** Icons and palette groups for Job forms v2 question types (web only). */
import {
  AlignLeft,
  Calendar,
  Camera,
  CheckCheck,
  CircleDot,
  Clock,
  Hash,
  Heading,
  Info,
  ListChecks,
  PenLine,
  ShieldCheck,
  ToggleLeft,
  Type,
  type LucideIcon,
} from "lucide-react";
import type { ItemType } from "../../../shared/forms/form-model";

export const ITEM_ICONS: Record<ItemType, LucideIcon> = {
  section: Heading,
  instructions: Info,
  short_text: Type,
  long_text: AlignLeft,
  number: Hash,
  date: Calendar,
  time: Clock,
  yes_no: ToggleLeft,
  pass_fail: ShieldCheck,
  single_choice: CircleDot,
  multi_choice: CheckCheck,
  checklist: ListChecks,
  photo: Camera,
  signature: PenLine,
};

/** One-line explanation shown in the palette and the inspector. */
export const ITEM_HINTS: Record<ItemType, string> = {
  section: "Groups the questions below it",
  instructions: "Text the tech reads, no answer",
  short_text: "A word or a line",
  long_text: "Notes or a description",
  number: "A reading or a count, with a unit",
  date: "A day",
  time: "A time of day",
  yes_no: "Yes or no",
  pass_fail: "Pass, fail or N/A; a fail is flagged",
  single_choice: "Pick one from a list",
  multi_choice: "Pick any from a list",
  checklist: "Steps to tick off",
  photo: "One or more photos",
  signature: "Customer or technician signs",
};

export const PALETTE_GROUPS: { label: string; types: ItemType[] }[] = [
  { label: "Answers", types: ["short_text", "long_text", "number", "date", "time"] },
  { label: "Checks", types: ["yes_no", "pass_fail", "checklist", "single_choice", "multi_choice"] },
  { label: "Proof", types: ["photo", "signature"] },
  { label: "Layout", types: ["section", "instructions"] },
];
