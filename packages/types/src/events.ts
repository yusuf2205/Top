import type { StockMovementType } from "./index";
import type { ProductType } from "./index";

/**
 * Realtime Foundation — the shared domain-event contract. Deliberately in
 * `packages/types` (not `packages/database` or the API app): this file must
 * stay importable from a browser bundle (Next.js web today, Flutter mobile
 * later via a generated/mirrored contract) and from `apps/api`'s server
 * code alike, so it carries zero Prisma/Nest/Node-only imports — plain
 * string/number/boolean fields only, same discipline as every other file in
 * this package.
 *
 * PostgreSQL remains the source of truth; this contract is a delivery
 * mechanism only. A client that never receives a given event (disconnected,
 * server restarted between commit and publish, etc.) must still end up
 * correct by reconciling through the existing REST/read APIs — nothing here
 * is meant to be replayed or persisted client-side as authoritative history.
 */

export const DomainEventType = {
  STOCK_MOVEMENT_CREATED: "STOCK_MOVEMENT_CREATED",
  PRODUCT_CREATED: "PRODUCT_CREATED",
  // M3.1 Phase F — workflow transitions only (Phase F §3): no
  // PURCHASE_REQUEST_CREATED and no DRAFT-edit events (_UPDATED/
  // _ITEM_ADDED/_ITEM_UPDATED/_ITEM_REMOVED) — draft churn is deliberately
  // not broadcast, same "meaningful business transition" bar as every other
  // event in this contract.
  PURCHASE_REQUEST_SUBMITTED: "PURCHASE_REQUEST_SUBMITTED",
  PURCHASE_REQUEST_APPROVED: "PURCHASE_REQUEST_APPROVED",
  PURCHASE_REQUEST_REJECTED: "PURCHASE_REQUEST_REJECTED",
  PURCHASE_REQUEST_ASSIGNED: "PURCHASE_REQUEST_ASSIGNED",
  PURCHASE_REQUEST_CANCELLED: "PURCHASE_REQUEST_CANCELLED",
} as const;
export type DomainEventType = (typeof DomainEventType)[keyof typeof DomainEventType];

/**
 * The single Socket.IO event name every domain event is emitted under —
 * `eventType` inside the payload is what discriminates, not the socket
 * event name itself. Keeps the client-side listener surface to exactly one
 * `socket.on(REALTIME_EVENT_NAME, ...)` regardless of how many event types
 * this foundation eventually grows to.
 */
export const REALTIME_EVENT_NAME = "domain-event";

/** The sole broadcast scope for this foundation — see events.ts's own module doc comment. Never derived from anything client-supplied. */
export function organizationRoom(organizationId: string): string {
  return `org:${organizationId}`;
}

/**
 * Compact by design (see the Realtime Foundation prompt's own PERFORMANCE
 * section) — identifiers and a small discriminating payload only, never a
 * full entity row. A client fetches complete authoritative data through the
 * existing REST APIs; this is a "something changed, go look" signal, not a
 * data feed.
 */
export interface DomainEvent<TPayload = Record<string, unknown>> {
  eventId: string;
  eventType: DomainEventType;
  organizationId: string;
  entityType: string;
  entityId: string;
  actorUserId: string;
  occurredAt: string;
  version: number;
  payload: TPayload;
}

export interface StockMovementCreatedPayload {
  type: StockMovementType;
}
export type StockMovementCreatedEvent = DomainEvent<StockMovementCreatedPayload>;

export interface ProductCreatedPayload {
  sku: string;
  productType: ProductType;
}
export type ProductCreatedEvent = DomainEvent<ProductCreatedPayload>;

// M3.1 Phase F — deliberately tiny, invalidation-signal payloads (Phase F
// §5): never the full PurchaseRequest, items[], approval history, AuditLog,
// payloadHash/idempotencyKey, or a rejection reason. REST remains the
// authoritative source for all of that; a client refetches on receipt.
export interface PurchaseRequestSubmittedPayload {
  status: "UNDER_APPROVAL";
}
export type PurchaseRequestSubmittedEvent = DomainEvent<PurchaseRequestSubmittedPayload>;

export interface PurchaseRequestApprovedPayload {
  status: "APPROVED";
}
export type PurchaseRequestApprovedEvent = DomainEvent<PurchaseRequestApprovedPayload>;

/** Deliberately excludes the rejection reason (Phase F §10) — that stays REST-only, on ApprovalStepInstance.comment. */
export interface PurchaseRequestRejectedPayload {
  status: "REJECTED";
}
export type PurchaseRequestRejectedEvent = DomainEvent<PurchaseRequestRejectedPayload>;

export interface PurchaseRequestAssignedPayload {
  assignedBuyerUserId: string;
}
export type PurchaseRequestAssignedEvent = DomainEvent<PurchaseRequestAssignedPayload>;

export interface PurchaseRequestCancelledPayload {
  status: "CANCELLED";
}
export type PurchaseRequestCancelledEvent = DomainEvent<PurchaseRequestCancelledPayload>;
