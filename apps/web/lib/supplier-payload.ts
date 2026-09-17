import type { SupplierContactView, SupplierDetail } from "@top/types";
import type {
  CreateSupplierContactInput,
  CreateSupplierInput,
  UpdateSupplierContactInput,
  UpdateSupplierInput,
} from "@top/validation";

/**
 * Payload builders for Supplier Master forms (Phase D §26/§64). The backend
 * distinguishes an OMITTED optional field (leave unchanged) from an explicit
 * `null` (clear it) — see packages/validation/src/suppliers.ts's `clearable()`.
 * These builders reproduce that distinction from plain string form state by
 * diffing against the originally-loaded value:
 *
 *   trimmed === original  -> omit (undefined) — no real change, avoids a no-op PATCH field
 *   trimmed === ""         -> null            — user cleared a field that had a value
 *   trimmed === new value  -> the new value   — a genuine change
 *
 * Never uses Number()/parseFloat() anywhere — every field here is a string
 * all the way through, exactly as PurchaseRequest's buildItemInput keeps
 * quantity as a raw string (pr-item-payload.ts).
 */
function diffClearable(current: string, original: string | null): string | null | undefined {
  const trimmed = current.trim();
  const originalValue = original ?? "";
  if (trimmed === originalValue) return undefined;
  if (trimmed === "") return null;
  return trimmed;
}

// ────────────────────────────────────────────────────────────
// SUPPLIER — shared field shape (create + general edit render the same
// input set; only the payload-building semantics differ — create has no
// null-clearing concept, edit diffs against the originally-loaded value).
// ────────────────────────────────────────────────────────────

export interface SupplierFormState {
  companyName: string;
  legalName: string;
  tin: string;
  countryCode: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  notes: string;
}

export const EMPTY_SUPPLIER_CREATE_FORM: SupplierFormState = {
  companyName: "",
  legalName: "",
  tin: "",
  countryCode: "UZ",
  address: "",
  phone: "",
  email: "",
  website: "",
  notes: "",
};

export function validateSupplierCreateForm(state: SupplierFormState): string | null {
  if (!state.companyName.trim()) return "Укажите название компании.";
  return null;
}

/**
 * Create never sends null — every optional field is either a trimmed value
 * or omitted entirely (createSupplierSchema has no `clearable()` fields).
 * `idempotencyKey` is typed `string | undefined` to match the ref-read
 * pattern in app/suppliers/new/page.tsx exactly (same as
 * purchase-requests/new/page.tsx's own idempotencyKeyRef.current usage) —
 * the field is optional on CreateSupplierInput regardless.
 */
export function buildCreateSupplierPayload(state: SupplierFormState, idempotencyKey: string | undefined): CreateSupplierInput {
  return {
    companyName: state.companyName.trim(),
    legalName: state.legalName.trim() || undefined,
    tin: state.tin.trim() || undefined,
    countryCode: state.countryCode.trim().toUpperCase() || undefined,
    address: state.address.trim() || undefined,
    phone: state.phone.trim() || undefined,
    email: state.email.trim() || undefined,
    website: state.website.trim() || undefined,
    notes: state.notes.trim() || undefined,
    idempotencyKey,
  };
}

// ────────────────────────────────────────────────────────────
// SUPPLIER — general edit (dirty + null-clearing)
// ────────────────────────────────────────────────────────────

export function supplierDetailToFormState(detail: SupplierDetail): SupplierFormState {
  return {
    companyName: detail.companyName,
    legalName: detail.legalName ?? "",
    tin: detail.tin ?? "",
    countryCode: detail.countryCode ?? "",
    address: detail.address ?? "",
    phone: detail.phone ?? "",
    email: detail.email ?? "",
    website: detail.website ?? "",
    notes: detail.notes ?? "",
  };
}

/**
 * Critical case (Phase D §64): an existing tin/phone value cleared by the
 * user must produce `{ tin: null, phone: null }`, never omit them. An
 * untouched field is omitted so a true no-op PATCH sends `{}` and the
 * caller can skip the request entirely (§27).
 */
