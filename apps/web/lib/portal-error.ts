/**
 * M3.4 Phase D Final UX Fix — classifies a portal API failure into one of a
 * small, closed set of UI states, each with its own fixed Russian message.
 * Deliberately never distinguishes missing/unknown/expired/revoked for 401
 * (the backend itself intentionally returns the identical generic message
 * for all four). For 409, the backend's own `message` is NEVER rendered
 * verbatim to the Supplier — it is only used, internally, to select one of
 * a small known set of Russian UI strings via `mapConflictMessage` below;
 * an unrecognized backend message (or none at all) always falls back to a
 * generic safe message, never the raw text. This is deliberate defense in
 * depth: even though today's backend messages are all bounded, non-leaking
 * business text (never a stack trace/Prisma/internal-field name), the
 * Supplier-facing UI must never depend on that staying true forever — a
 * future backend wording change (or a new conflict branch someone adds
 * later) must not silently start leaking English/domain terminology to a
 * Supplier just because the frontend happened to pass it through unchanged.
 */

export type PortalErrorKind = "invalid-link" | "conflict" | "rate-limited" | "server-error" | "network-error";

export interface PortalErrorState {
  kind: PortalErrorKind;
  message: string;
}

const RATE_LIMIT_MESSAGE = "Слишком много запросов. Подождите немного и попробуйте снова.";
const SERVER_ERROR_MESSAGE = "Временная ошибка сервера. Попробуйте немного позже.";
const NETWORK_ERROR_MESSAGE = "Не удалось связаться с сервером. Проверьте подключение и попробуйте снова.";
const INVALID_LINK_MESSAGE = "Ссылка недействительна или срок её действия истёк.";

const ALREADY_SUBMITTED_MESSAGE = "Предложение уже было отправлено и не может быть изменено.";
const ALREADY_DECLINED_MESSAGE = "Вы уже отказались от участия в этом запросе.";
const RESPONSES_CLOSED_MESSAGE = "Приём предложений по этому запросу завершён.";
const GENERIC_CONFLICT_MESSAGE = "Это действие сейчас недоступно.";

/**
 * Known, exact/prefix backend 409 messages (apps/api/src/portal/
 * portal.service.ts, `submitQuote`/`decline`/`open`) mapped to a fixed
 * Russian UI string. This is a CLOSED allow-list, not a denylist — anything
 * not explicitly recognized here falls through to `GENERIC_CONFLICT_MESSAGE`
 * (never the raw string). Grouped by end-user meaning, not 1:1 with backend
 * wording — e.g. "RFQ is not open for submission (status CLOSED)" and
 * "Submission deadline has passed" are different backend checks but the
 * same Supplier-facing fact: responses are no longer being accepted.
 */
const EXACT_CONFLICT_MESSAGES: Record<string, string> = {
  "Quote already submitted": ALREADY_SUBMITTED_MESSAGE,
  "Quote already submitted with a different payload": ALREADY_SUBMITTED_MESSAGE,
  "Quote already submitted through another intake channel": ALREADY_SUBMITTED_MESSAGE,
  "A quote has already been submitted": ALREADY_SUBMITTED_MESSAGE,
  "Quote already declined": ALREADY_DECLINED_MESSAGE,
  "Response deadline has passed": RESPONSES_CLOSED_MESSAGE,
  "Submission deadline has passed": RESPONSES_CLOSED_MESSAGE,
};
const PREFIX_CONFLICT_MESSAGES: Array<[prefix: string, message: string]> = [
  ["RFQ is not open for a response", RESPONSES_CLOSED_MESSAGE],
  ["RFQ is not open for submission", RESPONSES_CLOSED_MESSAGE],
];

/** Never returns the raw input — always one of the fixed Russian strings above. */
function mapConflictMessage(backendMessage: string | undefined): string {
  if (!backendMessage) return GENERIC_CONFLICT_MESSAGE;
  const exact = EXACT_CONFLICT_MESSAGES[backendMessage];
  if (exact) return exact;
  for (const [prefix, message] of PREFIX_CONFLICT_MESSAGES) {
    if (backendMessage.startsWith(prefix)) return message;
  }
  return GENERIC_CONFLICT_MESSAGE;
}

/**
 * `backendMessage` is the raw `message` field from the portal API's error
 * body — passed in ONLY so `mapConflictMessage` can look it up against the
 * known allow-list above; it is never itself returned to the caller.
 */
export function classifyPortalError(statusCode: number | null, backendMessage?: string): PortalErrorState {
  if (statusCode === 401) return { kind: "invalid-link", message: INVALID_LINK_MESSAGE };
  if (statusCode === 409) return { kind: "conflict", message: mapConflictMessage(backendMessage) };
  if (statusCode === 429) return { kind: "rate-limited", message: RATE_LIMIT_MESSAGE };
  if (statusCode !== null && statusCode >= 500) return { kind: "server-error", message: SERVER_ERROR_MESSAGE };
  return { kind: "network-error", message: NETWORK_ERROR_MESSAGE };
}
