"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { RfqDetail } from "@top/types";
import { api, ApiError } from "../../lib/api-client";
import { buildUpdateRfqPayload, hasRfqHeaderChanges, rfqDetailToHeaderFormState } from "../../lib/rfq-payload";

/**
 * DRAFT-only header edit — deadline/supplierInstructions/internalNotes via
 * PATCH /rfqs/:id (Phase D §41/§42). No generic status field here (the
 * backend PATCH itself doesn't accept one). Save is disabled while the
 * built payload has no keys — a true no-op never fires a request.
 */
export function RfqHeaderEditForm({ rfq, onCancel, onSaved }: { rfq: RfqDetail; onCancel: () => void; onSaved: (updated: RfqDetail) => void }) {
  const [state, setState] = useState(() => rfqDetailToHeaderFormState(rfq));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const payload = useMemo(() => buildUpdateRfqPayload(rfq, state), [rfq, state]);
  const dirty = hasRfqHeaderChanges(payload);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await api.rfqs.update(rfq.id, payload);
      onSaved(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить изменения");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card">
      {error && <div className="form-error">{error}</div>}
      <div className="field">
        <label htmlFor="rfq-deadline">Срок ответа</label>
        <input
          id="rfq-deadline"
          type="datetime-local"
          value={state.deadline}
          onChange={(e) => setState((s) => ({ ...s, deadline: e.target.value }))}
        />
      </div>
      <div className="field">
        <label htmlFor="rfq-supplier-instructions">Инструкции поставщику</label>
        <textarea
          id="rfq-supplier-instructions"
          rows={3}
          value={state.supplierInstructions}
          onChange={(e) => setState((s) => ({ ...s, supplierInstructions: e.target.value }))}
        />
        <p className="muted" style={{ fontSize: "0.78rem", marginTop: "0.2rem" }}>
          Эта информация предназначена для поставщиков.
        </p>
      </div>
      <div className="field">
        <label htmlFor="rfq-internal-notes">Внутренние заметки</label>
        <textarea
          id="rfq-internal-notes"
          rows={3}
          value={state.internalNotes}
          onChange={(e) => setState((s) => ({ ...s, internalNotes: e.target.value }))}
        />
        <p className="muted" style={{ fontSize: "0.78rem", marginTop: "0.2rem" }}>
          Эти заметки видны только сотрудникам вашей организации.
        </p>
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={submitting}>
          Отмена
        </button>
        <button type="submit" className="btn" disabled={submitting || !dirty}>
          {submitting ? "Сохранение…" : "Сохранить"}
        </button>
      </div>
    </form>
  );
}
