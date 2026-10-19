/**
 * The company's email look (colours, logo, theme) as an editable draft.
 * Loaded from the channel settings; saved only when the designer saves, so
 * the Theme tab can be explored freely and Undo/Close throw changes away.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useBrand } from "../../lib/use-brand";
import { EMAIL_SAMPLE_VARS, normalizeTheme, type EmailTheme } from "../../../shared/email/design";
import type { EmailBrand } from "../../../shared/email/render";

export interface BrandDraft {
  brandColor: string;
  bgColor: string;
  logoUrl: string;
  logoHeight: number;
  theme: EmailTheme;
}

const same = (a: BrandDraft | null, b: BrandDraft | null) => JSON.stringify(a) === JSON.stringify(b);

export function useEmailBrand() {
  const qc = useQueryClient();
  const tenant = useBrand();
  const q = useQuery({
    queryKey: ["notif-channels"],
    queryFn: async () => (await api["notif-config"].channels.$get()).json(),
  });
  const row = (q.data as any)?.channels as Record<string, any> | undefined;

  const saved = useMemo<BrandDraft | null>(
    () =>
      row
        ? {
            brandColor: row.emailBrandColor || "#06B6D4",
            bgColor: row.emailBgColor || "#f1f5f9",
            logoUrl: row.emailLogoUrl || "",
            logoHeight: Number(row.emailLogoHeight || 0),
            theme: normalizeTheme(row.emailTheme, row.emailHeaderStyle),
          }
        : null,
    [row],
  );
  const [draft, setDraft] = useState<BrandDraft | null>(null);
  // Follow the saved settings (first load, a refetch after another save)
  // until the person changes something here.
  const lastSaved = useRef<BrandDraft | null>(null);
  useEffect(() => {
    if (!saved) return;
    const prev = lastSaved.current;
    lastSaved.current = saved;
    setDraft((d) => (!d || same(d, prev) ? saved : d));
  }, [saved]);

  const company = (row?.emailFromName as string) || tenant.name || EMAIL_SAMPLE_VARS.company;
  const vars = useMemo(
    () => ({ ...EMAIL_SAMPLE_VARS, company, workerNoun: tenant.noun || "Technician", customerNoun: tenant.customerNoun || "Customer", jobNoun: tenant.jobNoun || "Job" }),
    [company, tenant.noun, tenant.customerNoun, tenant.jobNoun],
  );

  const brand: EmailBrand | null = draft
    ? {
        company,
        logoUrl: draft.logoUrl,
        logoHeight: draft.logoHeight || undefined,
        brandColor: draft.brandColor,
        bgColor: draft.bgColor,
        footer: row?.emailFooter || "",
        origin: typeof window !== "undefined" ? window.location.origin : "",
        theme: draft.theme,
      }
    : null;

  const save = useMutation({
    mutationFn: async (d: BrandDraft) =>
      (
        await api["notif-config"].channels.$patch({
          json: { emailBrandColor: d.brandColor, emailBgColor: d.bgColor, emailLogoUrl: d.logoUrl, emailLogoHeight: d.logoHeight, emailTheme: JSON.stringify(d.theme) },
        })
      ).json(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notif-channels"] }),
  });

  return {
    loading: q.isLoading,
    error: q.isError,
    draft,
    setDraft: (fn: (d: BrandDraft) => BrandDraft) => setDraft((d) => (d ? fn(d) : d)),
    resetDraft: () => setDraft(saved),
    dirty: !!draft && !same(draft, saved),
    brand,
    vars,
    company,
    footer: (row?.emailFooter as string) || "",
    /** Saves the draft when it changed. Resolves false if the save failed. */
    saveIfDirty: async (): Promise<boolean> => {
      if (!draft || same(draft, saved)) return true;
      try {
        const r: any = await save.mutateAsync(draft);
        return !!r?.channels;
      } catch {
        return false;
      }
    },
    saving: save.isPending,
  };
}
