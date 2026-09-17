"use client";

import { useState, type FormEvent } from "react";
import type { SupplierDetail, SupplierStatus } from "@top/types";
import { Dialog } from "../dialog";
import { SUPPLIER_STATUS_LABELS, SUPPLIER_STATUS_WARNINGS } from "../../lib/supplier-labels";
import { api, ApiError } from "../../lib/api-client";

const ALL_STATUSES: SupplierStatus[] = ["ACTIVE", "INACTIVE", "BLOCKED", "ARCHIVED"];

/**
 * All transitions are reversible (Phase D §28) — no workflow-progression
 * assumption, any status can move to any other. The current status is
 * excluded from the target list (§31): re-selecting the same status isn't a
 * real action here.
 */
export function SupplierStatusDialog({
  supplier,
  onClose,
  onSuccess,
}: {
  supplier: SupplierDetail;
  onClose: () => void;
  onSuccess: (updated: SupplierDetail) => void;
}) {
  const options = ALL_STATUSES.filter((s) => s !== supplier.status);
  const [status, setStatus] = useState<SupplierStatus>(options[0]);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const updated = await api.suppliers.updateStatus(supplier.id, { status, reason: reason.trim() || undefined });
      onSuccess(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось изменить статус");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog title="Изменить статус поставщика" onClose={onClose} closeDisabled={submitting}>
      {error && <div className="form-error">{error}</div>}
      <form onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="new-status">Новый статус</label>
          <select id="new-status" disabled={submitting} value={status} onChange={(e) => setStatus(e.target.value as SupplierStatus)}>
            {options.map((s) => (
              <option key={s} value={s}>
                {SUPPLIER_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="dialog-warning">{SUPPLIER_STATUS_WARNINGS[status]}</div>
        <div className="field">
          <label htmlFor="status-reason">Причина</label>
          <input id="status-reason" disabled={submitting} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="необязательно" />
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
            Отмена
          </button>
          <button type="submit" className="btn" disabled={submitting}>
            {submitting ? "Сохранение…" : "Изменить статус"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
