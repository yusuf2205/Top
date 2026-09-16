import { z } from "zod";
import { decimalString } from "./decimal";
import { uomCodeValues } from "./uom";

/**
 * M2.5 (Architecture Gate Revision 2, approved): DTO shapes for the single
 * canonical write command, POST /api/v1/stock-movements. This file validates
 * SHAPE and INPUT SAFETY only — it deliberately does NOT duplicate domain
 * business logic that belongs in StockMovementsService (not yet built):
 *   - it does NOT check that a referenced product/piece/lot/warehouse/location
 *     actually exists or belongs to the caller's organization (ownership checks)
 *   - it does NOT check trackingMode compatibility (which of a RECEIPT line's
 *     two shapes is "correct" for a given product is a server-side lookup)
 *   - it does NOT check SPLIT children sum to the parent piece's quantity
 *     (requires reading the parent's actual stored quantity)
 *   - it does NOT check UOM conversion availability
 *   - it does NOT compute `effect` or `baseQuantity` — both are always
 *     server-derived (see below) and never appear in any schema in this file
 *
 * ────────────────────────────────────────────────────────────
 * MASS ASSIGNMENT / FORBIDDEN FIELDS — locked security rules
 * ────────────────────────────────────────────────────────────
 * Every object schema in this file uses `.strict()` (not the zod-default
 * silent-key-stripping most other @top/validation schemas rely on) — a
 * client that submits any of the fields below gets an explicit 400, not a
 * silent drop. This is a deliberate, narrower posture than the rest of the
 * package, matching the M2.5 implementation master prompt's explicit DTO
 * SECURITY requirement ("do not rely only on undocumented stripping
 * behavior — explicitly validate forbidden data").
 *
 * Never accepted anywhere in this file, for any movement type:
 *   organizationId   — always from the authenticated tenant context
 *   actorUserId      — always from CurrentUser(), never the request body
 *   effect           — always server-derived from `type` (+ sign, for
 *                       ADJUSTMENT) — see StockMovementLine.effect's own
 *                       doc comment in schema.prisma. NOT a field on any
 *                       schema below.
 *   baseQuantity     — always server-computed via UomConversionsService
 *                       (or left NULL for SPLIT's effect=NONE lines) — NOT
 *                       a field on any schema below.
 *   status           — a movement/line has no client-settable status field
 *                       at all (StockMovement has none; StockPiece.status
 *                       transitions are a server-side consequence, never a
 *                       client input).
 *   id / movementId / lineId / destPieceId / destLotId
 *                    — every id the system creates is server-generated
 *                       (@default(uuid())); a client never supplies the id
 *                       of a to-be-created movement, line, piece, or lot.
 *   parentPieceId    — never accepted here, same as M2.4-D's own create
 *                       endpoint: a child's lineage is always a side effect
 *                       the service records (partial ISSUE/SCRAP remnants,
 *                       SPLIT children), never a client-declared field.
 *   productId where derivable — forbidden specifically on every PIECE-mode
 *                       line shape (sourcePieceId given): productId is
 *                       always derived server-side from the piece's own
 *                       (immutable) productId, exactly like M2.4-C/D's
 *                       existing create endpoints. The superRefine checks
 *                       below reject a request that supplies both
 *                       sourcePieceId AND productId on the same line.
 *   uomCode where derivable — forbidden on every PIECE-mode line shape for
 *                       the same reason: the piece's own immutable uomCode
 *                       is authoritative, never client-resupplied.
 *
 * ────────────────────────────────────────────────────────────
 * ACCOUNTING vs LINEAGE (unchanged from the architecture gate)
 * ────────────────────────────────────────────────────────────
 * sourcePieceId / destPieceId / sourceLotId / destLotId (destPieceId/
 * destLotId are never client-supplied — server-generated — but
 * sourcePieceId/sourceLotId ARE client-supplied, to select which existing
 * physical object/batch a command operates on) never determine accounting
 * effect. This file only ever validates which fields are STRUCTURALLY
 * present together; `effect` itself is computed later, in the service, from
 * `type` alone (+ sign, for ADJUSTMENT).
 */

/** Positive, 3-decimal-place quantity — same composition pattern already used by createStockPieceSchema (decimalString + a positivity refine), not a new precision tier. */
const positiveQuantityString = decimalString.refine((v) => Number(v) > 0, "Must be greater than zero");

/** Signed, 3-decimal-place quantity — ADJUSTMENT's delta only. Zero is rejected: a no-op adjustment is not a meaningful business event. */
const signedQuantityString = z
  .string()
  .trim()
  .regex(/^-?\d{1,15}(\.\d{1,3})?$/, "Must be a decimal with at most 3 decimal places")
  .refine((v) => Number(v) !== 0, "Must not be zero");

