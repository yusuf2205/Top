"use client";

import { useState } from "react";
import type { RfqSupplierView } from "@top/types";
import { api, ApiError } from "../../lib/api-client";
import { SupplierStatusBadge } from "../suppliers/supplier-status-badge";
import { ConfirmDialog } from "../confirm-dialog";
import { RfqSupplierStatusBadge } from "./status-badge";
import { SupplierPicker } from "./supplier-picker";

/**
 * RFQ supplier identity snapshot display + DRAFT-only add/remove (Phase D
 * §45/§46/§56/§57). `supplierCodeSnapshot`/`companyNameSnapshot` are the
 * RFQ's OWN historical identity — never replaced with the Supplier's current
 * name. `currentSupplierStatus` is shown as a separate live badge so the
 * distinction between "what the RFQ recorded" and "what's true right now"
 * stays visible, never implying a later rename/status change rewrites RFQ
 * history.
 */
export function RfqSuppliersPanel({
  rfqId,
  suppliers,
  editable,
  onChanged,
}: {
  rfqId: string;
  suppliers: RfqSupplierView[];
  editable: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<RfqSupplierView | null>(null);
  const [removing, setRemoving] = useState(false);

  /**
   * One-supplier-at-a-time backend endpoint (Phase C §45) — this batch is NOT
   * atomic, so e.g. Supplier A can commit while Supplier B fails (BLOCKED
   * since the picker loaded). Phase E §8: never a compensating DELETE, never
   * pretend the batch was atomic. Stop at the first failure; if anything
   * committed, refetch unconditionally so the UI matches the backend even on
   * partial success, and surface a message naming how many actually landed.
   */
  async function handleAddSelected() {
    if (pending.length === 0) {
      setAdding(false);
      return;
    }
    setSubmitting(true);
    setError(null);
    let addedCount = 0;
    let failureMessage: string | null = null;
    try {
      for (const supplierId of pending) {
        // Backend re-validates ACTIVE at the moment of insert — a supplier that
        // became inactive after the picker loaded surfaces its own clean error
        // here rather than being silently skipped (Phase D §45).
        await api.rfqs.addSupplier(rfqId, { supplierId });
        addedCount += 1;
      }
    } catch (err) {
      failureMessage = err instanceof ApiError ? err.message : "Не удалось добавить поставщика";
    }
    try {
      if (addedCount > 0) {
        setPending([]);
        setAdding(false);
        await onChanged();
      }
      if (failureMessage) {
        setError(addedCount > 0 ? `Добавлено поставщиков: ${addedCount}. Следующий поставщик не добавлен: ${failureMessage}` : failureMessage);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove() {
    if (!removeTarget) return;
    setRemoving(true);
    setError(null);
    try {
      await api.rfqs.removeSupplier(rfqId, removeTarget.id);
      setRemoveTarget(null);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось убрать поставщика");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2 style={{ margin: 0 }}>Поставщики</h2>
        {editable && !adding && (
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setAdding(true)}>
            + Добавить поставщика
          </button>
        )}
      </div>

      {error && <div className="form-error">{error}</div>}

      {adding && (
        <div style={{ marginBottom: "1rem" }}>
          <SupplierPicker excludeIds={suppliers.map((s) => s.supplierId)} selected={pending} onChange={setPending} />
          <div className="dialog-actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={submitting}
              onClick={() => {
                setAdding(false);
                setPending([]);
              }}
            >
              Отмена
            </button>
            <button type="button" className="btn" disabled={submitting || pending.length === 0} onClick={handleAddSelected}>
              {submitting ? "Добавление…" : `Добавить (${pending.length})`}
            </button>
          </div>
        </div>
      )}

      {suppliers.length === 0 && !adding && <p className="muted">Поставщики пока не выбраны.</p>}

      {suppliers.map((s) => (
        <div className="item-row" key={s.id}>
          <div className="item-row-main">
            <div className="item-row-name">
              {s.companyNameSnapshot} <span className="muted">· {s.supplierCodeSnapshot}</span>
            </div>
            <div className="item-row-meta" style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
              <RfqSupplierStatusBadge status={s.status} />
              <SupplierStatusBadge status={s.currentSupplierStatus} />
            </div>
          </div>
          {editable && (
            <div className="item-row-actions">
              <button type="button" className="btn btn-danger btn-small" onClick={() => setRemoveTarget(s)}>
                Убрать
              </button>
            </div>
          )}
        </div>
      ))}

      {removeTarget && (
        <ConfirmDialog
          title="Убрать поставщика из RFQ?"
          message="Поставщик будет исключён из этого RFQ. Карточка поставщика в системе не удаляется."
          confirmLabel="Убрать"
          danger
          pending={removing}
          onConfirm={handleRemove}
          onCancel={() => setRemoveTarget(null)}
        />
      )}
    </div>
  );
}
