"use client";

import { useState, type FormEvent } from "react";
import type { PurchaseRequestPriority, PurchaseRequestSummary } from "@top/types";
import { PRIORITY_LABELS } from "../../lib/pr-labels";
import { api, ApiError } from "../../lib/api-client";

const PRIORITY_OPTIONS = Object.entries(PRIORITY_LABELS) as [PurchaseRequestPriority, string][];

/**
 * Only the fields the backend's update PATCH actually accepts (Phase D §24):
 * never requestNumber/requesterId/status/assignedBuyerUserId. Department/
 * category are intentionally omitted — no lookup endpoint exists yet for
 * either (Phase A §15's own decision, see the final report).
 */
export function HeaderEditForm({
  pr,
  onCancel,
  onSaved,
}: {
  pr: PurchaseRequestSummary;
  onCancel: () => void;
  onSaved: (updated: PurchaseRequestSummary) => void;
}) {
  const [priority, setPriority] = useState<PurchaseRequestPriority>(pr.priority);
  const [requiredDate, setRequiredDate] = useState(pr.requiredDate ? pr.requiredDate.slice(0, 10) : "");
  const [reason, setReason] = useState(pr.reason ?? "");
  const [estimatedBudget, setEstimatedBudget] = useState(pr.estimatedBudget ?? "");
  const [currency, setCurrency] = useState(pr.currency);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const updated = await api.purchaseRequests.update(pr.id, {
        priority,
        requiredDate: requiredDate ? new Date(`${requiredDate}T00:00:00.000Z`).toISOString() : undefined,
        reason: reason.trim() || undefined,
        estimatedBudget: estimatedBudget.trim() || undefined,
        currency: currency.trim() || undefined,
      });
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
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <div className="field" style={{ flex: 1, minWidth: 140 }}>
          <label htmlFor="priority">Приоритет</label>
          <select id="priority" value={priority} onChange={(e) => setPriority(e.target.value as PurchaseRequestPriority)}>
            {PRIORITY_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1, minWidth: 140 }}>
          <label htmlFor="requiredDate">Требуемая дата</label>
          <input id="requiredDate" type="date" value={requiredDate} onChange={(e) => setRequiredDate(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 140 }}>
          <label htmlFor="estimatedBudget">Ориентировочный бюджет</label>
          <input id="estimatedBudget" inputMode="decimal" placeholder="напр. 15000000" value={estimatedBudget} onChange={(e) => setEstimatedBudget(e.target.value)} />
        </div>
        <div className="field" style={{ width: 100 }}>
          <label htmlFor="currency">Валюта</label>
          <input id="currency" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="reason">Обоснование</label>
        <input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Отмена
        </button>
        <button type="submit" className="btn" disabled={submitting}>
          {submitting ? "Сохранение…" : "Сохранить"}
        </button>
      </div>
    </form>
  );
}
