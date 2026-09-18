"use client";

import { useState, type FormEvent } from "react";
import type { RfqDetail } from "@top/types";
import { Dialog } from "../dialog";
import { api, ApiError } from "../../lib/api-client";

/** DRAFT or SENT (Phase D §51/§52). Reason IS persisted (`cancelReason`) — unlike close's reason. No restore action anywhere once cancelled. */
export function RfqCancelDialog({ rfq, onClose, onSuccess }: { rfq: RfqDetail; onClose: () => void; onSuccess: (updated: RfqDetail) => void }) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const updated = await api.rfqs.cancel(rfq.id, { reason: reason.trim() || undefined });
      onSuccess(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отменить RFQ");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog title="Отменить RFQ" onClose={onClose} closeDisabled={submitting}>
      {error && <div className="form-error">{error}</div>}
      <form onSubmit={onSubmit}>
        <div className="dialog-warning">RFQ будет отменён без удаления истории.</div>
        <div className="field">
          <label htmlFor="cancel-reason">Причина отмены</label>
          <input id="cancel-reason" disabled={submitting} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="необязательно" />
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
            Назад
          </button>
          <button type="submit" className="btn btn-danger" disabled={submitting}>
            {submitting ? "Отмена…" : "Отменить RFQ"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
