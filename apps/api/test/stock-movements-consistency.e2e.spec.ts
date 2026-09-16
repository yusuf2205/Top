import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createSystemPrismaClient } from "@top/database";
import { createTestApp, uniqueEmail } from "./test-app";

/**
 * M2.5 Phase H — inventory consistency / invariants / production readiness.
 * Hardening + verification only, no new business logic. Deliberately does
 * NOT re-test everything stock-movements.e2e.spec.ts (Phase F) and
 * stock-movements-read.e2e.spec.ts (Phase G) already cover — see the Phase H
 * final report for the exact mapping of "already covered elsewhere" vs "new
 * in this file." New coverage here: cross-movement-type operational
 * scenarios with combined final-state assertions, multi-line rollback
 * atomicity, PIECE/TRANSFER concurrency races, concurrent
 * same-key-different-hash idempotency, and measured performance sanity
 * numbers.
 */

interface OrgContext {
  email: string;
  accessToken: string;
  userId: string;
  organizationId: string;
}

async function registerOrg(app: INestApplication, orgName: string): Promise<OrgContext> {
  const email = uniqueEmail("consist");
  const password = "correct-horse-battery-staple";
  const res = await request(app.getHttpServer())
    .post("/api/v1/auth/register")
    .send({ organizationName: orgName, fullName: "Admin", email, password });
  return {
    email,
    accessToken: res.body.accessToken as string,
    userId: res.body.user.id as string,
    organizationId: res.body.user.organizationId as string,
  };
}

function authed(app: INestApplication, token: string) {
  return {
    get: (url: string) => request(app.getHttpServer()).get(url).set("Authorization", `Bearer ${token}`),
    post: (url: string) => request(app.getHttpServer()).post(url).set("Authorization", `Bearer ${token}`),
    patch: (url: string) => request(app.getHttpServer()).patch(url).set("Authorization", `Bearer ${token}`),
    delete: (url: string) => request(app.getHttpServer()).delete(url).set("Authorization", `Bearer ${token}`),
  };
}

async function createProduct(
  app: INestApplication,
  token: string,
  overrides: Record<string, unknown> = {}
): Promise<{ id: string; baseUomCode: string; sku: string }> {
  const sku = `SKU-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await authed(app, token)
    .post("/api/v1/products")
    .send({ sku, name: "Test Product", productType: "MATERIAL", baseUomCode: "KG", trackingMode: "QUANTITY", ...overrides });
  return { id: res.body.id as string, baseUomCode: res.body.baseUomCode as string, sku };
}

async function createWarehouse(app: INestApplication, token: string, overrides: Record<string, unknown> = {}): Promise<{ id: string }> {
  const res = await authed(app, token)
    .post("/api/v1/warehouses")
    .send({ code: `WH-${Math.random().toString(36).slice(2, 8).toUpperCase()}`, name: "Test Warehouse", ...overrides });
  return { id: res.body.id as string };
}

async function createLocation(app: INestApplication, token: string, warehouseId: string): Promise<{ id: string }> {
  const res = await authed(app, token)
    .post(`/api/v1/warehouses/${warehouseId}/locations`)
    .send({ code: `LOC-${Math.random().toString(36).slice(2, 8).toUpperCase()}`, name: "Test Location" });
  return { id: res.body.id as string };
}

async function createUomConversion(app: INestApplication, token: string, productId: string, uomCode: string, ratio: string): Promise<void> {
  const res = await authed(app, token).post(`/api/v1/products/${productId}/conversions`).send({ uomCode, source: "CONFIGURED", ratio });
  if (res.status !== 201) throw new Error(`createUomConversion failed: ${res.status} ${JSON.stringify(res.body)}`);
}

function postMovement(app: INestApplication, token: string, body: Record<string, unknown>) {
  return authed(app, token).post("/api/v1/stock-movements").send(body);
}

async function postMovementOk(app: INestApplication, token: string, body: Record<string, unknown>) {
  const res = await postMovement(app, token, body);
  if (res.status !== 201) throw new Error(`postMovement failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string; lines: Array<Record<string, unknown>> };
}

