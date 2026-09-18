"use client";

import { useState, type FormEvent } from "react";
import type { RfqDetail } from "@top/types";
import { Dialog } from "../dialog";
import { api, ApiError } from "../../lib/api-client";

/** SENT-only (Phase D §50). Reason is audit-only — the backend never persists a `closeReason` column, so it deliberately never appears in RfqDetail after this. */
export function RfqCloseDialog({ rfq, onClose, onSuccess }: { rfq: RfqDetail; onClose: () => void; onSuccess: (updated: RfqDetail) => void }) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const updated = await api.rfqs.close(rfq.id, { reason: reason.trim() || undefined });
      onSuccess(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось закрыть RFQ");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog title="Закрыть RFQ" onClose={onClose} closeDisabled={submitting}>
      {error && <div className="form-error">{error}</div>}
      <form onSubmit={onSubmit}>
        <div className="dialog-warning">Закрытие прекращает работу с этим RFQ.</div>
        <div className="field">
          <label htmlFor="close-reason">Причина закрытия</label>
          <input id="close-reason" disabled={submitting} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="необязательно" />
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
            Отмена
          </button>
          <button type="submit" className="btn btn-danger" disabled={submitting}>
            {submitting ? "Закрытие…" : "Закрыть RFQ"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
