"use client";

import { Dialog } from "./dialog";

/**
 * A yes/no confirmation built on the existing hardened `Dialog` — added in
 * Phase E to replace native `window.confirm()` calls in the Supplier UI
 * (archive contact, remove capability, deactivate category). `confirm()`
 * blocks with no focus trap, no keyboard-accessible styling, and no way to
 * disable it while a mutation is in flight; `Dialog` already solves all
 * three (focus trap, trigger-focus restore, `closeDisabled`).
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Подтвердить",
  cancelLabel = "Отмена",
  danger,
  pending,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog title={title} onClose={onCancel} closeDisabled={pending}>
      <p className="muted" style={{ whiteSpace: "pre-line" }}>
        {message}
      </p>
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={pending}>
          {cancelLabel}
        </button>
        <button type="button" className={danger ? "btn btn-danger" : "btn"} disabled={pending} onClick={onConfirm}>
          {pending ? "…" : confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
