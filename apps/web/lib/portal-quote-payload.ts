import type { SubmitQuoteInput } from "@top/validation";

/**
 * M3.4 Phase D §10-13 — Supplier Portal quote-form payload shaping and UX
 * validation. Mirrors the exact regexes/bounds `packages/validation/src/
 * quotes.ts` and `decimal.ts` already enforce authoritatively — this module
 * NEVER becomes the source of truth (the backend re-validates everything
 * independently); it only gives the Supplier a fast, friendly error before
 * a round-trip. Every decimal stays a plain string end to end — never
 * `Number()`/`parseFloat()`/unary `+`/`Math.*` on a monetary value, matching
 * this project's locked no-JS-float-for-money rule.
 */

export interface PortalQuoteItemFormState {
  rfqItemId: string;
  unitPrice: string;
}

export interface PortalQuoteFormState {
  currency: string;
  vatRate: string;
  vatIncluded: boolean;
  deliveryCost: string;
  deliveryIncluded: boolean;
  leadTimeDays: string;
  paymentTerms: string;
  warranty: string;
  notes: string;
  items: PortalQuoteItemFormState[];
}

export function normalizeCurrencyInput(raw: string): string {
  return raw.trim().toUpperCase();
}

const UNIT_PRICE_RE = /^\d{1,14}(\.\d{1,4})?$/;
const MONEY_RE = /^\d{1,16}(\.\d{1,2})?$/;
const PERCENT_RE = /^\d{1,3}(\.\d{1,2})?$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

function isZeroDecimalString(value: string): boolean {
  const trimmed = value.trim();
  const [intPart, fracPart] = trimmed.split(".");
  return /^0+$/.test(intPart ?? "") && (fracPart === undefined || /^0+$/.test(fracPart));
}

export type PortalQuoteFormErrors = Partial<Record<Exclude<keyof PortalQuoteFormState, "items">, string>> & {
  items?: Record<string, string>;
};

/** UX-only — every one of these is re-checked authoritatively by submitQuoteSchema on the backend. */
export function validatePortalQuoteForm(state: PortalQuoteFormState): PortalQuoteFormErrors {
  const errors: PortalQuoteFormErrors = {};

  if (!CURRENCY_RE.test(normalizeCurrencyInput(state.currency))) {
    errors.currency = "Введите 3-буквенный код валюты (например, USD)";
  }

  if (state.vatRate.trim() !== "") {
    if (!PERCENT_RE.test(state.vatRate.trim()) || Number(state.vatRate) > 100) {
      errors.vatRate = "Ставка НДС от 0 до 100, не более 2 знаков после запятой";
    }
  }

  if (!MONEY_RE.test(state.deliveryCost.trim())) {
    errors.deliveryCost = "Введите сумму, не более 2 знаков после запятой";
  } else if (state.deliveryIncluded && !isZeroDecimalString(state.deliveryCost)) {
    errors.deliveryCost = "Если доставка включена в цену, стоимость доставки должна быть 0";
  }

  if (state.leadTimeDays.trim() !== "") {
    const n = Number(state.leadTimeDays);
    if (!Number.isInteger(n) || n < 0 || n > 365) {
      errors.leadTimeDays = "Срок поставки: целое число от 0 до 365 дней";
    }
  }

  if (state.paymentTerms.length > 500) errors.paymentTerms = "Не более 500 символов";
  if (state.warranty.length > 500) errors.warranty = "Не более 500 символов";
  if (state.notes.length > 2000) errors.notes = "Не более 2000 символов";

  const itemErrors: Record<string, string> = {};
  for (const item of state.items) {
    if (!UNIT_PRICE_RE.test(item.unitPrice.trim()) || Number(item.unitPrice) <= 0) {
      itemErrors[item.rfqItemId] = "Цена должна быть больше 0, не более 4 знаков после запятой";
    }
  }
  if (Object.keys(itemErrors).length > 0) errors.items = itemErrors;

  return errors;
}

export function isPortalQuoteFormValid(errors: PortalQuoteFormErrors): boolean {
  return Object.keys(errors).length === 0;
}

/**
 * Pure payload shaping — quantity is NEVER included (§10 "no frontend-only
 * fields", backend always copies quantity from the authoritative RFQItem;
 * `submitQuoteSchema` rejects an unknown `quantity` field with a 400).
 * Optional fields are omitted entirely (not sent as `""`/`null`) when blank,
 * matching the backend's `.nullable().optional()` shape.
 */
export function buildSubmitQuotePayload(state: PortalQuoteFormState): SubmitQuoteInput {
  const payload: SubmitQuoteInput = {
    currency: normalizeCurrencyInput(state.currency),
    vatIncluded: state.vatIncluded,
    deliveryCost: state.deliveryCost.trim(),
    deliveryIncluded: state.deliveryIncluded,
    items: state.items.map((i) => ({ rfqItemId: i.rfqItemId, unitPrice: i.unitPrice.trim() })),
  };
  if (state.vatRate.trim() !== "") payload.vatRate = state.vatRate.trim();
  if (state.leadTimeDays.trim() !== "") payload.leadTimeDays = Number(state.leadTimeDays);
  if (state.paymentTerms.trim() !== "") payload.paymentTerms = state.paymentTerms.trim();
  if (state.warranty.trim() !== "") payload.warranty = state.warranty.trim();
  if (state.notes.trim() !== "") payload.notes = state.notes.trim();
  return payload;
}
