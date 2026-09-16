/**
 * Shared enums/types safe to import from apps/web (browser bundle) — must NOT
 * depend on @top/database, since that package pulls in the Prisma client and
 * native query engine binary, which have no business being in a client bundle.
 *
 * These mirror packages/database/prisma/schema.prisma exactly. Prisma generates
 * its own copy of these enums for server-side code (import from @top/database);
 * this file is the browser-safe duplicate. Keep the two in sync by hand — a
 * schema change that adds/renames a status must update this file in the same PR.
 */

export const UserRole = {
  ADMIN: "ADMIN",
  PROCUREMENT_MANAGER: "PROCUREMENT_MANAGER",
  PROCUREMENT_SPECIALIST: "PROCUREMENT_SPECIALIST",
  APPROVER: "APPROVER",
  EMPLOYEE: "EMPLOYEE",
  SUPPLIER: "SUPPLIER",
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const PurchaseRequestStatus = {
  DRAFT: "DRAFT",
  SUBMITTED: "SUBMITTED",
  UNDER_APPROVAL: "UNDER_APPROVAL",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  RFQ_IN_PROGRESS: "RFQ_IN_PROGRESS",
  PO_CREATED: "PO_CREATED",
  CLOSED: "CLOSED",
  CANCELLED: "CANCELLED",
} as const;
export type PurchaseRequestStatus = (typeof PurchaseRequestStatus)[keyof typeof PurchaseRequestStatus];

// M3.1 Phase B: replaces the legacy free-string `priority` field.
export const PurchaseRequestPriority = {
  LOW: "LOW",
  NORMAL: "NORMAL",
  HIGH: "HIGH",
  URGENT: "URGENT",
} as const;
export type PurchaseRequestPriority = (typeof PurchaseRequestPriority)[keyof typeof PurchaseRequestPriority];

export const RfqStatus = {
  DRAFT: "DRAFT",
  SENT: "SENT",
  IN_PROGRESS: "IN_PROGRESS",
  CLOSED: "CLOSED",
  CANCELLED: "CANCELLED",
} as const;
export type RfqStatus = (typeof RfqStatus)[keyof typeof RfqStatus];

export const RfqSupplierStatus = {
  INVITED: "INVITED",
  VIEWED: "VIEWED",
  SUBMITTED: "SUBMITTED",
  DECLINED: "DECLINED",
  EXPIRED: "EXPIRED",
} as const;
export type RfqSupplierStatus = (typeof RfqSupplierStatus)[keyof typeof RfqSupplierStatus];

export const QuoteStatus = {
  SUBMITTED: "SUBMITTED",
  NEEDS_REVIEW: "NEEDS_REVIEW",
  VERIFIED: "VERIFIED",
  REJECTED: "REJECTED",
} as const;
export type QuoteStatus = (typeof QuoteStatus)[keyof typeof QuoteStatus];

export const PurchaseOrderStatus = {
  DRAFT: "DRAFT",
  PENDING_APPROVAL: "PENDING_APPROVAL",
  APPROVED: "APPROVED",
  SENT: "SENT",
  CONFIRMED: "CONFIRMED",
  CANCELLED: "CANCELLED",
} as const;
export type PurchaseOrderStatus = (typeof PurchaseOrderStatus)[keyof typeof PurchaseOrderStatus];

export interface HealthStatus {
  status: "ok" | "degraded" | "down";
  service: string;
  timestamp: string;
  checks?: Record<string, "ok" | "down">;
}

export const InvitationStatus = {
  PENDING: "PENDING",
  ACCEPTED: "ACCEPTED",
  EXPIRED: "EXPIRED",
  REVOKED: "REVOKED",
} as const;
export type InvitationStatus = (typeof InvitationStatus)[keyof typeof InvitationStatus];

/** Shape of GET /api/v1/auth/me — the frontend's source of truth for "who am I". */
export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  organizationId: string;
  organizationName: string;
}

export interface OrganizationMember {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: UserRole;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
}

// ── M2.1 — Product Master ──

export const ProductType = {
  GOODS: "GOODS",
  MATERIAL: "MATERIAL",
  RAW_MATERIAL: "RAW_MATERIAL",
  COMPONENT: "COMPONENT",
  CONSUMABLE: "CONSUMABLE",
  SERVICE: "SERVICE",
} as const;
export type ProductType = (typeof ProductType)[keyof typeof ProductType];

