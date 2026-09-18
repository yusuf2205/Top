import type { RfqDetail } from "@top/types";
import type { CreateRfqInput, UpdateRfqInput } from "@top/validation";

/**
 * Payload builders for the internal RFQ create/header-edit forms (Phase D
 * §30-31/§41-42). Same `diffClearable` discipline as supplier-payload.ts: the
 * backend distinguishes an OMITTED optional field (leave unchanged) from an
 * explicit `null` (clear it) — packages/validation/src/rfqs.ts's
 * `clearable()`. Array order never matters for correctness — the backend's
 * `computeRfqCreateHash` already normalizes/sorts before hashing (Revision 1
 * §21) — deduping here is only to avoid sending an obviously malformed
 * duplicate-id array the DTO would otherwise reject with a 400.
 */
function diffClearable(current: string, original: string | null): string | null | undefined {
  const trimmed = current.trim();
  const originalValue = original ?? "";
  if (trimmed === originalValue) return undefined;
  if (trimmed === "") return null;
  return trimmed;
}

/**
 * `deadline` is a real instant (Revision 1 §24) — an HTML `datetime-local`
 * input value ("YYYY-MM-DDTHH:mm", no timezone) is interpreted by `new
 * Date(...)` in the *browser's own local timezone*, exactly what a user
 * picking "17.09.2026 18:00" on their own machine means. `.toISOString()`
 * then converts that instant to its canonical UTC form for the wire — never
 * sent as a bare local string (Phase D §26).
 */
export function deadlineLocalToIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

/** Inverse of deadlineLocalToIso — renders a persisted UTC instant back into the local wall-clock value a `datetime-local` input expects, minute precision (the input has no seconds control). */
export function isoToDeadlineLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ────────────────────────────────────────────────────────────
// CREATE
// ────────────────────────────────────────────────────────────

export interface RfqCreateFormState {
  purchaseRequestId: string;
  purchaseRequestItemIds: string[];
  supplierIds: string[];
  /** "" or a `datetime-local` input value. */
  deadline: string;
  supplierInstructions: string;
  internalNotes: string;
}

export const EMPTY_RFQ_CREATE_FORM: RfqCreateFormState = {
  purchaseRequestId: "",
  purchaseRequestItemIds: [],
  supplierIds: [],
  deadline: "",
  supplierInstructions: "",
  internalNotes: "",
};

/** A DRAFT RFQ may have zero items and zero suppliers (Revision 1 D80/§19) — the only hard requirement client-side is a source PR. */
export function validateRfqCreateForm(state: RfqCreateFormState): string | null {
  if (!state.purchaseRequestId) return "Выберите заявку — источник RFQ.";
  return null;
}

/**
 * Never sends `status`/`rfqNumber`/snapshot fields/token fields — those are
 * entirely server-derived (Phase D §94). `idempotencyKey` is typed
 * `string | undefined` to match the `useRef`-per-page-mount pattern already
 * established by purchase-requests/new and suppliers/new.
 */
export function buildCreateRfqPayload(state: RfqCreateFormState, idempotencyKey: string | undefined): CreateRfqInput {
  return {
    purchaseRequestId: state.purchaseRequestId,
    purchaseRequestItemIds: [...new Set(state.purchaseRequestItemIds)],
    supplierIds: [...new Set(state.supplierIds)],
    deadline: deadlineLocalToIso(state.deadline),
    supplierInstructions: state.supplierInstructions.trim() || undefined,
    internalNotes: state.internalNotes.trim() || undefined,
    idempotencyKey,
  };
}

