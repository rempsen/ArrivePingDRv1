/**
 * Keep the old (schema 1) columns filled when the new builder saves, so
 * anything still reading `fields` / `checklist` — older phone builds, the
 * office work-order modal, jobs booked while the Job forms v2 switch is off —
 * keeps working. Web-only (not mirrored to the phone app).
 */
import { isInputItem, type FormDef } from "./form-model";

export interface LegacyField {
  type: "text" | "number" | "checkbox" | "select" | "photo" | "signature" | "date";
  label: string;
  required: boolean;
  options?: string[];
}

export function toLegacy(def: FormDef): { fields: LegacyField[]; checklist: { label: string; required: boolean }[] } {
  const fields: LegacyField[] = [];
  const checklist: { label: string; required: boolean }[] = [];
  for (const it of def.items) {
    if (!isInputItem(it)) continue;
    const required = !!it.required;
    switch (it.type) {
      case "short_text":
      case "long_text":
      case "time":
        fields.push({ type: "text", label: it.label, required });
        break;
      case "number":
        fields.push({ type: "number", label: it.label, required });
        break;
      case "date":
        fields.push({ type: "date", label: it.label, required });
        break;
      case "yes_no":
        fields.push({ type: "select", label: it.label, required, options: ["Yes", "No"] });
        break;
      case "pass_fail":
        fields.push({ type: "select", label: it.label, required, options: ["Pass", "Fail", "N/A"] });
        break;
      case "single_choice":
        fields.push({ type: "select", label: it.label, required, options: it.options ?? [] });
        break;
      case "multi_choice":
        fields.push({ type: "checkbox", label: it.label, required, options: it.options ?? [] });
        break;
      case "checklist":
        for (const o of it.options ?? []) checklist.push({ label: o, required });
        break;
      case "photo":
        fields.push({ type: "photo", label: it.label, required });
        break;
      case "signature":
        fields.push({ type: "signature", label: it.label, required });
        break;
    }
  }
  return { fields, checklist };
}
