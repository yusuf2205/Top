import type { RfqDetail } from "@top/types";
import {
  EMPTY_RFQ_CREATE_FORM,
  buildCreateRfqPayload,
  buildUpdateRfqPayload,
  deadlineLocalToIso,
  fingerprintRfqCreateForm,
  hasRfqHeaderChanges,
  isoToDeadlineLocal,
  rfqDetailToHeaderFormState,
  shouldRegenerateIdempotencyKey,
  validateRfqCreateForm,
  type RfqCreateFormState,
} from "./rfq-payload";

function detail(overrides: Partial<RfqDetail> = {}): RfqDetail {
  return {
    id: "rfq-1",
    rfqNumber: "RFQ-2026-000001",
    status: "DRAFT",
    deadline: null,
    supplierInstructions: null,
    internalNotes: null,
    purchaseRequest: { id: "pr-1", requestNumber: "PR-2026-000001", status: "APPROVED" },
    items: [],
    suppliers: [],
    createdAt: new Date().toISOString(),
    sentAt: null,
    closedAt: null,
    cancelledAt: null,
    cancelReason: null,
    ...overrides,
  };
}

describe("rfq-payload — create form (Phase D §94)", () => {
  it("requires purchaseRequestId", () => {
    expect(validateRfqCreateForm(EMPTY_RFQ_CREATE_FORM)).toBeTruthy();
    expect(validateRfqCreateForm({ ...EMPTY_RFQ_CREATE_FORM, purchaseRequestId: "pr-1" })).toBeNull();
  });

  it("builds a payload with all item/supplier ids when both are populated", () => {
    const state: RfqCreateFormState = {
      ...EMPTY_RFQ_CREATE_FORM,
      purchaseRequestId: "pr-1",
      purchaseRequestItemIds: ["item-1", "item-2"],
      supplierIds: ["sup-1"],
    };
    const payload = buildCreateRfqPayload(state, "idem-key-1");
    expect(payload.purchaseRequestId).toBe("pr-1");
    expect(payload.purchaseRequestItemIds).toEqual(["item-1", "item-2"]);
    expect(payload.supplierIds).toEqual(["sup-1"]);
    expect(payload.idempotencyKey).toBe("idem-key-1");
  });

  it("builds a payload with zero items and zero suppliers — a DRAFT may be empty (Revision 1 D80)", () => {
    const payload = buildCreateRfqPayload({ ...EMPTY_RFQ_CREATE_FORM, purchaseRequestId: "pr-1" }, undefined);
    expect(payload.purchaseRequestItemIds).toEqual([]);
    expect(payload.supplierIds).toEqual([]);
    expect(payload.deadline).toBeUndefined();
    expect(payload.supplierInstructions).toBeUndefined();
    expect(payload.internalNotes).toBeUndefined();
  });

  it("never sends duplicate ids even if the caller's state somehow contains them", () => {
    const state: RfqCreateFormState = {
      ...EMPTY_RFQ_CREATE_FORM,
      purchaseRequestId: "pr-1",
      purchaseRequestItemIds: ["item-1", "item-1", "item-2"],
      supplierIds: ["sup-1", "sup-1"],
    };
    const payload = buildCreateRfqPayload(state, undefined);
    expect(payload.purchaseRequestItemIds).toEqual(["item-1", "item-2"]);
    expect(payload.supplierIds).toEqual(["sup-1"]);
  });

  it("converts a filled deadline to a real ISO instant, never a bare local string", () => {
    const payload = buildCreateRfqPayload({ ...EMPTY_RFQ_CREATE_FORM, purchaseRequestId: "pr-1", deadline: "2026-09-17T18:00" }, undefined);
    expect(payload.deadline).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("trims supplierInstructions/internalNotes and omits them when blank", () => {
    const payload = buildCreateRfqPayload(
      { ...EMPTY_RFQ_CREATE_FORM, purchaseRequestId: "pr-1", supplierInstructions: "  hi  ", internalNotes: "   " },
      undefined
    );
    expect(payload.supplierInstructions).toBe("hi");
    expect(payload.internalNotes).toBeUndefined();
  });

  it("never includes status/rfqNumber/snapshot/token fields — CreateRfqInput's own type already forbids this at compile time", () => {
    const payload = buildCreateRfqPayload({ ...EMPTY_RFQ_CREATE_FORM, purchaseRequestId: "pr-1" }, undefined);
    expect(payload).not.toHaveProperty("status");
    expect(payload).not.toHaveProperty("rfqNumber");
    expect(payload).not.toHaveProperty("portalTokenHash");
  });
});

describe("rfq-payload — deadline instant round-trip", () => {
  it("deadlineLocalToIso returns undefined for an empty value", () => {
    expect(deadlineLocalToIso("")).toBeUndefined();
  });

  it("isoToDeadlineLocal / deadlineLocalToIso round-trip preserves the same instant at minute precision", () => {
    const iso = "2026-09-17T13:00:00.000Z";
    const local = isoToDeadlineLocal(iso);
    const backToIso = deadlineLocalToIso(local);
    // Both conversions go through the SAME local timezone (the test runner's), so the
    // round trip must reproduce the original instant exactly at minute precision.
    expect(new Date(backToIso!).getTime()).toBe(new Date(iso).getTime());
  });
});

describe("rfq-payload — DRAFT header edit / null-clearing (Phase D §95)", () => {
  it("omits every field when nothing changed — a true no-op sends {}", () => {
    const original = detail({ supplierInstructions: "Ship to A", internalNotes: "note", deadline: "2026-09-17T13:00:00.000Z" });
    const state = rfqDetailToHeaderFormState(original);
    const payload = buildUpdateRfqPayload(original, state);
    expect(payload).toEqual({});
    expect(hasRfqHeaderChanges(payload)).toBe(false);
  });

  it("clearing an existing supplierInstructions sends explicit null, never omits it", () => {
    const original = detail({ supplierInstructions: "Ship to A" });
    const state = rfqDetailToHeaderFormState(original);
    const payload = buildUpdateRfqPayload(original, { ...state, supplierInstructions: "" });
    expect(payload.supplierInstructions).toBeNull();
  });

  it("clearing an existing internalNotes sends explicit null", () => {
    const original = detail({ internalNotes: "internal only" });
    const state = rfqDetailToHeaderFormState(original);
    const payload = buildUpdateRfqPayload(original, { ...state, internalNotes: "" });
    expect(payload.internalNotes).toBeNull();
  });

  it("clearing an existing deadline sends explicit null", () => {
    const original = detail({ deadline: "2026-09-17T13:00:00.000Z" });
    const state = rfqDetailToHeaderFormState(original);
    const payload = buildUpdateRfqPayload(original, { ...state, deadline: "" });
    expect(payload.deadline).toBeNull();
  });

  it("a genuine deadline change sends the new ISO instant", () => {
    const original = detail({ deadline: "2026-09-17T13:00:00.000Z" });
    const state = rfqDetailToHeaderFormState(original);
    const payload = buildUpdateRfqPayload(original, { ...state, deadline: "2026-10-01T09:00" });
    expect(payload.deadline).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("a genuine supplierInstructions change sends the trimmed new value", () => {
    const original = detail({ supplierInstructions: "old" });
    const state = rfqDetailToHeaderFormState(original);
    const payload = buildUpdateRfqPayload(original, { ...state, supplierInstructions: "  new value  " });
    expect(payload.supplierInstructions).toBe("new value");
  });

  it("unchanged omitted fields never appear even when other fields do change (dirty builder)", () => {
    const original = detail({ supplierInstructions: "keep me", internalNotes: "keep me too" });
    const state = rfqDetailToHeaderFormState(original);
    const payload = buildUpdateRfqPayload(original, { ...state, deadline: "2026-10-01T09:00" });
    expect(payload).not.toHaveProperty("supplierInstructions");
    expect(payload).not.toHaveProperty("internalNotes");
    expect(payload.deadline).toBeTruthy();
  });
});

describe("rfq-payload — create idempotency logical-attempt fingerprint (Phase E §5)", () => {
  const baseState: RfqCreateFormState = {
    ...EMPTY_RFQ_CREATE_FORM,
    purchaseRequestId: "pr-1",
    purchaseRequestItemIds: ["item-1", "item-2"],
    supplierIds: ["sup-1"],
    deadline: "2026-09-17T18:00",
    supplierInstructions: "ship to A",
    internalNotes: "internal",
  };

  it("first submission never regenerates — lastFingerprint null means 'no attempt yet'", () => {
    const fp = fingerprintRfqCreateForm(baseState);
    expect(shouldRegenerateIdempotencyKey(null, fp)).toBe(false);
  });

  it("identical payload after a failed attempt fingerprints the same — key is reused", () => {
    const fp1 = fingerprintRfqCreateForm(baseState);
    const fp2 = fingerprintRfqCreateForm({ ...baseState }); // a fresh object, same values
    expect(fp1).toBe(fp2);
    expect(shouldRegenerateIdempotencyKey(fp1, fp2)).toBe(false);
  });

  it("array order never matters — reordered item/supplier ids still fingerprint identically (rerender-only case)", () => {
    const fp1 = fingerprintRfqCreateForm(baseState);
    const fp2 = fingerprintRfqCreateForm({ ...baseState, purchaseRequestItemIds: ["item-2", "item-1"], supplierIds: ["sup-1"] });
    expect(fp1).toBe(fp2);
    expect(shouldRegenerateIdempotencyKey(fp1, fp2)).toBe(false);
  });

  it("changed item selection fingerprints differently — triggers a new key", () => {
    const fp1 = fingerprintRfqCreateForm(baseState);
    const fp2 = fingerprintRfqCreateForm({ ...baseState, purchaseRequestItemIds: ["item-1"] });
    expect(fp1).not.toBe(fp2);
    expect(shouldRegenerateIdempotencyKey(fp1, fp2)).toBe(true);
  });

  it("changed supplier selection triggers a new key", () => {
    const fp1 = fingerprintRfqCreateForm(baseState);
    const fp2 = fingerprintRfqCreateForm({ ...baseState, supplierIds: ["sup-1", "sup-2"] });
    expect(fp1).not.toBe(fp2);
    expect(shouldRegenerateIdempotencyKey(fp1, fp2)).toBe(true);
  });

  it("changed deadline triggers a new key", () => {
    const fp1 = fingerprintRfqCreateForm(baseState);
    const fp2 = fingerprintRfqCreateForm({ ...baseState, deadline: "2026-10-01T09:00" });
    expect(fp1).not.toBe(fp2);
    expect(shouldRegenerateIdempotencyKey(fp1, fp2)).toBe(true);
  });

  it("changed supplierInstructions triggers a new key", () => {
    const fp1 = fingerprintRfqCreateForm(baseState);
    const fp2 = fingerprintRfqCreateForm({ ...baseState, supplierInstructions: "different instructions" });
    expect(fp1).not.toBe(fp2);
    expect(shouldRegenerateIdempotencyKey(fp1, fp2)).toBe(true);
  });

  it("changed internalNotes triggers a new key", () => {
    const fp1 = fingerprintRfqCreateForm(baseState);
    const fp2 = fingerprintRfqCreateForm({ ...baseState, internalNotes: "different notes" });
    expect(fp1).not.toBe(fp2);
    expect(shouldRegenerateIdempotencyKey(fp1, fp2)).toBe(true);
  });

  it("changed purchaseRequestId triggers a new key", () => {
    const fp1 = fingerprintRfqCreateForm(baseState);
    const fp2 = fingerprintRfqCreateForm({ ...baseState, purchaseRequestId: "pr-2" });
    expect(fp1).not.toBe(fp2);
    expect(shouldRegenerateIdempotencyKey(fp1, fp2)).toBe(true);
  });

  it("whitespace-only edits to text fields do NOT count as a change (trimmed before fingerprinting)", () => {
    const fp1 = fingerprintRfqCreateForm(baseState);
    const fp2 = fingerprintRfqCreateForm({ ...baseState, supplierInstructions: "  ship to A  " });
    expect(fp1).toBe(fp2);
  });
});
