"use client";

import { useState } from "react";
import type { PurchaseRequestItemSummary } from "@top/types";
import { formatBusinessDate, formatUom } from "../../lib/pr-labels";
import { buildItemInput, buildItemUpdateInput, type ItemFormState } from "../../lib/pr-item-payload";
import { api, ApiError } from "../../lib/api-client";
import { ItemEditor } from "./item-editor";

export function PurchaseRequestItems({
  purchaseRequestId,
  items,
  editable,
  onChanged,
}: {
  purchaseRequestId: string;
  items: PurchaseRequestItemSummary[];
  editable: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(state: ItemFormState) {
    setSubmitting(true);
    setError(null);
    try {
      await api.purchaseRequests.addItem(purchaseRequestId, buildItemInput(state));
      setAdding(false);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось добавить позицию");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdate(itemId: string, state: ItemFormState) {
    setSubmitting(true);
    setError(null);
    try {
      await api.purchaseRequests.updateItem(purchaseRequestId, itemId, buildItemUpdateInput(state));
      setEditingId(null);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить позицию");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(itemId: string) {
    if (!confirm("Удалить позицию?\n\nЭто действие нельзя отменить.")) return;
    setError(null);
    try {
      await api.purchaseRequests.removeItem(purchaseRequestId, itemId);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось удалить позицию");
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2 style={{ margin: 0 }}>Позиции заявки</h2>
        {editable && !adding && (
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setAdding(true)}>
            + Добавить позицию
          </button>
        )}
      </div>

      {error && <div className="form-error">{error}</div>}

      {adding && <ItemEditor mode="add" submitting={submitting} onCancel={() => setAdding(false)} onSubmit={handleAdd} />}

      {items.length === 0 && !adding && <p className="muted">Позиций пока нет.</p>}

      {items.map((item) =>
        editingId === item.id ? (
          <ItemEditor
            key={item.id}
            mode="edit"
            existing={item}
            submitting={submitting}
            onCancel={() => setEditingId(null)}
            onSubmit={(state) => handleUpdate(item.id, state)}
          />
        ) : (
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
            </div>
            {editable && (
              <div className="item-row-actions">
                <button type="button" className="btn btn-secondary btn-small" onClick={() => setEditingId(item.id)}>
                  Изменить
                </button>
                <button type="button" className="btn btn-danger btn-small" onClick={() => handleRemove(item.id)}>
                  Удалить
                </button>
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}