export function buildUpdateSupplierPayload(original: SupplierDetail, state: SupplierFormState): UpdateSupplierInput {
  const payload: UpdateSupplierInput = {};

  const companyName = state.companyName.trim();
  if (companyName && companyName !== original.companyName) payload.companyName = companyName;

  const legalName = diffClearable(state.legalName, original.legalName);
  if (legalName !== undefined) payload.legalName = legalName;

  const tin = diffClearable(state.tin, original.tin);
  if (tin !== undefined) payload.tin = tin;

  const countryCode = diffClearable(state.countryCode.toUpperCase(), original.countryCode);
  if (countryCode !== undefined) payload.countryCode = countryCode;

  const address = diffClearable(state.address, original.address);
  if (address !== undefined) payload.address = address;

  const phone = diffClearable(state.phone, original.phone);
  if (phone !== undefined) payload.phone = phone;

  const email = diffClearable(state.email, original.email);
  if (email !== undefined) payload.email = email;

  const website = diffClearable(state.website, original.website);
  if (website !== undefined) payload.website = website;

  const notes = diffClearable(state.notes, original.notes);
  if (notes !== undefined) payload.notes = notes;

  return payload;
}

export function hasSupplierChanges(payload: UpdateSupplierInput): boolean {
  return Object.keys(payload).length > 0;
}

// ────────────────────────────────────────────────────────────
// CONTACTS — create
// ────────────────────────────────────────────────────────────

export interface ContactFormState {
  fullName: string;
  position: string;
  phone: string;
  email: string;
  telegram: string;
  isPrimary: boolean;
}

export const EMPTY_CONTACT_FORM: ContactFormState = {
  fullName: "",
  position: "",
  phone: "",
  email: "",
  telegram: "",
  isPrimary: false,
};

export function validateContactForm(state: ContactFormState): string | null {
  if (!state.fullName.trim()) return "Укажите имя контакта.";
  return null;
}

/** `active` is never client-sent — the backend sets it (Phase D §35). */
export function buildCreateContactPayload(state: ContactFormState): CreateSupplierContactInput {
  return {
    fullName: state.fullName.trim(),
    position: state.position.trim() || undefined,
    phone: state.phone.trim() || undefined,
    email: state.email.trim() || undefined,
    telegram: state.telegram.trim() || undefined,
    isPrimary: state.isPrimary || undefined,
  };
}

// ────────────────────────────────────────────────────────────
// CONTACTS — edit (dirty + null-clearing)
// ────────────────────────────────────────────────────────────

export function contactToFormState(contact: SupplierContactView): ContactFormState {
  return {
    fullName: contact.fullName,
    position: contact.position ?? "",
    phone: contact.phone ?? "",
    email: contact.email ?? "",
    telegram: contact.telegram ?? "",
    isPrimary: contact.isPrimary,
  };
}

/** `active` is never client-sent — archiving is a dedicated endpoint, never a PATCH field (Phase D §36). */
export function buildUpdateContactPayload(original: SupplierContactView, state: ContactFormState): UpdateSupplierContactInput {
  const payload: UpdateSupplierContactInput = {};

  const fullName = state.fullName.trim();
  if (fullName && fullName !== original.fullName) payload.fullName = fullName;

  const position = diffClearable(state.position, original.position);
  if (position !== undefined) payload.position = position;

  const phone = diffClearable(state.phone, original.phone);
  if (phone !== undefined) payload.phone = phone;

  const email = diffClearable(state.email, original.email);
  if (email !== undefined) payload.email = email;

  const telegram = diffClearable(state.telegram, original.telegram);
  if (telegram !== undefined) payload.telegram = telegram;

  if (state.isPrimary !== original.isPrimary) payload.isPrimary = state.isPrimary;

  return payload;
}

export function hasContactChanges(payload: UpdateSupplierContactInput): boolean {
  return Object.keys(payload).length > 0;
}
