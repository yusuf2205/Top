import { INestApplication } from "@nestjs/common";
import { Prisma, createSystemPrismaClient, createTenantSafePrismaClient, runWithTenantContext } from "@top/database";
import { createTestApp } from "./test-app";
import { TENANT_PRISMA } from "../src/database/database.module";
import { StockBalancesService } from "../src/stock/stock-balances.service";
import { StockLotPlacementsService } from "../src/stock/stock-lot-placements.service";
import { StockPiecesService } from "../src/stock/stock-pieces.service";
import { AuditService } from "../src/common/audit/audit.service";

/**
 * M2.5 (Architecture Gate Revision 2, Phase E) — direct-service-call tests
 * for the transaction-safe concurrency helpers added to
 * StockBalancesService/StockLotPlacementsService/StockPiecesService, plus
 * AuditService's new tx-aware `log(params, tx)`.
 *
 * No controller/route exists for these yet (out of Phase E's scope by
 * design — StockMovementsService orchestration is a later phase), so these
 * tests call the NestJS-DI-resolved services directly rather than going
 * through `request(app.getHttpServer())...` like every other E2E spec in
 * this repo. This is the only way to genuinely exercise the tx-safety
 * guarantees now; it still runs against the real app (`createTestApp()`)
 * and real Postgres, same as every other suite here — only the HTTP layer
 * is skipped, since there is no HTTP layer to skip past.
 *
 * Tenant context is normally established per-request by
 * TenantContextInterceptor; direct service calls establish it manually via
 * runWithTenantContext(), matching what that interceptor does under the hood.
 */