/**
 * Phase E §5 — a single `useRef` idempotency key is only correct while the
 * BUSINESS payload stays the same across a retry. If the user changes the
 * PR/items/suppliers/deadline/instructions/notes after a failed submit and
 * retries, blindly reusing the old key makes the backend correctly reject it
 * with 409 "idempotencyKey was already used with a different request
 * payload" — a confusing dead end for a perfectly legitimate edit-and-retry.
 *
 * This is a deterministic, non-cryptographic fingerprint of exactly the
 * fields that matter for that comparison — same normalization
 * (dedupe+sort ids, real ISO instant, trimmed-or-null text) `buildCreateRfqPayload`
 * itself applies, so two form states that would produce the SAME outbound
 * payload always fingerprint identically regardless of unrelated re-renders
 * (Phase E explicitly forbids duplicating the backend's own canonical-hash
 * logic here — this never needs to be collision-proof against a hostile
 * actor, only stable for one browser tab's own retry detection).
 */
export function fingerprintRfqCreateForm(state: RfqCreateFormState): string {
  return JSON.stringify({
    purchaseRequestId: state.purchaseRequestId,
    purchaseRequestItemIds: [...new Set(state.purchaseRequestItemIds)].sort(),
    supplierIds: [...new Set(state.supplierIds)].sort(),
    deadline: deadlineLocalToIso(state.deadline) ?? null,
    supplierInstructions: state.supplierInstructions.trim() || null,
    internalNotes: state.internalNotes.trim() || null,
  });
}

/**
 * The actual regeneration decision, isolated as a pure function so it's
 * testable without a React harness. `lastFingerprint === null` means "no
 * attempt has been submitted yet" — the already-created key from page-mount
 * is used as-is, never regenerated before a first attempt even exists
 * (Phase E: "Do NOT regenerate simply on render"). Only a fingerprint that
 * genuinely differs from the LAST SUBMITTED attempt triggers a fresh key —
 * retrying the identical payload after a network/unknown failure keeps the
 * same key on purpose, so a first request that actually landed server-side
 * is still recoverable via the backend's own idempotent replay (Phase E §6).
 */
export function shouldRegenerateIdempotencyKey(lastSubmittedFingerprint: string | null, currentFingerprint: string): boolean {
  return lastSubmittedFingerprint !== null && currentFingerprint !== lastSubmittedFingerprint;
}

// ────────────────────────────────────────────────────────────
// DRAFT HEADER EDIT (dirty + null-clearing)
// ────────────────────────────────────────────────────────────

export interface RfqHeaderFormState {
  /** "" or a `datetime-local` input value. */
  deadline: string;
  supplierInstructions: string;
  internalNotes: string;
}

export function rfqDetailToHeaderFormState(detail: RfqDetail): RfqHeaderFormState {
  return {
    deadline: detail.deadline ? isoToDeadlineLocal(detail.deadline) : "",
    supplierInstructions: detail.supplierInstructions ?? "",
    internalNotes: detail.internalNotes ?? "",
  };
}

/**
 * Critical case (Phase D §42): an existing supplierInstructions/internalNotes/
 * deadline cleared by the user must produce an explicit `null`, never be
 * omitted. An untouched field is omitted so a true no-op edit sends `{}` and
 * the caller can skip the PATCH request entirely.
 */
export function buildUpdateRfqPayload(original: RfqDetail, state: RfqHeaderFormState): UpdateRfqInput {
  const payload: UpdateRfqInput = {};

  const originalDeadlineLocal = original.deadline ? isoToDeadlineLocal(original.deadline) : "";
  if (state.deadline !== originalDeadlineLocal) {
    payload.deadline = state.deadline ? (deadlineLocalToIso(state.deadline) ?? null) : null;
  }

  const supplierInstructions = diffClearable(state.supplierInstructions, original.supplierInstructions);
  if (supplierInstructions !== undefined) payload.supplierInstructions = supplierInstructions;

  const internalNotes = diffClearable(state.internalNotes, original.internalNotes);
  if (internalNotes !== undefined) payload.internalNotes = internalNotes;

  return payload;
}

export function hasRfqHeaderChanges(payload: UpdateRfqInput): boolean {
  return Object.keys(payload).length > 0;
}
