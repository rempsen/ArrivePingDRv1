import { useEffect, useRef } from "react";
import type { PendingClash, Toast } from "./use-assign";

/** The one-sentence clash card: stops a drop only when something is wrong. */
export function ClashCard({ clash, onConfirm, onCancel }: { clash: PendingClash; onConfirm(): void; onCancel(): void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancel.current?.focus();
  }, []);
  return (
    <div className="ap-clash ap-glass" role="alertdialog" aria-label="Assignment warning">
      <p className="ap-clash__text">
        {clash.message} <strong>Assign anyway?</strong>
      </p>
      <div className="ap-clash__actions">
        <button type="button" className="ap-btn" ref={cancel} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="ap-btn ap-btn--primary" onClick={onConfirm}>
          Assign anyway
        </button>
      </div>
    </div>
  );
}

export function UndoToast({ toast, onUndo, onClose }: { toast: Toast; onUndo(): void; onClose(): void }) {
  return (
    <output className="ap-toast ap-glass" data-tone={toast.tone} key={toast.id}>
      <span>{toast.text}</span>
      {toast.undo && (
        <button type="button" className="ap-btn ap-btn--link" onClick={onUndo}>
          Undo
        </button>
      )}
      <button type="button" className="ap-btn ap-btn--icon" aria-label="Dismiss" onClick={onClose}>
        ×
      </button>
    </output>
  );
}

/** Screen-reader announcements for drops, clashes and undo. */
export function Announcer({ text }: { text: string }) {
  return (
    <div className="ap-sr" aria-live="polite" aria-atomic="true">
      {text}
    </div>
  );
}
