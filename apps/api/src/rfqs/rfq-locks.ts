import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@top/database";
import type { TenantTransactionClient } from "../database/database.module";

/**
 * M3.3 Phase C (Architecture Revision 1, locked). Prisma has no declarative
 * `FOR UPDATE` API, so every RFQ mutation acquires its row lock via
 * `tx.$queryRaw` with tagged-template parameterization (never string
 * concatenation — Prisma escapes every interpolated value). This is the
 * ONLY place raw SQL is used anywhere in this module; every other read/write
 * goes through the normal Prisma transaction client.
 *
 * Table/column identifiers below were verified directly against the actual
 * migrated schema (quoted camelCase columns, snake_case `@@map` table
 * names — `rfqs`, `purchase_requests`, `suppliers`, `rfq_suppliers`), not
 * assumed from pseudocode.
 *
 * These helpers are intentionally NOT exported from an index/barrel —
 * RfqsService, RfqPortalAccessService, and (via a direct cross-module
 * import) PortalService import them directly, keeping the raw-SQL surface
 * as narrow as possible while still letting Phase C's portal business logic
 * reuse the exact same tenant-scoped locking primitives rather than a
 * parallel copy.
 */

export interface RfqLockRow {
  id: string;
  status: string;
  purchaseRequestId: string;
  deadline: Date | null;
  rfqNumber: string;
  supplierInstructions: string | null;
  internalNotes: string | null;
}

/** First lock acquired by every existing-RFQ mutation (Revision 1 §9/§10). 404 on no row — cross-org and nonexistent are indistinguishable by design. */
export async function lockRfq(tx: TenantTransactionClient, organizationId: string, rfqId: string): Promise<RfqLockRow> {
  const rows = await tx.$queryRaw<RfqLockRow[]>`
    SELECT "id", "status", "purchaseRequestId", "deadline", "rfqNumber", "supplierInstructions", "internalNotes"
    FROM "rfqs"
    WHERE "id" = ${rfqId} AND "organizationId" = ${organizationId}
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) throw new NotFoundException("RFQ not found");
  return row;
}

export interface PurchaseRequestLockRow {
  id: string;
  status: string;
}

/** Second lock in the SEND/CREATE-with-suppliers lock order (Revision 1 §10). */
export async function lockPurchaseRequest(
  tx: TenantTransactionClient,
  organizationId: string,
  purchaseRequestId: string
): Promise<PurchaseRequestLockRow> {
  const rows = await tx.$queryRaw<PurchaseRequestLockRow[]>`
    SELECT "id", "status"
    FROM "purchase_requests"
    WHERE "id" = ${purchaseRequestId} AND "organizationId" = ${organizationId}
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) throw new NotFoundException("Purchase request not found");
  return row;
}

export interface SupplierLockRow {
  id: string;
  status: string;
  supplierCode: string;
  companyName: string;
}

/**
 * Locks a specific set of Supplier rows, ordered deterministically by id —
 * used both at CREATE time (initial `supplierIds`) and DRAFT supplier-add
 * (Phase C §15/§31-32). A supplier that doesn't exist or belongs to another
 * org simply never appears in the returned array — the caller compares
 * `rows.length` against the requested id count to detect that, rather than
 * this helper throwing per-id (keeps the 404/400 distinction — missing vs.
 * present-but-inactive — a caller-level decision).
 */
export async function lockSuppliersByIds(tx: TenantTransactionClient, organizationId: string, supplierIds: string[]): Promise<SupplierLockRow[]> {
  if (supplierIds.length === 0) return [];
  return tx.$queryRaw<SupplierLockRow[]>`
    SELECT "id", "status", "supplierCode", "companyName"
    FROM "suppliers"
    WHERE "id" IN (${Prisma.join(supplierIds)}) AND "organizationId" = ${organizationId}
    ORDER BY "id" ASC
    FOR UPDATE
  `;
}

export interface SelectedRfqSupplierLockRow {
  rfqSupplierId: string;
  supplierId: string;
  supplierStatus: string;
  supplierCode: string;
  companyName: string;
}

/**
 * SEND's supplier-revalidation lock (Revision 1 §35 step 12) — locks every
 * currently-selected Supplier row (joined through `rfq_suppliers`, already
 * scoped to the just-locked RFQ), ordered by Supplier.id, `FOR UPDATE OF`
 * only the `suppliers` side of the join (the `rfq_suppliers` rows themselves
 * don't need a row lock — SEND is about to overwrite them via the normal
 * Prisma client in the same transaction, which is already protected by the
 * RFQ-level lock held for the whole transaction).
 */
export async function lockSelectedRfqSuppliers(
  tx: TenantTransactionClient,
  organizationId: string,
  rfqId: string
): Promise<SelectedRfqSupplierLockRow[]> {
  return tx.$queryRaw<SelectedRfqSupplierLockRow[]>`
    SELECT rs."id" AS "rfqSupplierId", s."id" AS "supplierId", s."status" AS "supplierStatus", s."supplierCode", s."companyName"
    FROM "rfq_suppliers" rs
    JOIN "suppliers" s ON s."id" = rs."supplierId"
    WHERE rs."rfqId" = ${rfqId} AND s."organizationId" = ${organizationId}
    ORDER BY s."id" ASC
    FOR UPDATE OF s
  `;
}

export interface RfqSupplierLockRow {
  id: string;
  rfqId: string;
  supplierId: string;
  status: string;
  portalTokenHash: string | null;
  tokenExpiresAt: Date | null;
}

/**
 * M3.4 Supplier Portal Phase B (Architecture §41, Revision 1 §8/lock order).
 * Locks a single `RFQSupplier` row by its own id, tenant-scoped via a join
 * to `rfqs.organizationId` (RFQSupplier itself carries no direct
 * `organizationId` column). Second lock in both the internal
 * invite/reissue/revoke order (RFQ → RFQSupplier) and the portal
 * submit/decline order (RFQ → RFQSupplier → Supplier) — never used as the
 * first lock (Phase B §42).
 *
 * Field selection is deliberately minimal — exactly what the credential
 * revalidation (portalTokenHash/tokenExpiresAt) and participation-status
 * branching (status) that EVERY Phase C portal/invite business transaction
 * needs, per Architecture Revision 1/2's own locked transaction shapes — not
 * speculative. A future Phase C business method may select additional
 * fields itself via a normal (non-locking) Prisma read in the same
 * transaction if it needs more than this lock row provides; this helper is
 * not meant to grow into a general-purpose RFQSupplier reader.
 */
export async function lockRfqSupplier(tx: TenantTransactionClient, organizationId: string, rfqSupplierId: string): Promise<RfqSupplierLockRow> {
  const rows = await tx.$queryRaw<RfqSupplierLockRow[]>`
    SELECT rs."id", rs."rfqId", rs."supplierId", rs."status", rs."portalTokenHash", rs."tokenExpiresAt"
    FROM "rfq_suppliers" rs
    JOIN "rfqs" r ON r."id" = rs."rfqId"
    WHERE rs."id" = ${rfqSupplierId} AND r."organizationId" = ${organizationId}
    FOR UPDATE OF rs
  `;
  const row = rows[0];
  if (!row) throw new NotFoundException("RFQ supplier not found");
  return row;
}
