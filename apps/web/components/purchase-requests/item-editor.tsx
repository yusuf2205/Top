"use client";

import { useState, type FormEvent } from "react";
import type { ProductSummary, PurchaseRequestItemSummary, UomCode } from "@top/types";
import { UOM_LABELS } from "../../lib/pr-labels";
import { EMPTY_ITEM_FORM, validateItemForm, type ItemFormState, type ItemMode } from "../../lib/pr-item-payload";
import { ProductPicker } from "./product-picker";

const UOM_OPTIONS = Object.entries(UOM_LABELS) as [UomCode, string][];

/**
 * Add mode exposes the product-vs-free-text choice; edit mode never does —
 * an existing item's identity (productId/itemName/skuSnapshot) is immutable
 * once created (Phase C §21: remove + re-add, never a partial identity
 * change), matching updatePurchaseRequestItemSchema exactly.
 */
export function ItemEditor({
  mode,
  existing,
  submitting,
  onCancel,
  onSubmit,
}: {
  mode: "add" | "edit";
  existing?: PurchaseRequestItemSummary;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (state: ItemFormState) => void;
}) {
  const [itemMode, setItemMode] = useState<ItemMode>("free-text");
  const [product, setProduct] = useState<ProductSummary | null>(null);
  const [form, setForm] = useState<ItemFormState>(() =>
    existing
      ? {
          ...EMPTY_ITEM_FORM,
          mode: existing.productId ? "product" : "free-text",
          productId: existing.productId,
          productLabel: existing.productId ? existing.itemName : "",
          itemName: existing.itemName,
          description: existing.description ?? "",
          quantity: existing.quantity,
          uomCode: existing.uomCode,
          notes: existing.notes ?? "",
          requiredDate: existing.requiredDate ? existing.requiredDate.slice(0, 10) : "",
        }
      : EMPTY_ITEM_FORM
  );
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const finalState: ItemFormState =
      mode === "add"
        ? {
            ...form,
            mode: itemMode,
            productId: itemMode === "product" ? product?.id ?? null : null,
            productLabel: itemMode === "product" ? product?.name ?? "" : "",
          }
        : form;
    const validationError = validateItemForm(finalState);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    onSubmit(finalState);
  }

  return (
    <form onSubmit={handleSubmit} className="card" style={{ marginBottom: "1rem" }}>
      {error && <div className="form-error">{error}</div>}

      {mode === "add" && (
        <div className="mode-toggle">
          <button type="button" className={itemMode === "product" ? "active" : ""} onClick={() => setItemMode("product")}>
            Из каталога
          </button>
          <button type="button" className={itemMode === "free-text" ? "active" : ""} onClick={() => setItemMode("free-text")}>
            Свободная позиция
          </button>
        </div>
      )}

      {mode === "add" && itemMode === "product" && <ProductPicker selected={product} onSelect={setProduct} />}

      {(mode === "edit" || itemMode === "free-text") && (
        <div className="field">
          <label htmlFor="itemName">Наименование</label>
          {mode === "edit" ? (
            <input id="itemName" value={form.itemName} disabled />
          ) : (
            <input
              id="itemName"
              required
              value={form.itemName}
              onChange={(e) => setForm((f) => ({ ...f, itemName: e.target.value }))}
            />
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <div className="field" style={{ flex: 1, minWidth: 120 }}>
          <label htmlFor="quantity">Количество</label>
          <input
            id="quantity"
            required
            inputMode="decimal"
            placeholder="напр. 10.250"
            value={form.quantity}
            onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
          />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 120 }}>
          <label htmlFor="uomCode">Единица измерения</label>
          <select id="uomCode" required value={form.uomCode} onChange={(e) => setForm((f) => ({ ...f, uomCode: e.target.value as UomCode }))}>
            <option value="" disabled>
              Выберите
            </option>
            {UOM_OPTIONS.map(([code, label]) => (
              <option key={code} value={code}>
                {label} ({code})
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1, minWidth: 140 }}>
          <label htmlFor="requiredDate">Требуемая дата</label>
          <input id="requiredDate" type="date" value={form.requiredDate} onChange={(e) => setForm((f) => ({ ...f, requiredDate: e.target.value }))} />
        </div>
      </div>

      <div className="field">
        <label htmlFor="description">Описание</label>
        <input id="description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
      </div>

      <div className="field">
        <label htmlFor="notes">Примечание</label>
        <input id="notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
      </div>

      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Отмена
        </button>
        <button type="submit" className="btn" disabled={submitting}>
          {submitting ? "Сохранение…" : mode === "add" ? "Добавить позицию" : "Сохранить"}
        </button>
      </div>
    </form>
  );
}