export const stockMovementTypeValues = ["RECEIPT", "ISSUE", "TRANSFER", "ADJUSTMENT", "SCRAP", "SPLIT"] as const;
export type StockMovementType = (typeof stockMovementTypeValues)[number];

export const stockMovementReferenceTypeValues = ["PURCHASE_ORDER", "MANUAL", "STOCK_MOVEMENT"] as const;
export type StockMovementReferenceType = (typeof stockMovementReferenceTypeValues)[number];

/** Header fields shared by every movement type — spread into each discriminated-union member below (never itself a standalone parseable schema, since `type` and per-type `reason`/`lines` requirements differ). */
const referenceType = z.enum(stockMovementReferenceTypeValues).optional();
const referenceId = z.string().uuid().optional();
const idempotencyKey = z.string().trim().min(1).max(200).optional();
const optionalReason = z.string().trim().max(1000).optional();
/** ADJUSTMENT and SCRAP require a non-empty reason — the one movement-type-dependent header field. */
const requiredReason = z.string().trim().min(1, "reason is required").max(1000);

// ────────────────────────────────────────────────────────────
// RECEIPT
// ────────────────────────────────────────────────────────────

/**
 * A RECEIPT line's shape depends on the product's trackingMode, which this
 * DTO layer cannot know (server-side lookup) — so it accepts either the
 * flat (QUANTITY/LOT-mode) shape or the pieces[] (PIECE-mode) shape, and
 * only checks that exactly one of the two is structurally present.
 * supplierId/lotNumber are optional in both flat and pieces[] shapes (a
 * StockLot's own supplierId/lotNumber are both nullable, per M2.4-C) and
 * are simply ignored by the service for QUANTITY-mode products — this file
 * does not attempt to guess trackingMode from which fields are present.
 */
const receiptLineSchema = z
  .object({
    productId: z.string().uuid(),
    warehouseId: z.string().uuid(),
    locationId: z.string().uuid().optional(),
    supplierId: z.string().uuid().optional(),
    lotNumber: z.string().trim().min(1).max(200).optional(),
    uomCode: z.enum(uomCodeValues).optional(),
    quantity: positiveQuantityString.optional(),
    pieces: z
      .array(
        z
          .object({
            quantity: positiveQuantityString,
            uomCode: z.enum(uomCodeValues),
          })
          .strict()
      )
      .min(1)
      .optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const hasFlatQuantity = data.quantity !== undefined;
    const hasUom = data.uomCode !== undefined;
    const hasPieces = data.pieces !== undefined;

    if (hasFlatQuantity !== hasUom) {
      ctx.addIssue({ code: "custom", message: "quantity and uomCode must be provided together", path: ["uomCode"] });
    }
    if (hasPieces && (hasFlatQuantity || hasUom)) {
      ctx.addIssue({ code: "custom", message: "Provide either quantity+uomCode or pieces[], not both", path: ["pieces"] });
    }
    if (!hasPieces && !hasFlatQuantity) {
      ctx.addIssue({
        code: "custom",
        message: "Provide either quantity+uomCode (QUANTITY/LOT receipt) or pieces[] (PIECE receipt)",
        path: ["quantity"],
      });
    }
  });

const receiptMovementSchema = z
  .object({
    type: z.literal("RECEIPT"),
    referenceType,
    referenceId,
    idempotencyKey,
    reason: optionalReason,
    lines: z.array(receiptLineSchema).min(1),
  })
  .strict();

// ────────────────────────────────────────────────────────────
// ISSUE / SCRAP — identical line shape (a physical quantity leaving
// inventory, either from a specific piece or from QUANTITY/LOT-mode stock)
// ────────────────────────────────────────────────────────────

/**
 * PIECE mode: sourcePieceId + quantity only — productId/warehouseId/
 * locationId/sourceLotId/uomCode are all server-derived from the piece,
 * never accepted here (forbidden mass-assignment surface).
 * QUANTITY/LOT mode: productId/warehouseId/uomCode/quantity required;
 * locationId/sourceLotId optional (sourceLotId only meaningful for
 * LOT-tracked products).
 */
