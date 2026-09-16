import type { DomainEvent } from "@top/types";
import { eventMatchesPurchaseRequest, isPurchaseRequestWorkflowEvent } from "./pr-realtime-helpers";

function evt(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return {
    eventId: "e1",
    eventType: "PURCHASE_REQUEST_SUBMITTED",
    organizationId: "org-1",
    entityType: "PurchaseRequest",
    entityId: "pr-1",
    actorUserId: "u1",
    occurredAt: new Date().toISOString(),
    version: 1,
    payload: { status: "UNDER_APPROVAL" },
    ...overrides,
  };
}

describe("pr-realtime-helpers", () => {
  it("recognizes all 5 workflow event types", () => {
    for (const eventType of [
      "PURCHASE_REQUEST_SUBMITTED",
      "PURCHASE_REQUEST_APPROVED",
      "PURCHASE_REQUEST_REJECTED",
      "PURCHASE_REQUEST_ASSIGNED",
      "PURCHASE_REQUEST_CANCELLED",
    ] as const) {
      expect(isPurchaseRequestWorkflowEvent(evt({ eventType }))).toBe(true);
    }
  });

  it("does not treat an unrelated entity type or event type as a PR workflow event", () => {
    expect(isPurchaseRequestWorkflowEvent(evt({ entityType: "StockMovement", eventType: "STOCK_MOVEMENT_CREATED" as never }))).toBe(false);
    expect(isPurchaseRequestWorkflowEvent(evt({ eventType: "PRODUCT_CREATED" as never, entityType: "Product" }))).toBe(false);
  });

  it("a matching detail event returns true only for the exact same entityId (current-detail reconciliation)", () => {
    expect(eventMatchesPurchaseRequest(evt({ entityId: "pr-1" }), "pr-1")).toBe(true);
  });

  it("an event for a different purchase request does not trigger reconciliation for the current one", () => {
    expect(eventMatchesPurchaseRequest(evt({ entityId: "pr-2" }), "pr-1")).toBe(false);
  });
});
