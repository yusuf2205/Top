"use client";

import { useState, type FormEvent } from "react";
import type { PurchaseRequestSummary } from "@top/types";
import { Dialog } from "../dialog";
import { api, ApiError } from "../../lib/api-client";

export function RejectPurchaseRequestDialog({
  purchaseRequestId,
  onClose,
  onSuccess,
}: {
  purchaseRequestId: string;
  onClose: () => void;
  onSuccess: (updated: PurchaseRequestSummary) => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await api.purchaseRequests.reject(purchaseRequestId, { reason: reason.trim() });
      onSuccess(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отклонить заявку");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog title="Отклонить заявку" onClose={onClose} closeDisabled={submitting}>
      {error && <div className="form-error">{error}</div>}
      <form onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="reason">Причина отклонения</label>
          <textarea
            id="reason"
            required
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ width: "100%", padding: "0.55rem 0.7rem", border: "1px solid var(--color-border)", borderRadius: 6, fontSize: "0.9rem", fontFamily: "inherit" }}
          />
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
            Отмена
          </button>
          <button type="submit" className="btn btn-danger" disabled={submitting || !reason.trim()}>
            {submitting ? "Отклонение…" : "Отклонить"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
