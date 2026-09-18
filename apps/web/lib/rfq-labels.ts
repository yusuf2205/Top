import type { RfqStatus, RfqSupplierStatus } from "@top/types";
import { formatDateTime } from "./pr-labels";

/**
 * Never show the raw enum string to a user — every value maps to Russian
 * procurement terminology (Phase D §9). IN_PROGRESS is dormant in M3.3 (no
 * service code ever assigns it — see rfqs.service.ts) but the label/class
 * maps exist so a future/foreign value never falls through to `undefined`.
 */
export const RFQ_STATUS_LABELS: Record<RfqStatus, string> = {
  DRAFT: "Черновик",
  SENT: "Отправлен",
  IN_PROGRESS: "В процессе",
  CLOSED: "Закрыт",
  CANCELLED: "Отменён",
};

/** Reuses the exact same status-badge color classes already defined for Purchase Requests (globals.css) — no new CSS needed. */
export function rfqStatusClassName(status: RfqStatus): string {
  switch (status) {
    case "DRAFT":
      return "status-draft";
    case "SENT":
      return "status-pending";
    case "IN_PROGRESS":
      return "status-progress";
    case "CLOSED":
      return "status-cancelled";
    case "CANCELLED":
      return "status-rejected";
    default:
      return "status-draft";
  }
}

/**
 * RfqSupplier.status labels (Phase D §79). Only SELECTED is ever produced by
 * M3.3 — the rest belong to the future Supplier Portal phase and must render
 * safely (never crash, never imply a delivery that never happened) if they
 * ever appear from newer data. SELECTED is deliberately labeled neutrally
 * ("Выбран") — never "не отправлен"/"ожидает" wording that would imply a
 * failed or pending external action M3.3 doesn't perform (§78).
 */
export const RFQ_SUPPLIER_STATUS_LABELS: Record<RfqSupplierStatus, string> = {
  SELECTED: "Выбран",
  INVITED: "Приглашён",
  VIEWED: "Просмотрено",
  SUBMITTED: "Ответ получен",
  DECLINED: "Отказался",
  EXPIRED: "Срок истёк",
};

export function rfqSupplierStatusClassName(status: RfqSupplierStatus): string {
  switch (status) {
    case "SELECTED":
      return "status-progress";
    case "INVITED":
      return "status-pending";
    case "VIEWED":
      return "status-pending";
    case "SUBMITTED":
      return "status-approved";
    case "DECLINED":
      return "status-rejected";
    case "EXPIRED":
      return "status-cancelled";
    default:
      return "status-draft";
  }
}

/**
 * Deadline is a real instant (Revision 1 §24) — never the UTC-midnight
 * business-date convention `formatBusinessDate` uses for `requiredDate`.
 * Reuses the existing locale-safe `formatDateTime` (pr-labels.ts), which
 * already renders exactly the "17.09.2026, 18:00" shape this phase wants —
 * no second formatter invented for the same job.
 */
export function formatDeadline(iso: string | null | undefined): string {
  if (!iso) return "Не указан";
  return formatDateTime(iso);
}

/**
 * Display-only hint for an overdue SENT RFQ (Phase D §59/§60) — never
 * mutates status, never derives CLOSED/CANCELLED/IN_PROGRESS from it. Purely
 * "is `deadline` in the past, right now". A DRAFT RFQ's deadline is never
 * flagged this way — an unset/future DRAFT deadline isn't "overdue", it just
 * hasn't been sent yet.
 */
export function isDeadlineOverdue(status: RfqStatus, deadline: string | null): boolean {
  if (status !== "SENT" || !deadline) return false;
  return new Date(deadline).getTime() < Date.now();
}
