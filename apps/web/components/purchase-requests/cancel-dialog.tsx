"use client";

import { useState } from "react";
import type { PurchaseRequestStatus, PurchaseRequestSummary } from "@top/types";
import { Dialog } from "../dialog";
import { api, ApiError } from "../../lib/api-client";

export function CancelPurchaseRequestDialog({
  purchaseRequestId,
  status,
  onClose,
  onSuccess,
}: {
  purchaseRequestId: string;
  status: PurchaseRequestStatus;
  onClose: () => void;
  onSuccess: (updated: PurchaseRequestSummary) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      const updated = await api.purchaseRequests.cancel(purchaseRequestId);
      onSuccess(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отменить заявку");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog title="Отменить заявку" onClose={onClose} closeDisabled={submitting}>
      {error && <div className="form-error">{error}</div>}
      {status === "APPROVED" ? (
        <div className="dialog-warning">
          Заявка уже была одобрена. Отмена сохранит историю согласования — она останется видна, но заявка перестанет
          быть активной.
        </div>
      ) : (
        <p className="muted">Это действие нельзя отменить.</p>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
          Назад
        </button>
        <button type="button" className="btn btn-danger" disabled={submitting} onClick={onConfirm}>
          {submitting ? "Отмена заявки…" : "Отменить заявку"}
        </button>
      </div>
    </Dialog>
  );
}