describe("M2.5 Phase E — transaction-safe concurrency helpers", () => {
  let app: INestApplication;
  let db: ReturnType<typeof createSystemPrismaClient>;
  let tenantDb: ReturnType<typeof createTenantSafePrismaClient>;
  let balances: StockBalancesService;
  let placements: StockLotPlacementsService;
  let pieces: StockPiecesService;
  let audit: AuditService;

  beforeAll(async () => {
    app = await createTestApp();
    db = createSystemPrismaClient();
    tenantDb = app.get(TENANT_PRISMA);
    balances = app.get(StockBalancesService);
    placements = app.get(StockLotPlacementsService);
    pieces = app.get(StockPiecesService);
    audit = app.get(AuditService);
  });

  afterAll(async () => {
    await app.close();
  });

  let seq = 0;
  const nextSku = () => `PHASE-E-${Date.now()}-${seq++}`;

  async function seedOrg(): Promise<string> {
    const org = await db.organization.create({ data: { name: `Phase E Org ${Date.now()}-${seq++}` } });
    return org.id;
  }

  async function seedProduct(
    organizationId: string,
    baseUomCode: "KG" | "M",
    trackingMode: "QUANTITY" | "LOT" | "PIECE" = "QUANTITY"
  ): Promise<string> {
    const product = await db.product.create({
      data: {
        organizationId,
        sku: nextSku(),
        name: "Phase E Test Product",
        productType: "MATERIAL",
        baseUomCode,
        trackingMode,
        createdById: "00000000-0000-0000-0000-000000000000",
      },
    });
    return product.id;
  }

  async function seedWarehouse(organizationId: string): Promise<string> {
    const warehouse = await db.warehouse.create({
      data: { organizationId, code: `WH-${Date.now()}-${seq++}`, name: "Phase E Warehouse" },
    });
    return warehouse.id;
  }

  async function seedBalance(
    organizationId: string,
    productId: string,
    warehouseId: string,
    locationId: string | null,
    onHandQty: string
  ): Promise<string> {
    const balance = await db.stockBalance.create({
      data: { organizationId, productId, warehouseId, locationId, uomCode: "KG", onHandQty, reservedQty: "0" },
    });
    return balance.id;
  }

  async function seedLot(organizationId: string, productId: string): Promise<string> {
    const lot = await db.stockLot.create({ data: { organizationId, productId } });
    return lot.id;
  }

  async function seedPlacement(
    organizationId: string,
    stockLotId: string,
    productId: string,
    warehouseId: string,
    locationId: string | null,
    quantity: string
  ): Promise<string> {
    const placement = await db.stockLotPlacement.create({
      data: { organizationId, stockLotId, productId, warehouseId, locationId, uomCode: "KG", quantity },
    });
    return placement.id;
  }

  async function seedAvailablePiece(
    organizationId: string,
    productId: string,
    lotId: string,
    warehouseId: string,
    locationId: string | null,
    quantity: string
  ): Promise<string> {
    const piece = await db.stockPiece.create({
      data: { organizationId, productId, lotId, warehouseId, locationId, quantity, uomCode: "M" },
    });
    return piece.id;
  }

  // ────────────────────────────────────────────────────────────
  // 1. Concurrent outbound balance update cannot produce negative onHandQty
  // ────────────────────────────────────────────────────────────
  it("1. concurrent outbound balance updates cannot produce negative onHandQty", async () => {
    const org = await seedOrg();
    const product = await seedProduct(org, "KG");
    const warehouse = await seedWarehouse(org);
    await seedBalance(org, product, warehouse, null, "100.000");

    const attempt = (amount: string) =>
      runWithTenantContext({ organizationId: org }, () =>
        tenantDb.$transaction((tx) =>
          balances.decrementOnHand(tx, org, { productId: product, warehouseId: warehouse, locationId: null, amount })
        )
      );

    const results = await Promise.allSettled([attempt("70.000"), attempt("50.000")]);
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;
    expect(succeeded).toBe(1);
    expect(failed).toBe(1);

    const final = await db.stockBalance.findFirst({ where: { organizationId: org, productId: product, warehouseId: warehouse } });
    expect(Number(final!.onHandQty)).toBeGreaterThanOrEqual(0);
    expect([30, 50]).toContain(Number(final!.onHandQty));
  });

  // ────────────────────────────────────────────────────────────
  // 2. Concurrent placement decrement cannot produce negative quantity
  // ────────────────────────────────────────────────────────────
  it("2. concurrent placement decrements cannot produce negative quantity", async () => {
    const org = await seedOrg();
    const product = await seedProduct(org, "KG", "LOT");
    const warehouse = await seedWarehouse(org);
    const lot = await seedLot(org, product);
    await seedPlacement(org, lot, product, warehouse, null, "100.000");

    const attempt = (amount: string) =>
      runWithTenantContext({ organizationId: org }, () =>
        tenantDb.$transaction((tx) => placements.decrementByLotAndLocation(tx, org, { stockLotId: lot, warehouseId: warehouse, locationId: null, amount }))
      );

    const results = await Promise.allSettled([attempt("70.000"), attempt("50.000")]);
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    expect(succeeded).toBe(1);

    const final = await db.stockLotPlacement.findFirst({ where: { organizationId: org, stockLotId: lot } });
    expect(Number(final!.quantity)).toBeGreaterThanOrEqual(0);
    expect([30, 50]).toContain(Number(final!.quantity));
  });

  // ────────────────────────────────────────────────────────────
  // 3. Concurrent piece consumption cannot consume the same quantity twice
  // ────────────────────────────────────────────────────────────
  it("3. concurrent piece consumption cannot consume the same piece twice", async () => {
    const org = await seedOrg();
    const product = await seedProduct(org, "M", "PIECE");
    const warehouse = await seedWarehouse(org);
    const lot = await seedLot(org, product);
    const piece = await seedAvailablePiece(org, product, lot, warehouse, null, "10.000");

    const attempt = () =>
      runWithTenantContext({ organizationId: org }, () => tenantDb.$transaction((tx) => pieces.transitionStatusTx(tx, org, piece, "CONSUMED")));

    const results = await Promise.allSettled([attempt(), attempt()]);
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    expect(succeeded).toBe(1);

    const final = await db.stockPiece.findFirst({ where: { id: piece } });
    expect(final!.status).toBe("CONSUMED");
  });

  // ────────────────────────────────────────────────────────────
  // 4. Illegal piece status transition is rejected
  // ────────────────────────────────────────────────────────────
  it("4. illegal piece status transition is rejected", async () => {
    const org = await seedOrg();
    const product = await seedProduct(org, "M", "PIECE");
    const warehouse = await seedWarehouse(org);
    const lot = await seedLot(org, product);
    const piece = await seedAvailablePiece(org, product, lot, warehouse, null, "10.000");

    await runWithTenantContext({ organizationId: org }, () => tenantDb.$transaction((tx) => pieces.transitionStatusTx(tx, org, piece, "CONSUMED")));

    await expect(
      runWithTenantContext({ organizationId: org }, () => tenantDb.$transaction((tx) => pieces.transitionStatusTx(tx, org, piece, "SCRAPPED")))
    ).rejects.toThrow();

    const final = await db.stockPiece.findFirst({ where: { id: piece } });
    expect(final!.status).toBe("CONSUMED");
  });

  // ────────────────────────────────────────────────────────────
  // 5. Tenant isolation survives inside a transaction
  // ────────────────────────────────────────────────────────────
  it("5. tenant isolation survives inside a transaction — ambient context is authoritative, not the caller's own organizationId argument", async () => {
    const org = await seedOrg();
    const otherOrg = await seedOrg();
    const product = await seedProduct(org, "KG");
    const warehouse = await seedWarehouse(org);
    const balanceId = await seedBalance(org, product, warehouse, null, "100.000");

    // Ambient context is otherOrg; the helper is called claiming `org` as
    // its own organizationId — if tenant scoping were bypassable via that
    // argument, this would incorrectly succeed against org's real row.
    await expect(
      runWithTenantContext({ organizationId: otherOrg }, () =>
        tenantDb.$transaction((tx) => balances.decrementOnHand(tx, org, { productId: product, warehouseId: warehouse, locationId: null, amount: "1.000" }))
      )
    ).rejects.toThrow();

    const unchanged = await db.stockBalance.findFirst({ where: { id: balanceId } });
    expect(Number(unchanged!.onHandQty)).toBe(100);
  });

  // ────────────────────────────────────────────────────────────
  // 6. Failed transaction leaves no partial mutation
  // ────────────────────────────────────────────────────────────
  it("6. a failed transaction leaves no partial mutation", async () => {
    const org = await seedOrg();
    const product = await seedProduct(org, "KG");
    const warehouse = await seedWarehouse(org);
    await seedBalance(org, product, warehouse, null, "10.000");

    await expect(
      runWithTenantContext({ organizationId: org }, () =>
        tenantDb.$transaction(async (tx) => {
          await balances.incrementOnHand(tx, org, { productId: product, warehouseId: warehouse, locationId: null, uomCode: "KG", amount: "5.000" });
          // Deliberately exceeds available stock — forces the whole transaction to roll back.
          await balances.decrementOnHand(tx, org, { productId: product, warehouseId: warehouse, locationId: null, amount: "9999.000" });
        })
      )
    ).rejects.toThrow();

    const unchanged = await db.stockBalance.findFirst({ where: { organizationId: org, productId: product, warehouseId: warehouse } });
    expect(Number(unchanged!.onHandQty)).toBe(10);
  });

  // ────────────────────────────────────────────────────────────
  // 7. Uniqueness conflict handled predictably (race to create)
  // ────────────────────────────────────────────────────────────
  it("7. concurrent first-writes to a brand-new balance key: the loser's create fails predictably (P2002); retrying the WHOLE transaction then succeeds with no lost update", async () => {
    const org = await seedOrg();
    const product = await seedProduct(org, "KG");
    const warehouse = await seedWarehouse(org);
    // No StockBalance row exists yet for this key.
    const amounts = ["30.000", "20.000"];

    const attempt = (amount: string) =>
      runWithTenantContext({ organizationId: org }, () =>
        tenantDb.$transaction((tx) =>
          balances.incrementOnHand(tx, org, { productId: product, warehouseId: warehouse, locationId: null, uomCode: "KG", amount })
        )
      );

    const results = await Promise.allSettled(amounts.map(attempt));
    const succeededCount = results.filter((r) => r.status === "fulfilled").length;
    const rejected = results.find((r): r is PromiseRejectedResult => r.status === "rejected");

    // Exactly one of the two concurrent first-writes wins the create race.
    // The other's create() throws a P2002 predictably (deliberately
    // uncaught inside the transaction — see incrementOnHand's doc comment
    // for why an in-transaction retry is unsafe); its whole transaction
    // rolls back cleanly, never a partial state.
    expect(succeededCount).toBe(1);
    expect(rejected).toBeDefined();
    expect(rejected!.reason).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((rejected!.reason as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");

    const afterRace = await db.stockBalance.findMany({ where: { organizationId: org, productId: product, warehouseId: warehouse } });
    expect(afterRace).toHaveLength(1);

    // The future orchestrator's policy (Phase F): on a P2002 from
    // incrementOnHand, retry the WHOLE transaction boundary. Simulated
    // directly here — the retry's own updateMany now finds the winner's
    // committed row and increments it, with no lost update.
    const loserIndex = results.findIndex((r) => r.status === "rejected");
    const retryAmount = amounts[loserIndex]!;
    await attempt(retryAmount);

    const final = await db.stockBalance.findMany({ where: { organizationId: org, productId: product, warehouseId: warehouse } });
    expect(final).toHaveLength(1);
    expect(Number(final[0]!.onHandQty)).toBe(50);
  });

  // ────────────────────────────────────────────────────────────
  // 8/9. Audit atomicity — rollback and success
  // ────────────────────────────────────────────────────────────
  it("8. audit written in the same transaction rolls back with the business mutation", async () => {
    const org = await seedOrg();
    const product = await seedProduct(org, "KG");
    const warehouse = await seedWarehouse(org);
    await seedBalance(org, product, warehouse, null, "10.000");
    const entityId = `phase-e-rollback-${Date.now()}`;

    await expect(
      runWithTenantContext({ organizationId: org }, () =>
        tenantDb.$transaction(async (tx) => {
          await balances.incrementOnHand(tx, org, { productId: product, warehouseId: warehouse, locationId: null, uomCode: "KG", amount: "5.000" });
          await audit.log({ organizationId: org, action: "STOCK_BALANCE_UPDATED", entityType: "StockBalance", entityId, newValue: { test: true } }, tx);
          throw new Error("forced rollback");
        })
      )
    ).rejects.toThrow("forced rollback");

    const auditRows = await db.auditLog.findMany({ where: { organizationId: org, entityId } });
    expect(auditRows).toHaveLength(0);
    const balance = await db.stockBalance.findFirst({ where: { organizationId: org, productId: product, warehouseId: warehouse } });
    expect(Number(balance!.onHandQty)).toBe(10);
  });

  it("9. a successful transaction contains both the mutation and its audit row", async () => {
    const org = await seedOrg();
    const product = await seedProduct(org, "KG");
    const warehouse = await seedWarehouse(org);
    await seedBalance(org, product, warehouse, null, "10.000");
    const entityId = `phase-e-success-${Date.now()}`;

    await runWithTenantContext({ organizationId: org }, () =>
      tenantDb.$transaction(async (tx) => {
        await balances.incrementOnHand(tx, org, { productId: product, warehouseId: warehouse, locationId: null, uomCode: "KG", amount: "5.000" });
        await audit.log({ organizationId: org, action: "STOCK_BALANCE_UPDATED", entityType: "StockBalance", entityId, newValue: { test: true } }, tx);
      })
    );

    const auditRows = await db.auditLog.findMany({ where: { organizationId: org, entityId } });
    expect(auditRows).toHaveLength(1);
    const balance = await db.stockBalance.findFirst({ where: { organizationId: org, productId: product, warehouseId: warehouse } });
    expect(Number(balance!.onHandQty)).toBe(15);
  });

  // ────────────────────────────────────────────────────────────
  // 10. Decimal arithmetic remains exact to 3 decimal places
  // ────────────────────────────────────────────────────────────
  it("10. Decimal arithmetic remains exact to 3 decimal places", async () => {
    const org = await seedOrg();
    const product = await seedProduct(org, "KG");
    const warehouse = await seedWarehouse(org);
    await seedBalance(org, product, warehouse, null, "10.005");

    await runWithTenantContext({ organizationId: org }, () =>
      tenantDb.$transaction((tx) => balances.decrementOnHand(tx, org, { productId: product, warehouseId: warehouse, locationId: null, amount: "0.001" }))
    );

    const balance = await db.stockBalance.findFirst({ where: { organizationId: org, productId: product, warehouseId: warehouse } });
    expect(Number(balance!.onHandQty)).toBe(10.004);
  });

  // ────────────────────────────────────────────────────────────
  // Additional coverage: StockPiece.createChildTx lineage correctness
  // ────────────────────────────────────────────────────────────
  it("createChildTx derives productId/lotId/uomCode/parentPieceId from the parent, never from a caller override", async () => {
    const org = await seedOrg();
    const product = await seedProduct(org, "M", "PIECE");
    const warehouse = await seedWarehouse(org);
    const lot = await seedLot(org, product);
    const parentId = await seedAvailablePiece(org, product, lot, warehouse, null, "10.000");

    const child = await runWithTenantContext({ organizationId: org }, () =>
      tenantDb.$transaction(async (tx) => {
        const parent = await pieces.requireAvailablePieceTx(tx, org, parentId);
        await pieces.transitionStatusTx(tx, org, parentId, "CONSUMED");
        return pieces.createChildTx(tx, org, parent, "3.500");
      })
    );

    expect(child.parentPieceId).toBe(parentId);
    expect(child.productId).toBe(product);
    expect(child.lotId).toBe(lot);
    expect(child.status).toBe("AVAILABLE");
    expect(Number(child.quantity)).toBe(3.5);

    const parentAfter = await db.stockPiece.findFirst({ where: { id: parentId } });
    expect(parentAfter!.status).toBe("CONSUMED");
    expect(Number(parentAfter!.quantity)).toBe(10); // immutable — never mutated
  });
});