async function getBalance(app: INestApplication, token: string, productId: string, warehouseId: string, locationId?: string | null) {
  const query = new URLSearchParams({ productId, warehouseId });
  if (locationId) query.set("locationId", locationId);
  const res = await authed(app, token).get(`/api/v1/stock-balances?${query.toString()}`);
  return res.body[0] as { onHandQty: string; reservedQty: string } | undefined;
}

async function getPiece(app: INestApplication, token: string, id: string) {
  const res = await authed(app, token).get(`/api/v1/stock-pieces/${id}`);
  return res.body;
}

async function getLotPlacements(app: INestApplication, token: string, lotId: string) {
  const res = await authed(app, token).get(`/api/v1/stock-lots/${lotId}/placements`);
  return res.body as Array<{ warehouseId: string; locationId: string | null; quantity: string }>;
}

async function receivePiece(app: INestApplication, token: string, productId: string, warehouseId: string, quantity: string, uomCode = "M"): Promise<string> {
  const body = await postMovementOk(app, token, {
    type: "RECEIPT",
    lines: [{ productId, warehouseId, pieces: [{ quantity, uomCode }] }],
  });
  return body.lines[0]!.destPieceId as string;
}

describe("M2.5 Phase H — Inventory Consistency / Invariants / Hardening", () => {
  let app: INestApplication;
  let db: ReturnType<typeof createSystemPrismaClient>;

  beforeAll(async () => {
    app = await createTestApp();
    db = createSystemPrismaClient();
  });

  afterAll(async () => {
    await app.close();
  });

  // ────────────────────────────────────────────────────────────
  // Invariants NOT already exercised by Phase F/G's own test suites
  // ────────────────────────────────────────────────────────────
  describe("invariants", () => {
    it("4. a fully-drained StockLotPlacement stays as a zero-quantity row, never deleted (locked Architecture Gate §19 decision — quantity >= 0, not > 0)", async () => {
      const admin = await registerOrg(app, "Invariant Placement Co");
      const product = await createProduct(app, admin.accessToken, { trackingMode: "LOT" });
      const wh = await createWarehouse(app, admin.accessToken);
      const receipt = await postMovementOk(app, admin.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "10.000", lotNumber: "L-INV4" }],
      });
      const lotId = receipt.lines[0]!.destLotId as string;

      await postMovementOk(app, admin.accessToken, {
        type: "ISSUE",
        lines: [{ productId: product.id, warehouseId: wh.id, sourceLotId: lotId, uomCode: "KG", quantity: "10.000" }],
      });

      const placements = await getLotPlacements(app, admin.accessToken, lotId);
      expect(placements).toHaveLength(1);
      expect(Number(placements[0]!.quantity)).toBe(0); // row persists at exactly zero, not removed

      // Never goes negative — a further ISSUE against the drained lot is rejected.
      const overIssue = await postMovement(app, admin.accessToken, {
        type: "ISSUE",
        lines: [{ productId: product.id, warehouseId: wh.id, sourceLotId: lotId, uomCode: "KG", quantity: "0.001" }],
      });
      expect(overIssue.status).toBe(409);
    });

    it("6/7. StockPiece.productId/lotId are always inherited from the parent, never independently settable, and stay immutable across TRANSFER/SPLIT", async () => {
      const admin = await registerOrg(app, "Invariant Lineage Co");
      const product = await createProduct(app, admin.accessToken, { trackingMode: "PIECE" });
      const whA = await createWarehouse(app, admin.accessToken);
      const whB = await createWarehouse(app, admin.accessToken);
      await createUomConversion(app, admin.accessToken, product.id, "M", "1");
      const pieceId = await receivePiece(app, admin.accessToken, product.id, whA.id, "10.000", "M");
      const before = await getPiece(app, admin.accessToken, pieceId);

      await postMovementOk(app, admin.accessToken, {
        type: "TRANSFER",
        lines: [{ sourcePieceId: pieceId, destWarehouseId: whB.id }],
      });
      const afterTransfer = await getPiece(app, admin.accessToken, pieceId);
      expect(afterTransfer.productId).toBe(before.productId);
      expect(afterTransfer.lotId).toBe(before.lotId); // immutable across a physical move
      expect(afterTransfer.warehouseId).toBe(whB.id);

      const split = await postMovementOk(app, admin.accessToken, {
        type: "SPLIT",
        lines: [{ sourcePieceId: pieceId, children: [{ quantity: "6.000" }, { quantity: "4.000" }] }],
      });
      for (const line of split.lines) {
        const child = await getPiece(app, admin.accessToken, line.destPieceId as string);
        expect(child.productId).toBe(before.productId); // always inherited from parent, never client-supplied
        expect(child.lotId).toBe(before.lotId);
      }
    });

    it("8/12/13. parentPieceId/effect/baseQuantity/lotId are rejected as client input (strict DTO, not silently stripped)", async () => {
      const admin = await registerOrg(app, "Invariant MassAssign Co");
      const product = await createProduct(app, admin.accessToken, { trackingMode: "PIECE" });
      const wh = await createWarehouse(app, admin.accessToken);
      await createUomConversion(app, admin.accessToken, product.id, "M", "1");

      const res = await postMovement(app, admin.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: product.id, warehouseId: wh.id, pieces: [{ quantity: "1.000", uomCode: "M", parentPieceId: "00000000-0000-0000-0000-000000000099", lotId: "00000000-0000-0000-0000-000000000099" }] }],
      });
      expect(res.status).toBe(400);
    });
  });

  // ────────────────────────────────────────────────────────────
  // Operational cross-check scenarios A-K
  // ────────────────────────────────────────────────────────────
  describe("operational scenarios", () => {
    it("A. RECEIPT -> ISSUE", async () => {
      const admin = await registerOrg(app, "Scenario A Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      await postMovementOk(app, admin.accessToken, { type: "RECEIPT", lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "20.000" }] });
      await postMovementOk(app, admin.accessToken, { type: "ISSUE", lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "8.000" }] });
      const balance = await getBalance(app, admin.accessToken, product.id, wh.id);
      expect(Number(balance!.onHandQty)).toBe(12);
    });

    it("B/I. RECEIPT -> TRANSFER -> ISSUE across multiple warehouses", async () => {
      const admin = await registerOrg(app, "Scenario B Co");
      const product = await createProduct(app, admin.accessToken);
      const whA = await createWarehouse(app, admin.accessToken);
      const whB = await createWarehouse(app, admin.accessToken);
      await postMovementOk(app, admin.accessToken, { type: "RECEIPT", lines: [{ productId: product.id, warehouseId: whA.id, uomCode: "KG", quantity: "30.000" }] });
      await postMovementOk(app, admin.accessToken, {
        type: "TRANSFER",
        lines: [{ productId: product.id, sourceWarehouseId: whA.id, destWarehouseId: whB.id, uomCode: "KG", quantity: "10.000" }],
      });
      await postMovementOk(app, admin.accessToken, { type: "ISSUE", lines: [{ productId: product.id, warehouseId: whB.id, uomCode: "KG", quantity: "5.000" }] });

      expect(Number((await getBalance(app, admin.accessToken, product.id, whA.id))!.onHandQty)).toBe(20);
      expect(Number((await getBalance(app, admin.accessToken, product.id, whB.id))!.onHandQty)).toBe(5);
    });

    it("C. RECEIPT PIECE -> PARTIAL ISSUE -> REMNANT", async () => {
      const admin = await registerOrg(app, "Scenario C Co");
      const product = await createProduct(app, admin.accessToken, { trackingMode: "PIECE" });
      const wh = await createWarehouse(app, admin.accessToken);
      await createUomConversion(app, admin.accessToken, product.id, "M", "1");
      const pieceId = await receivePiece(app, admin.accessToken, product.id, wh.id, "10.000", "M");

      const issue = await postMovementOk(app, admin.accessToken, { type: "ISSUE", lines: [{ sourcePieceId: pieceId, quantity: "4.000" }] });
      expect(issue.lines[0]!.effect).toBe("OUTBOUND");
      expect(issue.lines[0]!.sourcePieceId).toBe(pieceId);
      const remnantId = issue.lines[0]!.destPieceId as string;
      expect(remnantId).not.toBeNull();

      const original = await getPiece(app, admin.accessToken, pieceId);
      expect(original.status).toBe("CONSUMED");
      const remnant = await getPiece(app, admin.accessToken, remnantId);
      expect(remnant.status).toBe("AVAILABLE");
      expect(Number(remnant.quantity)).toBe(6);
      expect(remnant.parentPieceId).toBe(pieceId);

      const balance = await getBalance(app, admin.accessToken, product.id, wh.id);
      expect(Number(balance!.onHandQty)).toBe(6);
    });

    it("D. RECEIPT PIECE -> SPLIT -> CHILD OPERATIONS", async () => {
      const admin = await registerOrg(app, "Scenario D Co");
      const product = await createProduct(app, admin.accessToken, { trackingMode: "PIECE" });
      const whA = await createWarehouse(app, admin.accessToken);
      const whB = await createWarehouse(app, admin.accessToken);
      await createUomConversion(app, admin.accessToken, product.id, "M", "1");
      const pieceId = await receivePiece(app, admin.accessToken, product.id, whA.id, "10.000", "M");

      const balanceAfterReceipt = await getBalance(app, admin.accessToken, product.id, whA.id);
      expect(Number(balanceAfterReceipt!.onHandQty)).toBe(10);

      const split = await postMovementOk(app, admin.accessToken, {
        type: "SPLIT",
        lines: [{ sourcePieceId: pieceId, children: [{ quantity: "6.000" }, { quantity: "4.000" }] }],
      });
      const parentAfterSplit = await getPiece(app, admin.accessToken, pieceId);
      expect(parentAfterSplit.status).toBe("CONSUMED");
      expect(Number(parentAfterSplit.quantity)).toBe(10); // frozen, never mutated by SPLIT

      // 10. SPLIT itself never touches StockBalance — still exactly 10, untouched by the SPLIT above.
      const balanceAfterSplit = await getBalance(app, admin.accessToken, product.id, whA.id);
      expect(Number(balanceAfterSplit!.onHandQty)).toBe(10);

      const [childA, childB] = split.lines.map((l) => l.destPieceId as string);
      // Operate independently on one child: transfer it to a second warehouse.
      // (TRANSFER itself DOES move StockBalance, PIECE-mode included — this
      // is exercising that separately-known behavior, not SPLIT's.)
      await postMovementOk(app, admin.accessToken, { type: "TRANSFER", lines: [{ sourcePieceId: childA, destWarehouseId: whB.id }] });
      const movedChild = await getPiece(app, admin.accessToken, childA!);
      expect(movedChild.warehouseId).toBe(whB.id);
      const untouchedChild = await getPiece(app, admin.accessToken, childB!);
      expect(untouchedChild.warehouseId).toBe(whA.id);
      expect(untouchedChild.status).toBe("AVAILABLE");

      const balanceA = await getBalance(app, admin.accessToken, product.id, whA.id);
      const balanceB = await getBalance(app, admin.accessToken, product.id, whB.id);
      expect(Number(balanceA!.onHandQty)).toBe(4); // 10 - 6 (childA's quantity, moved by the TRANSFER)
      expect(Number(balanceB!.onHandQty)).toBe(6);
    });

    it("E/K. RECEIPT LOT -> partial consumption, and the same lot ends up in multiple placements", async () => {
      const admin = await registerOrg(app, "Scenario E Co");
      const product = await createProduct(app, admin.accessToken, { trackingMode: "LOT" });
      const whA = await createWarehouse(app, admin.accessToken);
      const whB = await createWarehouse(app, admin.accessToken);
      const receipt = await postMovementOk(app, admin.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: product.id, warehouseId: whA.id, uomCode: "KG", quantity: "20.000", lotNumber: "L-SCENE" }],
      });
      const lotId = receipt.lines[0]!.destLotId as string;

      await postMovementOk(app, admin.accessToken, {
        type: "ISSUE",
        lines: [{ productId: product.id, warehouseId: whA.id, sourceLotId: lotId, uomCode: "KG", quantity: "5.000" }],
      });
      await postMovementOk(app, admin.accessToken, {
        type: "TRANSFER",
        lines: [{ productId: product.id, sourceLotId: lotId, sourceWarehouseId: whA.id, destWarehouseId: whB.id, uomCode: "KG", quantity: "8.000" }],
      });

      const placements = await getLotPlacements(app, admin.accessToken, lotId);
      expect(placements).toHaveLength(2); // K: same lot, two placement rows
      const total = placements.reduce((acc, p) => acc + Number(p.quantity), 0);
      expect(total).toBe(15); // 20 received - 5 issued = 15 remaining, split across two placements by the transfer
      const atA = placements.find((p) => p.warehouseId === whA.id);
      const atB = placements.find((p) => p.warehouseId === whB.id);
      expect(Number(atA!.quantity)).toBe(7); // 20 - 5 - 8
      expect(Number(atB!.quantity)).toBe(8);
    });

    it("F. RECEIPT -> SCRAP", async () => {
      const admin = await registerOrg(app, "Scenario F Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      await postMovementOk(app, admin.accessToken, { type: "RECEIPT", lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "15.000" }] });
      const scrap = await postMovementOk(app, admin.accessToken, {
        type: "SCRAP",
        reason: "damaged in transit",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "5.000" }],
      });
      expect(scrap.lines[0]!.effect).toBe("OUTBOUND");
      const balance = await getBalance(app, admin.accessToken, product.id, wh.id);
      expect(Number(balance!.onHandQty)).toBe(10);
    });

    it("G. RECEIPT -> ADJUSTMENT+", async () => {
      const admin = await registerOrg(app, "Scenario G Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      await postMovementOk(app, admin.accessToken, { type: "RECEIPT", lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "10.000" }] });
      const adj = await postMovementOk(app, admin.accessToken, {
        type: "ADJUSTMENT",
        reason: "cycle count found extra",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", delta: "3.000" }],
      });
      expect(adj.lines[0]!.effect).toBe("INBOUND");
      const balance = await getBalance(app, admin.accessToken, product.id, wh.id);
      expect(Number(balance!.onHandQty)).toBe(13);
    });

    it("H. RECEIPT -> ADJUSTMENT-", async () => {
      const admin = await registerOrg(app, "Scenario H Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      await postMovementOk(app, admin.accessToken, { type: "RECEIPT", lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "10.000" }] });
      const adj = await postMovementOk(app, admin.accessToken, {
        type: "ADJUSTMENT",
        reason: "cycle count found shortage",
        lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", delta: "-4.000" }],
      });
      expect(adj.lines[0]!.effect).toBe("OUTBOUND");
      const balance = await getBalance(app, admin.accessToken, product.id, wh.id);
      expect(Number(balance!.onHandQty)).toBe(6);
    });

    it("J. multiple locations within one warehouse", async () => {
      const admin = await registerOrg(app, "Scenario J Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const locA = await createLocation(app, admin.accessToken, wh.id);
      const locB = await createLocation(app, admin.accessToken, wh.id);
      await postMovementOk(app, admin.accessToken, {
        type: "RECEIPT",
        lines: [{ productId: product.id, warehouseId: wh.id, locationId: locA.id, uomCode: "KG", quantity: "10.000" }],
      });
      await postMovementOk(app, admin.accessToken, {
        type: "TRANSFER",
        lines: [
          {
            productId: product.id,
            sourceWarehouseId: wh.id,
            sourceLocationId: locA.id,
            destWarehouseId: wh.id,
            destLocationId: locB.id,
            uomCode: "KG",
            quantity: "4.000",
          },
        ],
      });
      expect(Number((await getBalance(app, admin.accessToken, product.id, wh.id, locA.id))!.onHandQty)).toBe(6);
      expect(Number((await getBalance(app, admin.accessToken, product.id, wh.id, locB.id))!.onHandQty)).toBe(4);
    });
  });

  // ────────────────────────────────────────────────────────────
  // Atomic failure — multi-line rollback (Phase F's own #21 only covered a
  // single-line failure; this proves a LATER line's failure also undoes an
  // EARLIER line's already-applied mutation within the same transaction).
  // ────────────────────────────────────────────────────────────
  describe("multi-line rollback integrity", () => {
    it("a failing second line rolls back the first line's balance mutation, movement, lines, and audit — all or nothing", async () => {
      const admin = await registerOrg(app, "MultiLineRollback Co");
      const productX = await createProduct(app, admin.accessToken);
      const productY = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      await postMovementOk(app, admin.accessToken, { type: "RECEIPT", lines: [{ productId: productX.id, warehouseId: wh.id, uomCode: "KG", quantity: "10.000" }] });
      await postMovementOk(app, admin.accessToken, { type: "RECEIPT", lines: [{ productId: productY.id, warehouseId: wh.id, uomCode: "KG", quantity: "5.000" }] });

      const movementsBefore = await db.stockMovement.count({ where: { organizationId: admin.organizationId } });
      const auditsBefore = await db.auditLog.count({ where: { organizationId: admin.organizationId, action: "STOCK_MOVEMENT_CREATED" } });

      const res = await postMovement(app, admin.accessToken, {
        type: "ISSUE",
        lines: [
          { productId: productX.id, warehouseId: wh.id, uomCode: "KG", quantity: "10.000" }, // would succeed alone, fully drains X
          { productId: productY.id, warehouseId: wh.id, uomCode: "KG", quantity: "999.000" }, // insufficient -> fails
        ],
      });
      expect(res.status).toBe(409);

      // X must be untouched — the first line's decrement was rolled back with the transaction.
      expect(Number((await getBalance(app, admin.accessToken, productX.id, wh.id))!.onHandQty)).toBe(10);
      expect(Number((await getBalance(app, admin.accessToken, productY.id, wh.id))!.onHandQty)).toBe(5);

      const movementsAfter = await db.stockMovement.count({ where: { organizationId: admin.organizationId } });
      const auditsAfter = await db.auditLog.count({ where: { organizationId: admin.organizationId, action: "STOCK_MOVEMENT_CREATED" } });
      expect(movementsAfter).toBe(movementsBefore); // no new header — not even a half-written one
      expect(auditsAfter).toBe(auditsBefore);
    });
  });

  // ────────────────────────────────────────────────────────────
  // Concurrency hardening — coverage NOT already in Phase F (concurrent
  // RECEIPT/ISSUE/same-hash-idempotency are already covered there).
  // ────────────────────────────────────────────────────────────
  describe("concurrency hardening", () => {
    it("concurrent PIECE ISSUE against the same piece: exactly one succeeds, no double consumption", async () => {
      const admin = await registerOrg(app, "Concurrency PieceIssue Co");
      const product = await createProduct(app, admin.accessToken, { trackingMode: "PIECE" });
      const wh = await createWarehouse(app, admin.accessToken);
      await createUomConversion(app, admin.accessToken, product.id, "M", "1");
      const pieceId = await receivePiece(app, admin.accessToken, product.id, wh.id, "10.000", "M");

      const [r1, r2] = await Promise.all([
        postMovement(app, admin.accessToken, { type: "ISSUE", lines: [{ sourcePieceId: pieceId, quantity: "6.000" }] }),
        postMovement(app, admin.accessToken, { type: "ISSUE", lines: [{ sourcePieceId: pieceId, quantity: "6.000" }] }),
      ]);
      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([201, 409]);

      const piece = await getPiece(app, admin.accessToken, pieceId);
      expect(piece.status).toBe("CONSUMED"); // transitioned exactly once

      const balance = await getBalance(app, admin.accessToken, product.id, wh.id);
      expect(Number(balance!.onHandQty)).toBe(4); // 10 - 6, not 10 - 12 and not 10 - 6 - 6
    });

    it("concurrent QUANTITY-mode TRANSFER never overdraws the source balance", async () => {
      const admin = await registerOrg(app, "Concurrency Transfer Co");
      const product = await createProduct(app, admin.accessToken);
      const whA = await createWarehouse(app, admin.accessToken);
      const whB = await createWarehouse(app, admin.accessToken);
      await postMovementOk(app, admin.accessToken, { type: "RECEIPT", lines: [{ productId: product.id, warehouseId: whA.id, uomCode: "KG", quantity: "100.000" }] });

      const [r1, r2] = await Promise.all([
        postMovement(app, admin.accessToken, { type: "TRANSFER", lines: [{ productId: product.id, sourceWarehouseId: whA.id, destWarehouseId: whB.id, uomCode: "KG", quantity: "70.000" }] }),
        postMovement(app, admin.accessToken, { type: "TRANSFER", lines: [{ productId: product.id, sourceWarehouseId: whA.id, destWarehouseId: whB.id, uomCode: "KG", quantity: "50.000" }] }),
      ]);
      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([201, 409]);

      const balanceA = await getBalance(app, admin.accessToken, product.id, whA.id);
      const balanceB = await getBalance(app, admin.accessToken, product.id, whB.id);
      expect(Number(balanceA!.onHandQty)).toBeGreaterThanOrEqual(0);
      expect(Number(balanceA!.onHandQty) + Number(balanceB!.onHandQty)).toBe(100); // conserved, no lost/duplicated quantity
    });

    it("concurrent PIECE TRANSFER of the same piece to different destinations: exactly one wins", async () => {
      const admin = await registerOrg(app, "Concurrency PieceTransfer Co");
      const product = await createProduct(app, admin.accessToken, { trackingMode: "PIECE" });
      const whA = await createWarehouse(app, admin.accessToken);
      const whB = await createWarehouse(app, admin.accessToken);
      const whC = await createWarehouse(app, admin.accessToken);
      await createUomConversion(app, admin.accessToken, product.id, "M", "1");
      const pieceId = await receivePiece(app, admin.accessToken, product.id, whA.id, "5.000", "M");

      const [r1, r2] = await Promise.all([
        postMovement(app, admin.accessToken, { type: "TRANSFER", lines: [{ sourcePieceId: pieceId, destWarehouseId: whB.id }] }),
        postMovement(app, admin.accessToken, { type: "TRANSFER", lines: [{ sourcePieceId: pieceId, destWarehouseId: whC.id }] }),
      ]);
      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([201, 409]);

      const piece = await getPiece(app, admin.accessToken, pieceId);
      expect([whB.id, whC.id]).toContain(piece.warehouseId); // moved exactly once, to exactly one destination
    });

    it("concurrent same idempotency key with DIFFERENT payloads: exactly one movement created, the loser gets 409", async () => {
      const admin = await registerOrg(app, "Concurrency IdemMismatch Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      const key = "concurrent-mismatch-key-1";

      const [r1, r2] = await Promise.all([
        postMovement(app, admin.accessToken, {
          type: "RECEIPT",
          idempotencyKey: key,
          lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "10.000" }],
        }),
        postMovement(app, admin.accessToken, {
          type: "RECEIPT",
          idempotencyKey: key,
          lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "20.000" }], // different payload, same key
        }),
      ]);
      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([201, 409]);

      const movements = await db.stockMovement.findMany({ where: { organizationId: admin.organizationId, idempotencyKey: key } });
      expect(movements).toHaveLength(1); // exactly one movement, never two, never zero
    });
  });

  // ────────────────────────────────────────────────────────────
  // Read/write consistency — chain POST -> GET detail -> GET list -> current
  // state for a multi-step scenario, proving historical values stay fixed
  // while current stock state reflects everything that happened after.
  // ────────────────────────────────────────────────────────────
  describe("read/write consistency", () => {
    it("historical detail of an early movement is unaffected by later movements in the same chain (RECEIPT -> TRANSFER -> ISSUE)", async () => {
      const admin = await registerOrg(app, "ReadWriteConsistency Co");
      const product = await createProduct(app, admin.accessToken);
      const whA = await createWarehouse(app, admin.accessToken);
      const whB = await createWarehouse(app, admin.accessToken);

      const receipt = await postMovementOk(app, admin.accessToken, { type: "RECEIPT", lines: [{ productId: product.id, warehouseId: whA.id, uomCode: "KG", quantity: "40.000" }] });
      const detailAfterReceipt = await authed(app, admin.accessToken).get(`/api/v1/stock-movements/${receipt.id}`);
      expect(Number(detailAfterReceipt.body.lines[0].quantity)).toBe(40); // Decimal.toString() strips trailing zeros — compare numerically

      await postMovementOk(app, admin.accessToken, { type: "TRANSFER", lines: [{ productId: product.id, sourceWarehouseId: whA.id, destWarehouseId: whB.id, uomCode: "KG", quantity: "15.000" }] });
      await postMovementOk(app, admin.accessToken, { type: "ISSUE", lines: [{ productId: product.id, warehouseId: whB.id, uomCode: "KG", quantity: "5.000" }] });

      // The RECEIPT's own detail is byte-for-byte unchanged.
      const detailAfterAll = await authed(app, admin.accessToken).get(`/api/v1/stock-movements/${receipt.id}`);
      expect(detailAfterAll.body).toEqual(detailAfterReceipt.body);

      // But the list now shows all three, and current state has moved on.
      const list = await authed(app, admin.accessToken).get("/api/v1/stock-movements?pageSize=100");
      expect(list.body.total).toBe(3);
      expect(Number((await getBalance(app, admin.accessToken, product.id, whA.id))!.onHandQty)).toBe(25);
      expect(Number((await getBalance(app, admin.accessToken, product.id, whB.id))!.onHandQty)).toBe(10);
    });
  });

  // ────────────────────────────────────────────────────────────
  // Archived entity + invariant (extends Phase G's coverage with a current-
  // state invariant check, not just a detail-read check).
  // ────────────────────────────────────────────────────────────
  describe("archived entity behavior", () => {
    it("current StockBalance for an archived product remains queryable and correct", async () => {
      const admin = await registerOrg(app, "Archived Invariant Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      await postMovementOk(app, admin.accessToken, { type: "RECEIPT", lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "12.000" }] });

      const archiveRes = await authed(app, admin.accessToken).post(`/api/v1/products/${product.id}/archive`).send({});
      expect(archiveRes.status).toBe(200);

      const balance = await getBalance(app, admin.accessToken, product.id, wh.id);
      expect(Number(balance!.onHandQty)).toBe(12); // invariant 1 (onHandQty >= 0) still holds, value unaffected by archive
    });
  });

  // ────────────────────────────────────────────────────────────
  // Performance sanity — measured, not simulated. Bounded list/detail/
  // balance/piece lookups against a moderately-sized dataset. No caching,
  // no infra change; numbers reported as observed in the Phase H report.
  // ────────────────────────────────────────────────────────────
  describe("performance sanity", () => {
    it("bounded list/detail/balance/piece lookups stay fast with a moderate dataset", async () => {
      const admin = await registerOrg(app, "Perf Sanity Co");
      const product = await createProduct(app, admin.accessToken);
      const wh = await createWarehouse(app, admin.accessToken);
      let lastId = "";
      for (let i = 0; i < 40; i++) {
        const m = await postMovementOk(app, admin.accessToken, { type: "RECEIPT", lines: [{ productId: product.id, warehouseId: wh.id, uomCode: "KG", quantity: "1.000" }] });
        lastId = m.id;
      }

      const t0 = Date.now();
      const list = await authed(app, admin.accessToken).get("/api/v1/stock-movements?pageSize=20");
      const listMs = Date.now() - t0;

      const t1 = Date.now();
      const detail = await authed(app, admin.accessToken).get(`/api/v1/stock-movements/${lastId}`);
      const detailMs = Date.now() - t1;

      const t2 = Date.now();
      await getBalance(app, admin.accessToken, product.id, wh.id);
      const balanceMs = Date.now() - t2;

      expect(list.status).toBe(200);
      expect(list.body.items).toHaveLength(20);
      expect(list.body.total).toBe(40);
      expect(detail.status).toBe(200);

      // eslint-disable-next-line no-console
      console.log(`PHASE_H_PERF: list=${listMs}ms detail=${detailMs}ms balance=${balanceMs}ms (n=40 movements)`);

      expect(listMs).toBeLessThan(2000);
      expect(detailMs).toBeLessThan(2000);
      expect(balanceMs).toBeLessThan(2000);
    });
  });
});
