"use client";

import { useState } from "react";
import type { RfqDetail } from "@top/types";
import { Dialog } from "../dialog";
import { api, ApiError } from "../../lib/api-client";
import { formatDeadline } from "../../lib/rfq-labels";

/**
 * SEND confirmation (Phase D §48/§49). Critical language boundary: M3.3
 * SEND only finalizes the INTERNAL RFQ — no Supplier Portal delivery exists
 * yet, so the copy never claims suppliers were notified/invited. After
 * success the caller refetches the authoritative detail (no realtime, no
 * optimistic status flip here).
 */
export function RfqSendDialog({ rfq, onClose, onSuccess }: { rfq: RfqDetail; onClose: () => void; onSuccess: (updated: RfqDetail) => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      const updated = await api.rfqs.send(rfq.id);
      onSuccess(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отправить RFQ");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog title="Отправить RFQ" onClose={onClose} closeDisabled={submitting}>
      {error && <div className="form-error">{error}</div>}
      <div className="dialog-warning">
        После отправки позиции, поставщиков и основные условия RFQ нельзя будет изменить.
      </div>
      <dl className="meta-grid">
        <div>
          <div className="meta-label">Номер RFQ</div>
          <div className="meta-value">{rfq.rfqNumber}</div>
        </div>
        <div>
          <div className="meta-label">Позиций</div>
          <div className="meta-value">{rfq.items.length}</div>
        </div>
        <div>
          <div className="meta-label">Поставщиков</div>
          <div className="meta-value">{rfq.suppliers.length}</div>
        </div>
        <div>
          <div className="meta-label">Срок ответа</div>
          <div className="meta-value">{formatDeadline(rfq.deadline)}</div>
        </div>
      </dl>
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
          Назад
        </button>
        <button type="button" className="btn" disabled={submitting} onClick={onConfirm}>
          {submitting ? "Отправка…" : "Отправить RFQ"}
        </button>
      </div>
    </Dialog>
  );
}
