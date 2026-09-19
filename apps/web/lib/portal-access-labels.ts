import type { QuoteSource, RfqSupplierStatus } from "@top/types";

/**
 * M3.4 Phase D §3/§16/§25/§26 — Supplier Portal access-state labels. Portal
 * credential state (`portalAccessActive`) is deliberately SEPARATE from
 * participation status (`RfqSupplierStatus`) — Revoke leaves `status`
 * unchanged (Architecture §14), so `status` alone can never tell the UI
 * whether a link is currently usable. This module never infers
 * `portalAccessActive` from `status` — both are always taken as given.
 */

/** SELECTED never has an issued credential (Invite is the only status->INVITED transition) — always the neutral "not yet invited" label, independent of `active` (which is always false in this state by construction). */
export function getPortalAccessLabel(status: RfqSupplierStatus, active: boolean): string {
  switch (status) {
    case "SELECTED":
      return "Не приглашён";
    case "EXPIRED":
      return "Срок доступа истёк";
    case "INVITED":
    case "VIEWED":
      return active ? "Ссылка активна" : "Доступ отозван";
    case "SUBMITTED":
      return active ? "Предложение получено · доступ активен" : "Предложение получено · доступ отозван";
    case "DECLINED":
      return active ? "Отказался · доступ активен" : "Отказался · доступ отозван";
    default:
      return active ? "Ссылка активна" : "Доступ отозван";
  }
}

/** Green/pending/neutral status-badge class, reusing the exact same palette globals.css already defines for RfqSupplierStatusBadge — no new colors invented. */
export function portalAccessClassName(status: RfqSupplierStatus, active: boolean): string {
  if (status === "SELECTED") return "status-draft";
  if (status === "EXPIRED") return "status-cancelled";
  if (active) return "status-approved";
  return "status-rejected";
}

/**
 * Which action buttons are available for a given (status, portalAccessActive)
 * pair (Phase D §1). Deliberately returns a plain description rather than
 * JSX, so it stays unit-testable without jsdom/React.
 */
export interface PortalAccessActions {
  canCreate: boolean;
  canReissue: boolean;
  canRevoke: boolean;
}

export function getPortalAccessActions(status: RfqSupplierStatus, active: boolean): PortalAccessActions {
  return {
    canCreate: status === "SELECTED" && !active,
    // Reissue is offered whenever a credential exists (active) and status is
    // one of the reissuable states the backend itself allows (Revision 1
    // §14) — SUBMITTED/EXPIRED are deliberately excluded even if `active`
    // happened to be true, since the backend would reject those anyway.
    canReissue: active && (status === "INVITED" || status === "VIEWED" || status === "DECLINED"),
    canRevoke: active,
  };
}

export function formatPortalExpiry(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

/** Phase D §4/§26 — internal-only (never shown on the external portal, which has no `source` field at all). `null` means a pre-addendum/legacy row and must never be guessed as any specific channel. */
const QUOTE_SOURCE_LABELS: Record<QuoteSource, string> = {
  PORTAL: "Портал поставщика",
  MANUAL: "Вручную",
  FILE_IMPORT: "Файл",
  EMAIL: "Email",
  TELEGRAM: "Telegram",
  WHATSAPP: "WhatsApp",
};

export function getQuoteSourceLabel(source: QuoteSource | null): string {
  if (source === null) return "Источник неизвестен";
  return QUOTE_SOURCE_LABELS[source] ?? "Источник неизвестен";
}
