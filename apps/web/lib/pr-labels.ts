import type { PurchaseRequestPriority, PurchaseRequestStatus, UomCode } from "@top/types";

/** Never show the raw enum string to a user — every value here maps to Russian procurement terminology. */
export const STATUS_LABELS: Record<PurchaseRequestStatus, string> = {
  DRAFT: "Черновик",
  SUBMITTED: "Отправлена",
  UNDER_APPROVAL: "На согласовании",
  APPROVED: "Одобрено",
  REJECTED: "Отклонено",
  RFQ_IN_PROGRESS: "Формирование запроса цен",
  PO_CREATED: "Заказ создан",
  CLOSED: "Закрыта",
  CANCELLED: "Отменено",
};

/** CSS class per status — grouped by visual meaning, not 1:1 with the enum (SUBMITTED/UNDER_APPROVAL/RFQ_IN_PROGRESS/PO_CREATED all read as "in progress"). */
export function statusClassName(status: PurchaseRequestStatus): string {
  switch (status) {
    case "DRAFT":
      return "status-draft";
    case "SUBMITTED":
    case "UNDER_APPROVAL":
      return "status-pending";
    case "APPROVED":
      return "status-approved";
    case "REJECTED":
      return "status-rejected";
    case "CANCELLED":
      return "status-cancelled";
    case "RFQ_IN_PROGRESS":
    case "PO_CREATED":
    case "CLOSED":
      return "status-progress";
    default:
      return "status-draft";
  }
}

export const PRIORITY_LABELS: Record<PurchaseRequestPriority, string> = {
  LOW: "Низкий",
  NORMAL: "Обычный",
  HIGH: "Высокий",
  URGENT: "Срочный",
};

export function priorityClassName(priority: PurchaseRequestPriority): string {
  if (priority === "URGENT") return "priority-urgent";
  if (priority === "HIGH") return "priority-high";
  return "";
}

/** Canonical UomCode values only — see packages/database/prisma/schema.prisma UomCode. Never invent a member that doesn't exist there. */
export const UOM_LABELS: Record<UomCode, string> = {
  PCS: "шт.",
  KG: "кг",
  G: "г",
  TON: "т",
  M: "м",
  CM: "см",
  MM: "мм",
  M2: "м²",
  M3: "м³",
  L: "л",
  ML: "мл",
};

export function formatUom(code: UomCode): string {
  return UOM_LABELS[code] ?? code;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU");
}

/**
 * For pure business-date fields (currently only `requiredDate`) that mean a
 * calendar day, not an instant. The frontend always sends these as
 * UTC-midnight ISO strings (`YYYY-MM-DDT00:00:00.000Z`), and the backend
 * round-trips the same instant back — so the Y-M-D digits are taken directly
 * from the string instead of going through `new Date(...)`, which would
 * reinterpret UTC midnight in the *viewer's* local timezone and silently
 * shift the displayed day for anyone west of UTC. `createdAt`/`submittedAt`/
 * etc. are real timestamps and correctly keep using `formatDate`.
 */
export function formatBusinessDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return "—";
  const [, y, m, d] = match;
  return `${d}.${m}.${y}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

export function formatMoney(value: string | null | undefined, currency?: string): string {
  if (!value) return "—";
  const num = Number(value);
  const formatted = num.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return currency ? `${formatted} ${currency}` : formatted;
}
