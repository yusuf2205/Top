import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import type { Server } from "socket.io";
import {
  DomainEventType,
  REALTIME_EVENT_NAME,
  organizationRoom,
  type DomainEvent,
  type ProductCreatedPayload,
  type PurchaseRequestApprovedPayload,
  type PurchaseRequestAssignedPayload,
  type PurchaseRequestCancelledPayload,
  type PurchaseRequestRejectedPayload,
  type PurchaseRequestSubmittedPayload,
  type StockMovementCreatedPayload,
} from "@top/types";

/**
 * Realtime Foundation — the sole publish surface for domain events.
 * Deliberately thin: NOT a general workflow/outbox engine, just
 * "hand a small typed event to Socket.IO, scoped to the org room."
 *
 * Callers MUST only call this after their own business transaction has
 * already committed (see StockMovementsService.create / ProductsService.create
 * for the exact post-commit call sites) — never from inside a
 * `$transaction(...)` callback. This service has no way to enforce that by
 * itself; it is a caller discipline, documented here and at each call site.
 *
 * HONEST GUARANTEE LEVEL (read before assuming more than this provides):
 * there is no outbox table, no message queue, no retry, no persistence of
 * the event envelope itself. `publish()` never throws — a realtime-delivery
 * failure (or the gateway not being initialized yet) must never fail the
 * business mutation that triggered it. If the process crashes between the
 * caller's commit and this call, or Socket.IO fails to flush the frame to a
 * disconnected client, the event is simply lost. This is intentionally NOT
 * "at least once" delivery. PostgreSQL remains the sole source of truth —
 * every client is expected to reconcile via the existing REST/read APIs on
 * reconnect regardless of whether it ever received a given event.
 */
@Injectable()
export class DomainEventsService {
  private server: Server | null = null;
  private readonly logger = new Logger(DomainEventsService.name);

  /** Called once by RealtimeGateway.afterInit — see that file. */
  attachServer(server: Server): void {
    this.server = server;
  }

  publishStockMovementCreated(params: {
    organizationId: string;
    entityId: string;
    actorUserId: string;
    payload: StockMovementCreatedPayload;
  }): void {
    this.publish({ eventType: DomainEventType.STOCK_MOVEMENT_CREATED, entityType: "StockMovement", ...params });
  }

  publishProductCreated(params: {
    organizationId: string;
    entityId: string;
    actorUserId: string;
    payload: ProductCreatedPayload;
  }): void {
    this.publish({ eventType: DomainEventType.PRODUCT_CREATED, entityType: "Product", ...params });
  }

  // M3.1 Phase F — every caller (PurchaseRequestsService) MUST only invoke
  // these strictly after its own $transaction has already resolved/committed
  // — same discipline as publishStockMovementCreated/publishProductCreated,
  // see this class's own doc comment.
  publishPurchaseRequestSubmitted(params: {
    organizationId: string;
    entityId: string;
    actorUserId: string;
    payload: PurchaseRequestSubmittedPayload;
  }): void {
    this.publish({ eventType: DomainEventType.PURCHASE_REQUEST_SUBMITTED, entityType: "PurchaseRequest", ...params });
  }

  publishPurchaseRequestApproved(params: {
    organizationId: string;
    entityId: string;
    actorUserId: string;
    payload: PurchaseRequestApprovedPayload;
  }): void {
    this.publish({ eventType: DomainEventType.PURCHASE_REQUEST_APPROVED, entityType: "PurchaseRequest", ...params });
  }

  publishPurchaseRequestRejected(params: {
    organizationId: string;
    entityId: string;
    actorUserId: string;
    payload: PurchaseRequestRejectedPayload;
  }): void {
    this.publish({ eventType: DomainEventType.PURCHASE_REQUEST_REJECTED, entityType: "PurchaseRequest", ...params });
  }

  publishPurchaseRequestAssigned(params: {
    organizationId: string;
    entityId: string;
    actorUserId: string;
    payload: PurchaseRequestAssignedPayload;
  }): void {
    this.publish({ eventType: DomainEventType.PURCHASE_REQUEST_ASSIGNED, entityType: "PurchaseRequest", ...params });
  }

  publishPurchaseRequestCancelled(params: {
    organizationId: string;
    entityId: string;
    actorUserId: string;
    payload: PurchaseRequestCancelledPayload;
  }): void {
    this.publish({ eventType: DomainEventType.PURCHASE_REQUEST_CANCELLED, entityType: "PurchaseRequest", ...params });
  }

  private publish<TPayload extends object>(input: {
    eventType: DomainEventType;
    entityType: string;
    entityId: string;
    organizationId: string;
    actorUserId: string;
    payload: TPayload;
  }): void {
    if (!this.server) {
      // Best-effort delivery: no gateway attached yet (e.g. a narrow unit
      // test that never bootstraps the WS layer) is not an error condition
      // for the caller's own mutation — silently skip, never throw.
      return;
    }
    const event: DomainEvent<TPayload> = {
      eventId: randomUUID(),
      version: 1,
      occurredAt: new Date().toISOString(),
      ...input,
    };
    try {
      this.server.to(organizationRoom(event.organizationId)).emit(REALTIME_EVENT_NAME, event);
    } catch (err) {
      this.logger.warn(`Failed to publish ${event.eventType} for org ${event.organizationId}: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }
}
