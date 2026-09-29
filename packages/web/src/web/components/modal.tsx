import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useDialog } from "../hooks/use-dialog";

/**
 * The app's modal.
 *
 * Accessibility (added in the platform review pass — the dialog previously had
 * none of it) lives in `hooks/use-dialog.ts` so the dozen hand-rolled overlays
 * elsewhere in the app can get identical behaviour: role/aria-modal/labelling,
 * focus into the dialog on open and back to the opener on close, a Tab trap,
 * topmost-only Escape, and a scroll lock.
 *
 * The backdrop is a plain div, not a <button>. A full-screen button is
 * announced as a control and lands in the tab order ahead of the real ones;
 * Escape and the header X are the accessible ways to dismiss.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const { panelRef, dialogProps, titleId } = useDialog({ open, onClose });

  if (!open) return null;
  const maxW =
    size === "sm" ? "max-w-sm" : size === "lg" ? "max-w-2xl" : "max-w-lg";

  return createPortal(
    // z-[1050]: must sit above slide-in side drawers (z-[1000] — Directory's
    // ClientDrawer, Technicians & Managers' detail panel) so opening a work
    // order (or any Modal) from within one of those drawers doesn't render
    // invisibly behind it. Still below the nested modal-over-modal pattern
    // used elsewhere (z-[9999], e.g. a confirm dialog on top of a modal).
    <div className="fixed inset-0 z-[1050] flex items-end justify-center sm:items-center">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        {...dialogProps}
        className={`relative z-10 flex max-h-[92vh] w-full ${maxW} flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-ink-2 shadow-2xl outline-none sm:rounded-2xl`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/5 px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-lg font-bold text-white">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {/*
          touch-pan-y (touch-action: pan-y): on mobile Safari/Chrome the
          content here can end up a hair wider than the panel (a select, a
          long date string, etc.) — without this, that turns into a
          horizontal drag that shifts the whole modal sideways, the same
          class of bug the signature pad's touch-none fixes for drawing.
          pan-y keeps vertical scroll/swipe working and refuses horizontal
          panning outright; overflow-x-hidden clips anything that still
          overflows instead of growing the box.
        */}
        <div className="flex-1 touch-pan-y overflow-x-hidden overflow-y-auto px-5 py-4">
          {children}
        </div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-white/5 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1.5 block text-xs leading-snug text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full min-h-10 rounded-lg border border-white/10 bg-ink-3/60 px-3 py-2 text-sm text-white placeholder:text-slate-500 transition-[border-color,box-shadow] duration-150 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25";

export function BtnPrimary({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="nvc-btn-primary inline-flex h-10 items-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-deep disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function BtnGhost({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="inline-flex h-10 items-center rounded-lg border border-white/10 px-4 text-sm font-medium text-slate-300 transition-colors duration-150 hover:border-white/20 hover:bg-white/5 hover:text-white"
    >
      {children}
    </button>
  );
}

/**
 * A destructive action that lives in a form's own footer (e.g. "Delete Work
 * Order" next to "Save Changes") rather than a confirm dialog's already-red
 * button. Outlined, not solid — a solid red button here would out-rank the
 * actual primary action's visual weight and get mis-tapped as "the button
 * that finishes this form".
 */
export function BtnDanger({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-rose-500/30 px-4 text-sm font-semibold text-rose-400 transition-colors duration-150 hover:border-rose-500/60 hover:bg-rose-500/10 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/** Lightweight confirm dialog */
export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Delete",
  danger = true,
  pending = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  pending?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <BtnGhost onClick={onClose}>Cancel</BtnGhost>
          <button
            onClick={onConfirm}
            disabled={pending}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
              danger ? "bg-red-500 hover:bg-red-600" : "bg-brand hover:bg-brand-deep"
            }`}
          >
            {pending ? "Working…" : confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-sm text-slate-300">{message}</p>
    </Modal>
  );
}
