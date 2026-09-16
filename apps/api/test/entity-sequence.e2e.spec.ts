import { INestApplication } from "@nestjs/common";
import { Prisma, createSystemPrismaClient, createTenantSafePrismaClient, runWithTenantContext } from "@top/database";
import { createTestApp } from "./test-app";
import { TENANT_PRISMA } from "../src/database/database.module";
import { EntitySequenceService, ENTITY_SEQUENCE_TYPE, type EntitySequenceType } from "../src/common/entity-sequence/entity-sequence.service";
import { isRetryableTransactionError } from "../src/stock/transaction-conflict.util";

/**
 * M3.1 Phase C — direct-service-call tests for EntitySequenceService, the
 * same pattern as M2.5 Phase E's stock-movement-helpers.e2e.spec.ts: no
 * controller exists for this yet (deliberately out of Phase C's scope — the
 * future PurchaseRequestsService owns the transaction this participates
 * in), so these tests call the NestJS-DI-resolved service directly, against
 * a real app (`createTestApp()`) and real Postgres.
 *
 * Tenant context is normally established per-request by
 * TenantContextInterceptor; direct service calls establish it manually via
 * runWithTenantContext(), matching what that interceptor does under the hood.
 */
describe("M3.1 Phase C — EntitySequenceService", () => {
  let app: INestApplication;
  let db: ReturnType<typeof createSystemPrismaClient>;
  let tenantDb: ReturnType<typeof createTenantSafePrismaClient>;
  let sequences: EntitySequenceService;

  beforeAll(async () => {
    app = await createTestApp();
    db = createSystemPrismaClient();
    tenantDb = app.get(TENANT_PRISMA);
    sequences = app.get(EntitySequenceService);
  });

  afterAll(async () => {
    await app.close();
  });

  let seq = 0;
  async function seedOrg(): Promise<string> {
    const org = await db.organization.create({ data: { name: `EntitySeq Org ${Date.now()}-${seq++}` } });
    return org.id;
  }

  /** Runs `sequences.nextValue(...)` inside a fresh transaction, under the given org's tenant context — the exact shape a future caller (PurchaseRequestsService) will use. */
  function attemptNextValue(organizationId: string, type: EntitySequenceType, year: number) {
    return runWithTenantContext({ organizationId }, () =>
      tenantDb.$transaction((tx) => sequences.nextValue(tx, organizationId, type, year))
    );
  }

  // ────────────────────────────────────────────────────────────
  // A-E. Basic allocation, sequencing, and isolation
  // ────────────────────────────────────────────────────────────
  it("A. first value for a brand-new org/type/year is 1", async () => {
    const org = await seedOrg();
    const value = await attemptNextValue(org, ENTITY_SEQUENCE_TYPE.PURCHASE_REQUEST, 2026);
    expect(value).toBe(1);
  });

  it("B. the next call for the same org/type/year returns 2, then 3", async () => {
    const org = await seedOrg();
    expect(await attemptNextValue(org, ENTITY_SEQUENCE_TYPE.PURCHASE_REQUEST, 2026)).toBe(1);
    expect(await attemptNextValue(org, ENTITY_SEQUENCE_TYPE.PURCHASE_REQUEST, 2026)).toBe(2);
    expect(await attemptNextValue(org, ENTITY_SEQUENCE_TYPE.PURCHASE_REQUEST, 2026)).toBe(3);
  });

  it("C/34. organization isolation: each org starts its own counter at 1, and one org's calls never touch another org's row", async () => {
    const orgA = await seedOrg();
    const orgB = await seedOrg();

    expect(await attemptNextValue(orgA, ENTITY_SEQUENCE_TYPE.PURCHASE_REQUEST, 2026)).toBe(1);
    expect(await attemptNextValue(orgA, ENTITY_SEQUENCE_TYPE.PURCHASE_REQUEST, 2026)).toBe(2);
    expect(await attemptNextValue(orgB, ENTITY_SEQUENCE_TYPE.PURCHASE_REQUEST, 2026)).toBe(1); // independent, not 3

    const rowA = await db.entitySequence.findFirst({ where: { organizationId: orgA, sequenceType: "PURCHASE_REQUEST", year: 2026 } });
    const rowB = await db.entitySequence.findFirst({ where: { organizationId: orgB, sequenceType: "PURCHASE_REQUEST", year: 2026 } });
    expect(rowA!.lastValue).toBe(2);
    expect(rowB!.lastValue).toBe(1);
  });

  it("34b. the tenant extension — not the explicit organizationId parameter alone — is what scopes the query; calling under org B's context never reaches org A's row", async () => {
    const orgA = await seedOrg();
    const orgB = await seedOrg();
    await attemptNextValue(orgA, ENTITY_SEQUENCE_TYPE.PURCHASE_REQUEST, 2026); // orgA now at 1

    // Deliberately mismatched: function parameter says orgA, but the active
    // tenant context is orgB. The tenant-safe client's own organizationId
    // injection (DIRECT_TENANT_MODELS) wins — this must land on/create a
    // row for orgB, never touch orgA's existing row. Never weaken the
    // extension to make this pass; this proves it holds under a
    // deliberately adversarial call shape.
    const result = await runWithTenantContext({ organizationId: orgB }, () =>
      tenantDb.$transaction((tx) => sequences.nextValue(tx, orgA, ENTITY_SEQUENCE_TYPE.PURCHASE_REQUEST, 2026))
    );
    expect(result).toBe(1); // a fresh row for orgB, not orgA's 2nd value

    const rowA = await db.entitySequence.findFirst({ where: { organizationId: orgA, sequenceType: "PURCHASE_REQUEST", year: 2026 } });
    expect(rowA!.lastValue).toBe(1); // untouched
  });

  it("D. year isolation: a new year starts its own counter at 1", async () => {
    const org = await seedOrg();
    expect(await attemptNextValue(org, ENTITY_SEQUENCE_TYPE.PURCHASE_REQUEST, 2026)).toBe(1);
    expect(await attemptNextValue(org, ENTITY_SEQUENCE_TYPE.PURCHASE_REQUEST, 2026)).toBe(2);
    expect(await attemptNextValue(org, ENTITY_SEQUENCE_TYPE.PURCHASE_REQUEST, 2027)).toBe(1); // independent, not 3
  });

  it("E. sequenceType isolation: PURCHASE_REQUEST and RFQ counters never share a value", async () => {
    const org = await seedOrg();
    expect(await attemptNextValue(org, ENTITY_SEQUENCE_TYPE.PURCHASE_REQUEST, 2026)).toBe(1);
    expect(await attemptNextValue(org, ENTITY_SEQUENCE_TYPE.RFQ, 2026)).toBe(1); // independent, not 2
    expect(await attemptNextValue(org, ENTITY_SEQUENCE_TYPE.PURCHASE_REQUEST, 2026)).toBe(2);
  });

  // ────────────────────────────────────────────────────────────
  // F. Rollback integrity — a failed transaction never permanently
  // consumes a sequence value.
  // ────────────────────────────────────────────────────────────
  it("F. a rolled-back transaction does not consume a sequence value — the next successful attempt gets the unconsumed value", async () => {
    const org = await seedOrg();

    const failing = runWithTenantContext({ organizationId: org }, () =>
      tenantDb.$transaction(async (tx) => {
        await sequences.nextValue(tx, org, ENTITY_SEQUENCE_TYPE.PURCHASE_REQUEST, 2026);
        throw new Error("forced failure after the sequence increment");
      })
    );
    await expect(failing).rejects.toThrow("forced failure after the sequence increment");

    // No row was ever durably created — the increment lived in the same
    // (rolled-back) transaction as everything else.
    const rowAfterFailure = await db.entitySequence.findFirst({ where: { organizationId: org, sequenceType: "PURCHASE_REQUEST", year: 2026 } });
    expect(rowAfterFailure).toBeNull();

    // The next successful attempt gets 1, not 2 — the failed attempt's
    // increment was never consumed.
    expect(await attemptNextValue(org, ENTITY_SEQUENCE_TYPE.PURCHASE_REQUEST, 2026)).toBe(1);
  });

  // ────────────────────────────────────────────────────────────
  // G. Concurrent increments on an already-existing row
  // ────────────────────────────────────────────────────────────
  it("G. concurrent calls against an already-existing row all receive unique, monotonic values — no duplicates, no lost increments", async () => {
    const org = await seedOrg();
    await attemptNextValue(org, ENTITY_SEQUENCE_TYPE.PURCHASE_REQUEST, 2026); // seed the row at 1

    const results = await Promise.all(
      Array.from({ length: 5 }, () => attemptNextValue(org, ENTITY_SEQUENCE_TYPE.PURCHASE_REQUEST, 2026))
    );
    const sorted = [...results].sort((a, b) => a - b);
    expect(sorted).toEqual([2, 3, 4, 5, 6]); // 1 was already consumed by the seed call above

    const row = await db.entitySequence.findFirst({ where: { organizationId: org, sequenceType: "PURCHASE_REQUEST", year: 2026 } });
    expect(row!.lastValue).toBe(6);
  });

  // ────────────────────────────────────────────────────────────
  // H. Concurrent first-row race — the locked P2002 semantics, plus a
  // TEST-LOCAL bounded whole-transaction retry harness (EntitySequenceService
  // itself must never retry internally — Architecture Gate Revision 1,
  // Decision 5/§5 of this phase's prompt).
  // ────────────────────────────────────────────────────────────
  it("H. two concurrent first-writes to a brand-new org/type/year: the loser's create() fails predictably with P2002, never a corrupted/unsafe follow-up query on the aborted transaction", async () => {
    const org = await seedOrg();
    // No row exists yet for this org/type/year — both calls race to create it.

    const results = await Promise.allSettled([
      attemptNextValue(org, ENTITY_SEQUENCE_TYPE.PURCHASE_REQUEST, 2026),
      attemptNextValue(org, ENTITY_SEQUENCE_TYPE.PURCHASE_REQUEST, 2026),
    ]);

    const succeeded = results.filter((r): r is PromiseFulfilledResult<number> => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(succeeded[0]!.value).toBe(1);

    // The exact, predictable error — proves nothing unsafe was attempted on
    // the aborted transaction (a 25P02 "current transaction is aborted"
    // would surface as a DIFFERENT Prisma error, not a clean P2002).
    expect(rejected[0]!.reason).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((rejected[0]!.reason as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");

    const row = await db.entitySequence.findFirst({ where: { organizationId: org, sequenceType: "PURCHASE_REQUEST", year: 2026 } });
    expect(row!.lastValue).toBe(1); // exactly one row, exactly one committed increment
  });

  it("H2. a test-local bounded whole-transaction retry (mirroring the future PurchaseRequestsService's own policy) resolves the loser to a distinct value with no duplicate/lost number", async () => {
    const org = await seedOrg();

    /**
     * Deliberately NOT inside EntitySequenceService (Decision 5) — this is
     * exactly the shape a future business-transaction caller will own.
     * Reuses isRetryableTransactionError (P2034) and folds in the P2002
     * sequence-race case, same OR-condition already established in
     * StockMovementsService.attempt().
     */
    async function attemptWithRetry(retriesLeft: number): Promise<number> {
      try {
        return await attemptNextValue(org, ENTITY_SEQUENCE_TYPE.PURCHASE_REQUEST, 2026);
      } catch (err) {
        const isRaceOrDeadlock =
          isRetryableTransactionError(err) || (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002");
        if (isRaceOrDeadlock && retriesLeft > 0) {
          return attemptWithRetry(retriesLeft - 1);
        }
        throw err;
      }
    }

    const [a, b] = await Promise.all([attemptWithRetry(1), attemptWithRetry(1)]);
    const values = [a, b].sort();
    expect(values).toEqual([1, 2]); // distinct, no lost/duplicate value

    const row = await db.entitySequence.findFirst({ where: { organizationId: org, sequenceType: "PURCHASE_REQUEST", year: 2026 } });
    expect(row!.lastValue).toBe(2);
  });
});
