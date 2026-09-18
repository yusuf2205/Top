"use client";

import { useState } from "react";
import type { RfqItemView } from "@top/types";
import { api, ApiError } from "../../lib/api-client";
import { formatBusinessDate, formatUom } from "../../lib/pr-labels";
import { ConfirmDialog } from "../confirm-dialog";
import { PrItemPicker } from "./pr-item-picker";
import { TechnicalSpec } from "./technical-spec";

/**
 * RFQ item snapshot display + DRAFT-only add/remove (Phase D §43/§44/§53/
 * §54). Snapshot fields (itemName/skuSnapshot/description/quantity/uomCode/
 * technicalSpec/requiredDate) are rendered exactly as the RFQ stored them —
 * never re-fetched from the live Product. `internalItemNote` is always
 * labeled as internal, never under supplier-facing copy.
 */
export function RfqItemsPanel({
  rfqId,
  purchaseRequestId,
  items,
  editable,
  onChanged,
}: {
  rfqId: string;
  purchaseRequestId: string;
  items: RfqItemView[];
  editable: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<RfqItemView | null>(null);
  const [removing, setRemoving] = useState(false);

  /**
   * The backend endpoint is intentionally one-item-at-a-time (Phase C §43),
   * so this batch is NOT atomic — item A can commit server-side while item B
   * then fails. Phase E §7: never pretend the batch was atomic and never
   * attempt compensating DELETEs. Instead: stop at the first failure, and if
   * ANYTHING committed, refetch the authoritative detail unconditionally so
   * the UI can never show stale "nothing was added" state while the backend
   * disagrees. A fully-failed first item (addedCount === 0) leaves the
   * picker open/unchanged so the user can just retry without re-selecting.
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
      for (const purchaseRequestItemId of pending) {
        await api.rfqs.addItem(rfqId, { purchaseRequestItemId });
        addedCount += 1;
      }
    } catch (err) {
      failureMessage = err instanceof ApiError ? err.message : "Не удалось добавить позицию";
    }
    try {
      if (addedCount > 0) {
        setPending([]);
        setAdding(false);
        await onChanged();
      }
      if (failureMessage) {
        setError(addedCount > 0 ? `Добавлено позиций: ${addedCount}. Следующая позиция не добавлена: ${failureMessage}` : failureMessage);
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
      await api.rfqs.removeItem(rfqId, removeTarget.id);
      setRemoveTarget(null);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось убрать позицию");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2 style={{ margin: 0 }}>Позиции</h2>
        {editable && !adding && (
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setAdding(true)}>
            + Добавить позицию
          </button>
        )}
      </div>

      {error && <div className="form-error">{error}</div>}

      {adding && (
        <div style={{ marginBottom: "1rem" }}>
          <PrItemPicker
            purchaseRequestId={purchaseRequestId}
            excludeItemIds={items.map((i) => i.purchaseRequestItemId)}
            selected={pending}
            onChange={setPending}
          />
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

      {items.length === 0 && !adding && <p className="muted">Позиций пока нет.</p>}

      {items.map((item) => (
        <div className="item-row" key={item.id}>
          <div className="item-row-main">
            <div className="item-row-name">
              {item.itemName}
              {item.skuSnapshot && <span className="muted"> · SKU: {item.skuSnapshot}</span>}
            </div>
            <div className="item-row-meta">
              {Number(item.quantity)} {formatUom(item.uomCode)}
              {item.requiredDate && <> · к {formatBusinessDate(item.requiredDate)}</>}
              {item.description && <> · {item.description}</>}
            </div>
            {item.internalItemNote && (
              <div className="item-row-meta">
                <strong>Внутреннее примечание:</strong> {item.internalItemNote}
              </div>
            )}
            <TechnicalSpec spec={item.technicalSpec} />
          </div>
          {editable && (
            <div className="item-row-actions">
              <button type="button" className="btn btn-danger btn-small" onClick={() => setRemoveTarget(item)}>
                Убрать
              </button>
            </div>
          )}
        </div>
      ))}

      {removeTarget && (
        <ConfirmDialog
          title="Убрать позицию из RFQ?"
          message="Позиция останется в исходной заявке."
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
