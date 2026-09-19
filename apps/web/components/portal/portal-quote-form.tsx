"use client";

import { useState } from "react";
import type { SupplierPortalQuoteView, SupplierPortalRfqItemView } from "@top/types";
import { ConfirmDialog } from "../confirm-dialog";
import { portalApi, PortalApiError } from "../../lib/portal-api-client";
import { classifyPortalError } from "../../lib/portal-error";
import {
  buildSubmitQuotePayload,
  isPortalQuoteFormValid,
  normalizeCurrencyInput,
  validatePortalQuoteForm,
  type PortalQuoteFormState,
} from "../../lib/portal-quote-payload";
import { formatUom } from "../../lib/pr-labels";

/**
 * M3.4 Phase D §10-14 — the editable quote form. Quantity is never an input
 * (read-only, taken straight from `items[].quantity` — the backend copies
 * it from the authoritative RFQItem regardless of anything sent here).
 * Every decimal stays a plain string in component state — never parsed
 * through `Number()`/`parseFloat()` for anything other than the UX-only
 * bounds checks in `validatePortalQuoteForm` (which never feed back into
 * the submitted payload).
 */
export function PortalQuoteForm({ items, onSubmitted }: { items: SupplierPortalRfqItemView[]; onSubmitted: (quote: SupplierPortalQuoteView) => void }) {
  const [state, setState] = useState<PortalQuoteFormState>({
    currency: "",
    vatRate: "",
    vatIncluded: false,
    deliveryCost: "0",
    deliveryIncluded: true,
    leadTimeDays: "",
    paymentTerms: "",
    warranty: "",
    notes: "",
    items: items.map((i) => ({ rfqItemId: i.id, unitPrice: "" })),
  });
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errors = validatePortalQuoteForm(state);
  const touched = state.currency.trim() !== "" && state.items.every((i) => i.unitPrice.trim() !== "");

  function setItemPrice(rfqItemId: string, unitPrice: string) {
    setState((s) => ({ ...s, items: s.items.map((i) => (i.rfqItemId === rfqItemId ? { ...i, unitPrice } : i)) }));
  }

  async function doSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const quote = await portalApi.submitQuote(buildSubmitQuotePayload(state));
      setConfirming(false);
      onSubmitted(quote);
    } catch (err) {
      const statusCode = err instanceof PortalApiError ? err.statusCode || null : null;
      const message = err instanceof PortalApiError ? err.message : undefined;
      setError(classifyPortalError(statusCode, message).message);
      setConfirming(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2 style={{ margin: 0 }}>Ваше предложение</h2>
      </div>

      {error && <div className="form-error">{error}</div>}

      <div className="portal-quote-form-grid">
        <div className="field">
          <label htmlFor="q-currency">Валюта</label>
          <input
            id="q-currency"
            value={state.currency}
            maxLength={3}
            placeholder="USD"
            onChange={(e) => setState((s) => ({ ...s, currency: normalizeCurrencyInput(e.target.value) }))}
          />
          {errors.currency && <div className="form-error">{errors.currency}</div>}
        </div>
        <div className="field">
          <label htmlFor="q-vatRate">Ставка НДС, %</label>
          <input id="q-vatRate" value={state.vatRate} placeholder="необязательно" onChange={(e) => setState((s) => ({ ...s, vatRate: e.target.value }))} />
          {errors.vatRate && <div className="form-error">{errors.vatRate}</div>}
        </div>
        <div className="field">
          <label>
            <input type="checkbox" checked={state.vatIncluded} onChange={(e) => setState((s) => ({ ...s, vatIncluded: e.target.checked }))} /> НДС включён в цену
          </label>
        </div>
        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={state.deliveryIncluded}
              onChange={(e) => setState((s) => ({ ...s, deliveryIncluded: e.target.checked, deliveryCost: e.target.checked ? "0" : s.deliveryCost }))}
            />{" "}
            Доставка включена в цену
          </label>
        </div>
        {!state.deliveryIncluded && (
          <div className="field">
            <label htmlFor="q-deliveryCost">Стоимость доставки</label>
            <input id="q-deliveryCost" value={state.deliveryCost} onChange={(e) => setState((s) => ({ ...s, deliveryCost: e.target.value }))} />
            {errors.deliveryCost && <div className="form-error">{errors.deliveryCost}</div>}
          </div>
        )}
        <div className="field">
          <label htmlFor="q-leadTime">Срок поставки, дней</label>
          <input id="q-leadTime" value={state.leadTimeDays} placeholder="необязательно" onChange={(e) => setState((s) => ({ ...s, leadTimeDays: e.target.value }))} />
          {errors.leadTimeDays && <div className="form-error">{errors.leadTimeDays}</div>}
        </div>
        <div className="field">
          <label htmlFor="q-paymentTerms">Условия оплаты</label>
          <input id="q-paymentTerms" value={state.paymentTerms} placeholder="необязательно" onChange={(e) => setState((s) => ({ ...s, paymentTerms: e.target.value }))} />
        </div>
        <div className="field">
          <label htmlFor="q-warranty">Гарантия</label>
          <input id="q-warranty" value={state.warranty} placeholder="необязательно" onChange={(e) => setState((s) => ({ ...s, warranty: e.target.value }))} />
        </div>
      </div>

      <div className="field">
        <label htmlFor="q-notes">Комментарий</label>
        <textarea id="q-notes" rows={3} value={state.notes} onChange={(e) => setState((s) => ({ ...s, notes: e.target.value }))} />
        {errors.notes && <div className="form-error">{errors.notes}</div>}
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>Позиция</th>
            <th>Кол-во</th>
            <th>Цена за ед.</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const itemState = state.items.find((i) => i.rfqItemId === item.id)!;
            return (
              <tr key={item.id}>
                <td>{item.itemName}</td>
                <td>
                  {item.quantity} {formatUom(item.uomCode)}
                </td>
                <td>
                  <input
                    className="portal-item-price-input"
                    aria-label={`Цена за единицу: ${item.itemName}`}
                    value={itemState.unitPrice}
                    onChange={(e) => setItemPrice(item.id, e.target.value)}
                  />
                  {errors.items?.[item.id] && <div className="form-error">{errors.items[item.id]}</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="dialog-actions">
        <button type="button" className="btn" disabled={!touched || !isPortalQuoteFormValid(errors) || submitting} onClick={() => setConfirming(true)}>
          Отправить предложение
        </button>
      </div>

      {confirming && (
        <ConfirmDialog
          title="Отправить предложение?"
          message="После отправки предложение будет зафиксировано."
          confirmLabel="Отправить"
          pending={submitting}
          onConfirm={doSubmit}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
