import { DomainEventType, type DomainEvent } from "@top/types";

/** The 5 workflow events this UI reacts to — deliberately excludes _CREATED and any draft-edit event, matching the backend's own realtime contract (Phase F §3). */
const PURCHASE_REQUEST_EVENT_TYPES: ReadonlySet<string> = new Set([
  DomainEventType.PURCHASE_REQUEST_SUBMITTED,
  DomainEventType.PURCHASE_REQUEST_APPROVED,
  DomainEventType.PURCHASE_REQUEST_REJECTED,
  DomainEventType.PURCHASE_REQUEST_ASSIGNED,
  DomainEventType.PURCHASE_REQUEST_CANCELLED,
]);

export function isPurchaseRequestWorkflowEvent(evt: DomainEvent): boolean {
  return evt.entityType === "PurchaseRequest" && PURCHASE_REQUEST_EVENT_TYPES.has(evt.eventType);
}

/** Socket event = invalidation signal only — never treated as complete state; the caller always refetches REST on a match rather than reading `evt.payload` as authoritative. */
export function eventMatchesPurchaseRequest(evt: DomainEvent, purchaseRequestId: string): boolean {
  return isPurchaseRequestWorkflowEvent(evt) && evt.entityId === purchaseRequestId;
}