export const ProductTrackingMode = {
  QUANTITY: "QUANTITY",
  LOT: "LOT",
  PIECE: "PIECE",
} as const;
export type ProductTrackingMode = (typeof ProductTrackingMode)[keyof typeof ProductTrackingMode];

/** Fixed physical-unit set — see M2-PRODUCT-STOCK-ARCHITECTURE.md OD-03: deliberately an enum, not a table. */
export const UomCode = {
  PCS: "PCS",
  KG: "KG",
  G: "G",
  TON: "TON",
  M: "M",
  CM: "CM",
  MM: "MM",
  M2: "M2",
  M3: "M3",
  L: "L",
  ML: "ML",
} as const;
export type UomCode = (typeof UomCode)[keyof typeof UomCode];

export interface ProductCategorySummary {
  id: string;
  parentId: string | null;
  name: string;
  active: boolean;
  createdAt: string;
}

export interface ProductSummary {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  productType: ProductType;
  categoryId: string | null;
  brand: string | null;
  manufacturer: string | null;
  active: boolean;
  baseUomCode: UomCode;
  trackingMode: ProductTrackingMode;
  stockTracked: boolean;
  weightNetKg: string | null;
  weightGrossKg: string | null;
  barcode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductListResult {
  items: ProductSummary[];
  total: number;
  page: number;
  pageSize: number;
}

// ── M2.2 — UOM Conversions ──

export const ConversionSource = {
  CONFIGURED: "CONFIGURED",
  MEASURED: "MEASURED",
  NOT_AVAILABLE: "NOT_AVAILABLE",
} as const;
export type ConversionSource = (typeof ConversionSource)[keyof typeof ConversionSource];

/** Always anchored at the owning Product's baseUomCode — see schema.prisma UomConversion doc comment. */
export interface UomConversionSummary {
  id: string;
  uomCode: UomCode;
  ratio: string | null;
  source: ConversionSource;
  notes: string | null;
  confirmedById: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConvertQuantityResult {
  quantity: string;
  uomCode: UomCode;
}

// ── M2.3 — Material Specification ──

/** Dynamic escape-hatch attribute value — see @top/validation's material-specifications.ts. */
export type MaterialAttributeValue = string | number | boolean | { value: string; uomCode: UomCode };

export interface MaterialSpecificationSummary {
  productId: string;
  material: string | null;
  grade: string | null;
  standard: string | null;
  countryOfOrigin: string | null;
  widthMm: string | null;
  thicknessMm: string | null;
  lengthMm: string | null;
  heightMm: string | null;
  outerDiameterMm: string | null;
  innerDiameterMm: string | null;
  crossSectionMm2: string | null;
  densityKgM3: string | null;
  attributes: Record<string, MaterialAttributeValue> | null;
  displayValue: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── M2.4-A — Warehouse + Location ──

export interface WarehouseSummary {
  id: string;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LocationSummary {
  id: string;
  warehouseId: string;
  code: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── M2.4-B — StockBalance ──

/** availableQty is computed (onHandQty - reservedQty), never its own stored column — see stock-balances.service.ts. */
// ── M2.4-C — StockLot + StockLotPlacement ──

/** No quantity/warehouseId/locationId — those live on StockLotPlacement. See schema.prisma StockLot doc comment. */
export interface StockLotSummary {
  id: string;
  productId: string;
  supplierId: string | null;
  lotNumber: string | null;
  receivedAt: string;
  createdAt: string;
  updatedAt: string;
}

/** productId is always == the parent StockLot.productId (server-derived, never client-set). */
export interface StockLotPlacementSummary {
  id: string;
  stockLotId: string;
  productId: string;
  warehouseId: string;
  locationId: string | null;
  uomCode: UomCode;
  quantity: string;
  createdAt: string;
  updatedAt: string;
}

export const StockPieceStatus = {
  AVAILABLE: "AVAILABLE",
  RESERVED: "RESERVED",
  CONSUMED: "CONSUMED",
  SCRAPPED: "SCRAPPED",
} as const;
export type StockPieceStatus = (typeof StockPieceStatus)[keyof typeof StockPieceStatus];

/**
 * A physical object — quantity/uomCode are the piece's own natural
 * measurement, never converted/duplicated to Product.baseUomCode here.
 * parentPieceId is always null for anything M2.4-D itself can create (the
 * column exists for a future split/issue operation to write into).
 */
export interface StockPieceSummary {
  id: string;
  productId: string;
  lotId: string;
  warehouseId: string;
  locationId: string | null;
  parentPieceId: string | null;
  quantity: string;
  uomCode: UomCode;
  status: StockPieceStatus;
  createdAt: string;
  updatedAt: string;
}

export interface StockBalanceSummary {
  id: string;
  productId: string;
  warehouseId: string;
  locationId: string | null;
  uomCode: UomCode;
  onHandQty: string;
  reservedQty: string;
  availableQty: string;
  createdAt: string;
  updatedAt: string;
}

// ── M2.5 — StockMovement ──

/** Canonical movement types — see schema.prisma StockMovementType. No RETURN/RECLASSIFICATION/REVERSAL/RESERVATION/RELEASE: a correction is a new movement referencing the original; reservation is a separate future slice. */
export const StockMovementType = {
  RECEIPT: "RECEIPT",
  ISSUE: "ISSUE",
  TRANSFER: "TRANSFER",
  ADJUSTMENT: "ADJUSTMENT",
  SCRAP: "SCRAP",
  SPLIT: "SPLIT",
} as const;
export type StockMovementType = (typeof StockMovementType)[keyof typeof StockMovementType];

/** Polymorphic reference pair on StockMovement — no FK, same precedent as Attachment.ownerType/ownerId. STOCK_MOVEMENT is for correction/reversal linkage. */
export const StockMovementReferenceType = {
  PURCHASE_ORDER: "PURCHASE_ORDER",
  MANUAL: "MANUAL",
  STOCK_MOVEMENT: "STOCK_MOVEMENT",
} as const;
export type StockMovementReferenceType = (typeof StockMovementReferenceType)[keyof typeof StockMovementReferenceType];

/**
 * The ONLY accounting discriminator on a StockMovementLine — server-derived,
 * never client-supplied. sourcePieceId/destPieceId/sourceLotId/destLotId are
 * pure lineage/traceability references and NEVER determine this value or any
 * Balance/Placement effect (see StockMovementLine's own doc comment in
 * schema.prisma for the full INBOUND/OUTBOUND/TRANSFER/NONE semantics).
 */
export const StockMovementLineEffect = {
  INBOUND: "INBOUND",
  OUTBOUND: "OUTBOUND",
  TRANSFER: "TRANSFER",
  NONE: "NONE",
} as const;
export type StockMovementLineEffect = (typeof StockMovementLineEffect)[keyof typeof StockMovementLineEffect];

/**
 * Header only — no productId/quantity/warehouse/location/lot/piece here (a
 * single movement may cover multiple products/lines); no status/completedAt/
 * updatedAt (every movement is atomic-by-construction, no pending state).
 */
export interface StockMovementSummary {
  id: string;
  type: StockMovementType;
  referenceType: StockMovementReferenceType | null;
  referenceId: string | null;
  idempotencyKey: string | null;
  actorUserId: string;
  reason: string | null;
  createdAt: string;
  lines: StockMovementLineSummary[];
}

/**
 * sourcePieceId/destPieceId/sourceLotId/destLotId are lineage only — never
 * read as an accounting signal; `effect` is the sole accounting
 * discriminator. baseQuantity is null exactly when effect === "NONE"
 * (SPLIT) — a SPLIT never computes or stores a base-UOM quantity, and
 * UomConversionsService.convert() is never called for it.
 */
export interface StockMovementLineSummary {
  id: string;
  movementId: string;
  productId: string;
  effect: StockMovementLineEffect;
  sourcePieceId: string | null;
  destPieceId: string | null;
  sourceLotId: string | null;
  destLotId: string | null;
  sourceWarehouseId: string | null;
  sourceLocationId: string | null;
  destWarehouseId: string | null;
  destLocationId: string | null;
  uomCode: UomCode;
  quantity: string;
  baseQuantity: string | null;
}

/**
 * LIST row (Phase G) — deliberately lightweight: no lines[], just lineCount,
 * so a paginated list of movements never fans out into loading every line of
 * every movement. Use GET /api/v1/stock-movements/:id (StockMovementSummary)
 * for full line detail on one movement.
 */
export interface StockMovementListItem {
  id: string;
  type: StockMovementType;
  referenceType: StockMovementReferenceType | null;
  referenceId: string | null;
  actorUserId: string;
  createdAt: string;
  lineCount: number;
}

export interface StockMovementListResult {
  items: StockMovementListItem[];
  total: number;
  page: number;
  pageSize: number;
}

// ── Realtime Foundation — domain event contract ──
export * from "./events";