const sourceQuantityLineSchema = z
  .object({
    sourcePieceId: z.string().uuid().optional(),
    productId: z.string().uuid().optional(),
    warehouseId: z.string().uuid().optional(),
    locationId: z.string().uuid().optional(),
    sourceLotId: z.string().uuid().optional(),
    uomCode: z.enum(uomCodeValues).optional(),
    quantity: positiveQuantityString,
  })
  .strict()
  .superRefine((data, ctx) => {
    const isPieceMode = data.sourcePieceId !== undefined;
    const isQuantityLotMode = data.productId !== undefined;

    if (isPieceMode === isQuantityLotMode) {
      ctx.addIssue({
        code: "custom",
        message: "Provide either sourcePieceId (PIECE mode) or productId (QUANTITY/LOT mode), not both, not neither",
        path: ["sourcePieceId"],
      });
      return;
    }
    if (isPieceMode) {
      if (data.warehouseId || data.locationId || data.sourceLotId || data.uomCode) {
        ctx.addIssue({
          code: "custom",
          message:
            "PIECE-mode lines must not include warehouseId/locationId/sourceLotId/uomCode — these are server-derived from the piece",
          path: ["sourcePieceId"],
        });
      }
    } else {
      if (!data.warehouseId || !data.uomCode) {
        ctx.addIssue({
          code: "custom",
          message: "QUANTITY/LOT-mode lines require warehouseId and uomCode",
          path: ["productId"],
        });
      }
    }
  });

const issueMovementSchema = z
  .object({
    type: z.literal("ISSUE"),
    referenceType,
    referenceId,
    idempotencyKey,
    reason: optionalReason,
    lines: z.array(sourceQuantityLineSchema).min(1),
  })
  .strict();

const scrapMovementSchema = z
  .object({
    type: z.literal("SCRAP"),
    referenceType,
    referenceId,
    idempotencyKey,
    reason: requiredReason,
    lines: z.array(sourceQuantityLineSchema).min(1),
  })
  .strict();

// ────────────────────────────────────────────────────────────
// TRANSFER
// ────────────────────────────────────────────────────────────

/**
 * PIECE mode: sourcePieceId + destWarehouseId(+destLocationId) only — a
 * whole piece moves as-is; there is no such thing as a partial piece
 * transfer (split first, then transfer the child). sourceWarehouseId/
 * uomCode/quantity are all server-derived from the piece's current state,
 * never accepted here.
 * QUANTITY/LOT mode: productId/sourceWarehouseId/uomCode/quantity required,
 * sourceLotId optional (LOT-tracked products only).
 */
const transferLineSchema = z
  .object({
    sourcePieceId: z.string().uuid().optional(),
    productId: z.string().uuid().optional(),
    sourceLotId: z.string().uuid().optional(),
    sourceWarehouseId: z.string().uuid().optional(),
    sourceLocationId: z.string().uuid().optional(),
    destWarehouseId: z.string().uuid(),
    destLocationId: z.string().uuid().optional(),
    uomCode: z.enum(uomCodeValues).optional(),
    quantity: positiveQuantityString.optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const isPieceMode = data.sourcePieceId !== undefined;
    const isQuantityLotMode = data.productId !== undefined;

    if (isPieceMode === isQuantityLotMode) {
      ctx.addIssue({
        code: "custom",
        message: "Provide either sourcePieceId (PIECE mode) or productId (QUANTITY/LOT mode), not both, not neither",
        path: ["sourcePieceId"],
      });
      return;
    }
    if (isPieceMode) {
      if (data.sourceWarehouseId || data.sourceLotId || data.uomCode || data.quantity) {
        ctx.addIssue({
          code: "custom",
          message:
            "PIECE-mode transfer lines must not include sourceWarehouseId/sourceLotId/uomCode/quantity — a whole piece transfers as-is; a partial transfer does not exist (split first, then transfer the child)",
          path: ["sourcePieceId"],
        });
      }
    } else {
      if (!data.sourceWarehouseId || !data.uomCode || !data.quantity) {
        ctx.addIssue({
          code: "custom",
          message: "QUANTITY/LOT-mode transfer lines require sourceWarehouseId, uomCode, and quantity",
          path: ["productId"],
        });
      }
    }
  });

const transferMovementSchema = z
  .object({
    type: z.literal("TRANSFER"),
    referenceType,
    referenceId,
    idempotencyKey,
    reason: optionalReason,
    lines: z.array(transferLineSchema).min(1),
  })
  .strict();

// ────────────────────────────────────────────────────────────
// ADJUSTMENT — QUANTITY/LOT only; PIECE-mode rejection happens at the
// service/domain level (requires a product lookup this DTO layer cannot
// perform), not here.
// ────────────────────────────────────────────────────────────

const adjustmentLineSchema = z
  .object({
    productId: z.string().uuid(),
    warehouseId: z.string().uuid(),
    locationId: z.string().uuid().optional(),
    uomCode: z.enum(uomCodeValues),
    delta: signedQuantityString,
  })
  .strict();

