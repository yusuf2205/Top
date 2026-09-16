import type { PurchaseRequestItemInput, UpdatePurchaseRequestItemInput } from "@top/validation";
import type { UomCode } from "@top/types";

export type ItemMode = "product" | "free-text";

export interface ItemFormState {
  mode: ItemMode;
  productId: string | null;
  /** Display-only (e.g. the selected catalog product's name) — never read by buildItemInput/buildItemUpdateInput, so it can never leak into the API payload. */
  productLabel: string;
  itemName: string;
  description: string;
  quantity: string;
  uomCode: UomCode | "";
  notes: string;
  requiredDate: string; // "" or an <input type="date"> value (YYYY-MM-DD)
}

export const EMPTY_ITEM_FORM: ItemFormState = {
  mode: "free-text",
  productId: null,
  productLabel: "",
  itemName: "",
  description: "",
  quantity: "",
  uomCode: "",
  notes: "",
  requiredDate: "",
};

/** Русский текст ошибки для UI, или null если форма валидна на клиенте (backend остаётся финальным арбитром). */
export function validateItemForm(state: ItemFormState): string | null {
  if (state.mode === "product" && !state.productId) return "Выберите товар из каталога.";
  if (state.mode === "free-text" && !state.itemName.trim()) return "Укажите наименование позиции.";
  if (!state.quantity.trim() || Number(state.quantity) <= 0) return "Укажите количество больше нуля.";
  if (!state.uomCode) return "Укажите единицу измерения.";
  return null;
}

function requiredDateIso(value: string): string | undefined {
  if (!value) return undefined;
  return new Date(`${value}T00:00:00.000Z`).toISOString();
}

/**
 * Builds the exact create/addItem payload. Critical: quantity is passed
 * through as the raw string the user typed — NEVER `Number(state.quantity)`
 * — the backend expects a Decimal(18,3) string and any JS float round-trip
 * risks silently corrupting a value like "10.250". When productId is set,
 * itemName/skuSnapshot are never included — the server derives both from
 * the current Product row (Phase D §17); sending them would be rejected by
 * the DTO's own superRefine anyway.
 */
export function buildItemInput(state: ItemFormState): PurchaseRequestItemInput {
  const base = {
    quantity: state.quantity,
    uomCode: state.uomCode as UomCode,
    description: state.description.trim() || undefined,
    notes: state.notes.trim() || undefined,
    requiredDate: requiredDateIso(state.requiredDate),
  };
  if (state.mode === "product" && state.productId) {
    return { ...base, productId: state.productId };
  }
  return { ...base, itemName: state.itemName.trim() };
}

/** Update DTO never carries productId/itemName/skuSnapshot at all (Phase C §21 — identity is remove+re-add, never a partial update). */
export function buildItemUpdateInput(state: Pick<ItemFormState, "quantity" | "uomCode" | "description" | "notes" | "requiredDate">): UpdatePurchaseRequestItemInput {
  return {
    quantity: state.quantity,
    uomCode: state.uomCode as UomCode,
    description: state.description.trim() || undefined,
    notes: state.notes.trim() || undefined,
    requiredDate: requiredDateIso(state.requiredDate),
  };
}
