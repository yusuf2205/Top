import type { SupplierContactView, SupplierDetail } from "@top/types";
import {
  EMPTY_CONTACT_FORM,
  EMPTY_SUPPLIER_CREATE_FORM,
  buildCreateContactPayload,
  buildCreateSupplierPayload,
  buildUpdateContactPayload,
  buildUpdateSupplierPayload,
  contactToFormState,
  hasContactChanges,
  hasSupplierChanges,
  supplierDetailToFormState,
  validateContactForm,
  validateSupplierCreateForm,
  type ContactFormState,
  type SupplierFormState,
} from "./supplier-payload";

function detail(overrides: Partial<SupplierDetail> = {}): SupplierDetail {
  return {
    id: "sup-1",
    supplierCode: "SUP-000001",
    companyName: "Acme LLC",
    legalName: null,
    tin: null,
    countryCode: null,
    address: null,
    phone: null,
    email: null,
    website: null,
    rating: null,
    status: "ACTIVE",
    notes: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    contacts: [],
    categories: [],
    ...overrides,
  };
}

function contact(overrides: Partial<SupplierContactView> = {}): SupplierContactView {
  return {
    id: "c-1",
    supplierId: "sup-1",
    fullName: "Ivan Ivanov",
    position: null,
    phone: null,
    email: null,
    telegram: null,
    isPrimary: false,
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("supplier-payload — create form (Phase D §78)", () => {
  it("requires companyName", () => {
    expect(validateSupplierCreateForm(EMPTY_SUPPLIER_CREATE_FORM)).not.toBeNull();
    expect(validateSupplierCreateForm({ ...EMPTY_SUPPLIER_CREATE_FORM, companyName: "Acme" })).toBeNull();
  });

  it("optional values trim and omit when blank; country uppercases", () => {
    const state: SupplierFormState = { ...EMPTY_SUPPLIER_CREATE_FORM, companyName: "Acme", countryCode: "uz", tin: "  123  " };
    const payload = buildCreateSupplierPayload(state, "key-1");
    expect(payload.countryCode).toBe("UZ");
    expect(payload.tin).toBe("123");
    expect(payload.legalName).toBeUndefined();
    expect(payload.address).toBeUndefined();
  });

  it("never includes status/rating/supplierCode — the create DTO has no such fields to begin with", () => {
    const payload = buildCreateSupplierPayload({ ...EMPTY_SUPPLIER_CREATE_FORM, companyName: "Acme" }, "key-1");
    expect(payload).not.toHaveProperty("status");
    expect(payload).not.toHaveProperty("rating");
    expect(payload).not.toHaveProperty("supplierCode");
    expect(payload).not.toHaveProperty("normalizedTin");
    expect(payload).not.toHaveProperty("bankName");
  });

  it("idempotencyKey is passed through exactly, only via the dedicated create contract", () => {
    const payload = buildCreateSupplierPayload({ ...EMPTY_SUPPLIER_CREATE_FORM, companyName: "Acme" }, "stable-key-abc");
    expect(payload.idempotencyKey).toBe("stable-key-abc");
  });
});

describe("supplier-payload — update payload null-clearing (Phase D §26/§64/§79)", () => {
  it("clearing an existing tin and phone sends null for both, not omitted", () => {
    const original = detail({ tin: "123456789", phone: "+998901234567" });
    const state: SupplierFormState = { ...supplierDetailToFormState(original), tin: "", phone: "" };
    const payload = buildUpdateSupplierPayload(original, state);
    expect(payload.tin).toBeNull();
    expect(payload.phone).toBeNull();
  });

  it("clearing email and notes sends null", () => {
    const original = detail({ email: "a@b.com", notes: "some note" });
    const state: SupplierFormState = { ...supplierDetailToFormState(original), email: "", notes: "" };
    const payload = buildUpdateSupplierPayload(original, state);
    expect(payload.email).toBeNull();
    expect(payload.notes).toBeNull();
  });

  it("an unchanged field is omitted, not resent", () => {
    const original = detail({ legalName: "Acme Legal", address: "Main St 1" });
    const state: SupplierFormState = supplierDetailToFormState(original);
    const payload = buildUpdateSupplierPayload(original, state);
    expect(payload).not.toHaveProperty("legalName");
    expect(payload).not.toHaveProperty("address");
    expect(hasSupplierChanges(payload)).toBe(false);
  });

  it("a genuinely changed field sends its new trimmed value", () => {
    const original = detail({ address: "Old address" });
    const state: SupplierFormState = { ...supplierDetailToFormState(original), address: "  New address  " };
    const payload = buildUpdateSupplierPayload(original, state);
    expect(payload.address).toBe("New address");
  });

  it("a field that was already empty and stays empty is omitted, not sent as null again", () => {
    const original = detail({ website: null });
    const state: SupplierFormState = supplierDetailToFormState(original);
    const payload = buildUpdateSupplierPayload(original, state);
    expect(payload).not.toHaveProperty("website");
  });

  it("status/rating/supplierCode are never part of the update payload shape", () => {
    const original = detail();
    const payload = buildUpdateSupplierPayload(original, supplierDetailToFormState(original));
    expect(payload).not.toHaveProperty("status");
    expect(payload).not.toHaveProperty("rating");
    expect(payload).not.toHaveProperty("supplierCode");
    expect(payload).not.toHaveProperty("normalizedTin");
  });

  it("companyName is only included when actually changed (never clearable to null)", () => {
    const original = detail({ companyName: "Acme" });
    const unchanged = buildUpdateSupplierPayload(original, supplierDetailToFormState(original));
    expect(unchanged).not.toHaveProperty("companyName");

    const changed = buildUpdateSupplierPayload(original, { ...supplierDetailToFormState(original), companyName: "New Name" });
    expect(changed.companyName).toBe("New Name");
  });
});

describe("supplier-payload — contact payload (Phase D §80)", () => {
  it("create: fullName required, optional fields trimmed-or-omitted, active never sent", () => {
    expect(validateContactForm(EMPTY_CONTACT_FORM)).not.toBeNull();
    const state: ContactFormState = { ...EMPTY_CONTACT_FORM, fullName: "Ivan" };
    const payload = buildCreateContactPayload(state);
    expect(payload.fullName).toBe("Ivan");
    expect(payload.position).toBeUndefined();
    expect(payload).not.toHaveProperty("active");
  });

  it("update: clearing position/phone/email/telegram sends null for each", () => {
    const original = contact({ position: "Manager", phone: "+998901234567", email: "a@b.com", telegram: "@ivan" });
    const state: ContactFormState = { ...contactToFormState(original), position: "", phone: "", email: "", telegram: "" };
    const payload = buildUpdateContactPayload(original, state);
    expect(payload.position).toBeNull();
    expect(payload.phone).toBeNull();
    expect(payload.email).toBeNull();
    expect(payload.telegram).toBeNull();
  });

  it("update: fullName is required/non-null — omitted when unchanged, never sent as null", () => {
    const original = contact({ fullName: "Ivan" });
    const unchanged = buildUpdateContactPayload(original, contactToFormState(original));
    expect(unchanged).not.toHaveProperty("fullName");
    expect(unchanged).not.toHaveProperty("active");
  });

  it("update: unchanged optional fields are omitted", () => {
    const original = contact({ position: "Manager" });
    const payload = buildUpdateContactPayload(original, contactToFormState(original));
    expect(hasContactChanges(payload)).toBe(false);
  });

  it("update: isPrimary only included when it actually changes", () => {
    const original = contact({ isPrimary: false });
    const unchanged = buildUpdateContactPayload(original, contactToFormState(original));
    expect(unchanged).not.toHaveProperty("isPrimary");

    const changed = buildUpdateContactPayload(original, { ...contactToFormState(original), isPrimary: true });
    expect(changed.isPrimary).toBe(true);
  });
});