const adjustmentMovementSchema = z
  .object({
    type: z.literal("ADJUSTMENT"),
    referenceType,
    referenceId,
    idempotencyKey,
    reason: requiredReason,
    lines: z.array(adjustmentLineSchema).min(1),
  })
  .strict();

// ────────────────────────────────────────────────────────────
// SPLIT — PIECE-mode structural operation. No uomCode anywhere (children
// always inherit the parent's own immutable uomCode, server-side). No
// baseQuantity anywhere (effect=NONE lines never compute one — see the
// package-level doc comment above and schema.prisma's own StockMovementLine
// doc comment). Sum-equals-parent-quantity is NOT checked here — it
// requires reading the parent piece's actual stored quantity from the
// database, which belongs in StockMovementsService, not this DTO.
// ────────────────────────────────────────────────────────────

const splitChildSchema = z
  .object({
    quantity: positiveQuantityString,
  })
  .strict();

const splitLineSchema = z
  .object({
    sourcePieceId: z.string().uuid(),
    // At least 2 children: splitting a piece into exactly one resulting
    // piece is not a split (it would be a structural no-op). This is a
    // shape constraint, not the sum-conservation business rule.
    children: z.array(splitChildSchema).min(2),
  })
  .strict();

const splitMovementSchema = z
  .object({
    type: z.literal("SPLIT"),
    referenceType,
    referenceId,
    idempotencyKey,
    reason: optionalReason,
    lines: z.array(splitLineSchema).min(1),
  })
  .strict();

// ────────────────────────────────────────────────────────────
// Discriminated union — the single request-body contract for
// POST /api/v1/stock-movements (the sole write endpoint; a command, not
// ordinary CRUD — see the architecture gate's "Command vs CRUD" section).
// ────────────────────────────────────────────────────────────

export const createStockMovementSchema = z
  .discriminatedUnion("type", [
    receiptMovementSchema,
    issueMovementSchema,
    transferMovementSchema,
    adjustmentMovementSchema,
    scrapMovementSchema,
    splitMovementSchema,
  ])
  .superRefine((data, ctx) => {
    // Shape-level only: a reference must be a complete (type, id) pair or
    // entirely absent — never half-specified. Which referenceType values
    // are valid for which movement type, and whether the referenced
    // document actually exists/belongs to this org, are service-level
    // concerns (ownership check), not this file's job.
    const hasType = data.referenceType !== undefined;
    const hasId = data.referenceId !== undefined;
    if (hasType !== hasId) {
      ctx.addIssue({
        code: "custom",
        message: "referenceType and referenceId must be provided together, or not at all",
        path: ["referenceId"],
      });
    }
  });

export type CreateStockMovementInput = z.infer<typeof createStockMovementSchema>;

// ────────────────────────────────────────────────────────────
// Phase G — read-side query DTO for GET /api/v1/stock-movements.
// `.strict()` for the same reason as every write schema above: an unknown
// query param should be an explicit 400, not a silently-ignored filter a
// caller might mistake for having applied. Pagination mirrors the one
// existing paginated-list precedent in the package (listProductsQuerySchema
// in products.ts) — page/pageSize, pageSize capped at 100, not clamped.
// Filters are restricted to columns backed by an existing index prefix
// (organizationId, ...) per the M2.5 Phase G prompt's own "do not invent an
// unindexed filter" rule — see schema.prisma's StockMovement/
// StockMovementLine @@index lists. actorUserId has no dedicated composite
// index but every query here is always additionally bounded by
// organizationId (tenant extension), so it can never become a cross-tenant
// full-table scan — only a per-tenant one.
// ────────────────────────────────────────────────────────────

export const listStockMovementsQuerySchema = z
  .object({
    type: z.enum(stockMovementTypeValues).optional(),
    actorUserId: z.string().uuid().optional(),
    referenceType: z.enum(stockMovementReferenceTypeValues).optional(),
    referenceId: z.string().uuid().optional(),
    productId: z.string().uuid().optional(),
    sourcePieceId: z.string().uuid().optional(),
    sourceLotId: z.string().uuid().optional(),
    createdAtFrom: z.string().datetime().optional(),
    createdAtTo: z.string().datetime().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.createdAtFrom && data.createdAtTo && new Date(data.createdAtFrom) > new Date(data.createdAtTo)) {
      ctx.addIssue({ code: "custom", message: "createdAtFrom must not be after createdAtTo", path: ["createdAtFrom"] });
    }
  });
export type ListStockMovementsQuery = z.infer<typeof listStockMovementsQuerySchema>;
