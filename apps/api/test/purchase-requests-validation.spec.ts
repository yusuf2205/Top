import {
  createPurchaseRequestSchema,
  updatePurchaseRequestSchema,
  purchaseRequestItemInputSchema,
  updatePurchaseRequestItemSchema,
  listPurchaseRequestsQuerySchema,
  assignPurchaseRequestSchema,
  rejectPurchaseRequestSchema,
} from "@top/validation";
import { formatPurchaseRequestNumber } from "../src/common/entity-sequence/purchase-request-number.util";

/**
 * M3.1 Phase C — pure schema/formatter unit tests, no DB, no app bootstrap.
 * Same jest run as every other spec in this repo (testRegex picks up any
 * *.spec.ts under src/ or test/) — packages/validation itself has no test
 * runner of its own (no "test" script), so these live here, mirroring how
 * token.service.spec.ts/password.service.spec.ts are pure unit tests
 * colocated in apps/api rather than requiring a second test harness.
 */

const validFreeTextItem = { itemName: "Copper busbar 20x3", quantity: "500.000", uomCode: "KG" };
const validProductItem = { productId: "11111111-1111-1111-1111-111111111111", quantity: "10.000", uomCode: "KG" };

describe("purchase-requests validation — mass assignment protection", () => {
  const serverControlledCreateFields = [
    { organizationId: "11111111-1111-1111-1111-111111111111" },
    { requesterId: "11111111-1111-1111-1111-111111111111" },
    { requestNumber: "PR-2026-000001" },
    { status: "DRAFT" },
    { assignedBuyerUserId: "11111111-1111-1111-1111-111111111111" },
    { payloadHash: "deadbeef" },
    { cancelledAt: "2026-01-01T00:00:00.000Z" },
    { submittedAt: "2026-01-01T00:00:00.000Z" },
    { id: "11111111-1111-1111-1111-111111111111" },
    { createdAt: "2026-01-01T00:00:00.000Z" },
  ];

  it.each(serverControlledCreateFields)("create rejects server-controlled field %p", (extra) => {
    const result = createPurchaseRequestSchema.safeParse({ items: [validFreeTextItem], ...extra });
    expect(result.success).toBe(false);
  });

  it("create accepts a legitimate minimal payload", () => {
    const result = createPurchaseRequestSchema.safeParse({ items: [validFreeTextItem] });
    expect(result.success).toBe(true);
  });

  it("item input rejects skuSnapshot even without productId", () => {
    const result = purchaseRequestItemInputSchema.safeParse({ ...validFreeTextItem, skuSnapshot: "SKU-1" });
    expect(result.success).toBe(false);
  });

  it("item input rejects skuSnapshot alongside productId", () => {
    const result = purchaseRequestItemInputSchema.safeParse({ ...validProductItem, skuSnapshot: "SKU-1" });
    expect(result.success).toBe(false);
  });

  it("update rejects status/requestNumber/assignedBuyerUserId/organizationId", () => {
    for (const extra of [{ status: "APPROVED" }, { requestNumber: "PR-2026-000001" }, { assignedBuyerUserId: "x" }, { organizationId: "x" }]) {
      const result = updatePurchaseRequestSchema.safeParse({ reason: "ok", ...extra });
      expect(result.success).toBe(false);
    }
  });

  it("item update never exposes productId/itemName/skuSnapshot", () => {
    for (const extra of [{ productId: "11111111-1111-1111-1111-111111111111" }, { itemName: "New name" }, { skuSnapshot: "SKU-1" }]) {
      const result = updatePurchaseRequestItemSchema.safeParse({ quantity: "1.000", ...extra });
      expect(result.success).toBe(false);
    }
  });
});

describe("purchase-requests validation — item mode (product-backed vs free-text)", () => {
  it("product-backed item rejects a client-supplied itemName", () => {
    const result = purchaseRequestItemInputSchema.safeParse({ ...validProductItem, itemName: "Not allowed" });
    expect(result.success).toBe(false);
  });

  it("product-backed item accepts productId with no itemName", () => {
    const result = purchaseRequestItemInputSchema.safeParse(validProductItem);
    expect(result.success).toBe(true);
  });

  it("free-text item requires a non-empty itemName", () => {
    expect(purchaseRequestItemInputSchema.safeParse({ quantity: "1.000", uomCode: "KG" }).success).toBe(false);
    expect(purchaseRequestItemInputSchema.safeParse({ itemName: "", quantity: "1.000", uomCode: "KG" }).success).toBe(false);
    expect(purchaseRequestItemInputSchema.safeParse(validFreeTextItem).success).toBe(true);
  });

  it("neither productId nor itemName supplied is rejected (covered by the itemName-required branch)", () => {
    const result = purchaseRequestItemInputSchema.safeParse({ quantity: "1.000", uomCode: "KG" });
    expect(result.success).toBe(false);
  });
});

