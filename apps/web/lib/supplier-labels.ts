import type { SupplierStatus } from "@top/types";

/** Never show the raw enum string to a user — every value maps to Russian procurement terminology (Phase D §14). */
export const SUPPLIER_STATUS_LABELS: Record<SupplierStatus, string> = {
  ACTIVE: "Активен",
  INACTIVE: "Неактивен",
  BLOCKED: "Заблокирован",
  ARCHIVED: "Архив",
};

export function supplierStatusClassName(status: SupplierStatus): string {
  switch (status) {
    case "ACTIVE":
      return "status-active";
    case "INACTIVE":
      return "status-inactive";
    case "BLOCKED":
      return "status-blocked";
    case "ARCHIVED":
      return "status-archived";
    default:
      return "status-inactive";
  }
}

/** Status-change confirmation copy (Phase D §29) — keyed by the TARGET status being switched to. */
export const SUPPLIER_STATUS_WARNINGS: Record<SupplierStatus, string> = {
  ACTIVE: "Поставщик снова будет доступен для новых закупок.",
  INACTIVE: "Поставщик временно не будет доступен для новых закупок.",
  BLOCKED: "Поставщик будет запрещён для выбора в новых закупках.",
  ARCHIVED:
    "Поставщик будет скрыт из списка по умолчанию и недоступен для новых закупок. История останется доступной.",
};

/**
 * Display-only formatting — reads a persisted Decimal(5,2) string
 * (e.g. "4.5", "4", "3.75") and renders it consistently as "X.XX / 5".
 * Never used to build an update payload (Phase D §32/§64) — that path keeps
 * the raw string untouched, this is purely presentational.
 */
export function formatSupplierRating(rating: string | null): string {
  if (rating === null || rating === "") return "Нет оценки";
  return `${Number(rating).toFixed(2)} / 5`;
}

export function formatCountryCode(countryCode: string | null): string {
  return countryCode ?? "—";
}
