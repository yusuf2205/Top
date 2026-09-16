import { Injectable } from "@nestjs/common";
import type { TenantTransactionClient } from "../../database/database.module";

/**
 * TS-level guard against typo-prone `sequenceType` strings — the DB column
 * itself stays a plain `String` (Phase B, Architecture Gate Revision 1
 * Decision 10: no growing Prisma enum for every future document type, same
 * convention as AuditAction). Only PURCHASE_REQUEST is actually consumed in
 * M3.1; RFQ/PURCHASE_ORDER are named ahead of their own future phases so
 * this table needs no further migration when they arrive.
 */
export const ENTITY_SEQUENCE_TYPE = {
  PURCHASE_REQUEST: "PURCHASE_REQUEST",
  RFQ: "RFQ",
  PURCHASE_ORDER: "PURCHASE_ORDER",
  SUPPLIER: "SUPPLIER",
} as const;
export type EntitySequenceType = (typeof ENTITY_SEQUENCE_TYPE)[keyof typeof ENTITY_SEQUENCE_TYPE];

/**
 * M3.2 (Architecture Gate Revision 1, Decision R4): SUPPLIER is the one
 * sequenceType that must NEVER reset by calendar year — a supplier code is a
 * permanent master-data identity, not a per-year document number like
 * PR/RFQ/PO. `EntitySequence.year` is still `Int NOT NULL` with a `year > 0`
 * CHECK (deliberately unchanged — a nullable year would let two concurrent
 * "first supplier code ever" requests both win the create() race, since
 * Postgres never treats NULL = NULL, breaking nextValue()'s uniqueness
 * guarantee). This fixed, clearly-synthetic sentinel is used as the `year`
 * argument on every SUPPLIER call instead: never a real calendar year, never
 * shown to a user, defined in exactly this one place.
 */
export const SUPPLIER_SEQUENCE_YEAR = 9999;

/**
 * M3.1 Phase C (Architecture Gate Revision 1, Decisions 6/13). The generic
 * org/year-scoped counter behind human-readable document numbers
 * (PR-2026-000001 today; RFQ/PO numbers later reuse this same table).
 *
 * `nextValue` is deliberately the ONLY method here, and it deliberately does
 * NOT open its own transaction, does NOT retry anything itself, and does NOT
 * know what it's numbering — the caller (a future PurchaseRequestsService,
 * Phase D+) owns the `$transaction(...)` boundary this participates in,
 * because that transaction also has to insert the PR header, its items, and
 * an AuditLog row atomically with the sequence increment (Architecture Gate
 * Revision 1, Decision 13: "a failed PR transaction must not permanently
 * consume a sequence number" — only true if both live in the same
 * transaction).
 *
 * CONCURRENCY — the exact locked algorithm:
 * 1. Atomic conditional increment (`updateMany` with `lastValue: {increment: 1}`)
 *    — a single UPDATE statement, row-locked by Postgres, safe under
 *    concurrent callers by construction (no SELECT-then-UPDATE race).
 * 2. If that matched a row (the common case — this org/type/year has been
 *    seen before), read it back on the SAME tx and return `lastValue`.
 * 3. If it matched zero rows (first request this org/type/year has ever
 *    seen), `create()` with `lastValue: 1`.
 * 4. A P2002 from that `create()` — a concurrent caller won the "first row"
 *    race — is deliberately left UNCAUGHT. Catching it here and issuing a
 *    fallback SELECT/UPDATE on the SAME transaction would run on an
 *    already-aborted Postgres transaction (25P02 — the M2.5 Phase E lesson,
 *    confirmed empirically then, still locked now: no further statement can
 *    run on a transaction after one of its statements has errored). The
 *    error propagates to the CALLER's transaction, which must retry the
 *    WHOLE boundary from scratch (see transaction-conflict.util.ts's
 *    isRetryableTransactionError for the sibling P2034/deadlock case this
 *    composes with — reused as-is, not duplicated, per Phase C's own
 *    instruction not to build a second generic retry framework).
 */
@Injectable()
export class EntitySequenceService {
  async nextValue(
    tx: TenantTransactionClient,
    organizationId: string,
    sequenceType: EntitySequenceType,
    year: number
  ): Promise<number> {
    const where = { organizationId, sequenceType, year };

    const updated = await tx.entitySequence.updateMany({
      where,
      data: { lastValue: { increment: 1 } },
    });
    if (updated.count === 1) {
      const row = await tx.entitySequence.findFirstOrThrow({ where });
      return row.lastValue;
    }

    const created = await tx.entitySequence.create({ data: { ...where, lastValue: 1 } });
    return created.lastValue;
  }
}