describe("purchase-requests validation — decimal quantity", () => {
  const pass = ["1", "1.000", "0.001", "500", "999999.999"];
  const fail = ["0", "0.000", "-1", "-0.001", "abc", "NaN", "Infinity", 1, 1.5, null];

  it.each(pass)("accepts quantity %p", (quantity) => {
    const result = purchaseRequestItemInputSchema.safeParse({ ...validFreeTextItem, quantity });
    expect(result.success).toBe(true);
  });

  it.each(fail)("rejects quantity %p", (quantity) => {
    const result = purchaseRequestItemInputSchema.safeParse({ ...validFreeTextItem, quantity });
    expect(result.success).toBe(false);
  });

  it("enforces at most 3 decimal places (Decimal(18,3))", () => {
    expect(purchaseRequestItemInputSchema.safeParse({ ...validFreeTextItem, quantity: "1.0001" }).success).toBe(false);
  });
});

describe("purchase-requests validation — item count bounds", () => {
  it("rejects zero items", () => {
    expect(createPurchaseRequestSchema.safeParse({ items: [] }).success).toBe(false);
  });

  it("accepts exactly one item", () => {
    expect(createPurchaseRequestSchema.safeParse({ items: [validFreeTextItem] }).success).toBe(true);
  });

  it("accepts exactly 100 items", () => {
    const items = Array.from({ length: 100 }, () => validFreeTextItem);
    expect(createPurchaseRequestSchema.safeParse({ items }).success).toBe(true);
  });

  it("rejects 101 items", () => {
    const items = Array.from({ length: 101 }, () => validFreeTextItem);
    expect(createPurchaseRequestSchema.safeParse({ items }).success).toBe(false);
  });
});

describe("purchase-requests validation — priority", () => {
  it("accepts LOW/NORMAL/HIGH/URGENT", () => {
    for (const priority of ["LOW", "NORMAL", "HIGH", "URGENT"]) {
      expect(createPurchaseRequestSchema.safeParse({ items: [validFreeTextItem], priority }).success).toBe(true);
    }
  });

  it("rejects legacy lowercase values — no compatibility shim", () => {
    for (const priority of ["normal", "high", "low", "urgent"]) {
      expect(createPurchaseRequestSchema.safeParse({ items: [validFreeTextItem], priority }).success).toBe(false);
    }
  });

  it("priority is optional on create (service/DB default NORMAL applies)", () => {
    expect(createPurchaseRequestSchema.safeParse({ items: [validFreeTextItem] }).success).toBe(true);
  });
});

describe("purchase-requests validation — update PATCH", () => {
  it("rejects an empty PATCH object", () => {
    expect(updatePurchaseRequestSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a PATCH with at least one legitimate field", () => {
    expect(updatePurchaseRequestSchema.safeParse({ reason: "updated reason" }).success).toBe(true);
  });

  it("item update rejects an empty PATCH object", () => {
    expect(updatePurchaseRequestItemSchema.safeParse({}).success).toBe(false);
  });
});

describe("purchase-requests validation — list query", () => {
  it("applies default page/pageSize", () => {
    const result = listPurchaseRequestsQuerySchema.parse({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  it("accepts pageSize at the max (100)", () => {
    expect(listPurchaseRequestsQuerySchema.safeParse({ pageSize: "100" }).success).toBe(true);
  });

  it("rejects pageSize over 100 — never silently clamped", () => {
    const result = listPurchaseRequestsQuerySchema.safeParse({ pageSize: "101" });
    expect(result.success).toBe(false);
  });

  it("rejects createdAtFrom after createdAtTo", () => {
    const result = listPurchaseRequestsQuerySchema.safeParse({
      createdAtFrom: "2026-06-01T00:00:00.000Z",
      createdAtTo: "2026-01-01T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("accepts createdAtFrom before createdAtTo", () => {
    const result = listPurchaseRequestsQuerySchema.safeParse({
      createdAtFrom: "2026-01-01T00:00:00.000Z",
      createdAtTo: "2026-06-01T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });
});

describe("purchase-requests validation — assign / reject action contracts", () => {
  it("assign requires a uuid assignedBuyerUserId", () => {
    expect(assignPurchaseRequestSchema.safeParse({ assignedBuyerUserId: "11111111-1111-1111-1111-111111111111" }).success).toBe(true);
    expect(assignPurchaseRequestSchema.safeParse({}).success).toBe(false);
    expect(assignPurchaseRequestSchema.safeParse({ assignedBuyerUserId: "not-a-uuid" }).success).toBe(false);
  });

  it("assign does not allow null (unassign was not approved)", () => {
    expect(assignPurchaseRequestSchema.safeParse({ assignedBuyerUserId: null }).success).toBe(false);
  });

  it("reject requires a non-empty reason", () => {
    expect(rejectPurchaseRequestSchema.safeParse({ reason: "Budget exceeded" }).success).toBe(true);
    expect(rejectPurchaseRequestSchema.safeParse({ reason: "" }).success).toBe(false);
    expect(rejectPurchaseRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("formatPurchaseRequestNumber", () => {
  it("zero-pads to a minimum of 6 digits", () => {
    expect(formatPurchaseRequestNumber(2026, 1)).toBe("PR-2026-000001");
    expect(formatPurchaseRequestNumber(2026, 42)).toBe("PR-2026-000042");
    expect(formatPurchaseRequestNumber(2026, 999999)).toBe("PR-2026-999999");
  });

  it("does not wrap or truncate past 6 digits", () => {
    expect(formatPurchaseRequestNumber(2026, 1000000)).toBe("PR-2026-1000000");
  });
});
