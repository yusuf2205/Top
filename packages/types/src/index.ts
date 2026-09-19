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

// M3.1 Phase E: ApprovalInstance/ApprovalStepInstance already existed in the
// M1-era schema (see PurchaseRequest Phase E notes) — this is the
// browser-safe mirror, added only now that an endpoint actually returns it.
export const ApprovalStatus = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
} as const;
export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus];

export const RfqStatus = {
  DRAFT: "DRAFT",
  SENT: "SENT",
  IN_PROGRESS: "IN_PROGRESS",
  CLOSED: "CLOSED",
  CANCELLED: "CANCELLED",
} as const;
export type RfqStatus = (typeof RfqStatus)[keyof typeof RfqStatus];

// M3.3 Phase B (Architecture Gate Revision 1, locked): SELECTED added ahead
// of INVITED — a Supplier added to a DRAFT RFQ is merely SELECTED; M3.3
// itself never mints a portal token or transitions past this value (that is
// the future Supplier Portal phase's job — see RfqSupplierView below, which
// deliberately excludes portalTokenHash/tokenExpiresAt).
export const RfqSupplierStatus = {
  SELECTED: "SELECTED",
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

/**
 * M3.4 Multi-Channel Quote Intake Addendum §5/§14: which intake channel
 * created a Quote. Channel-neutral canonical model — there is only ever one
 * `Quote`/`QuoteItem` shape; the channel is provenance (this field), never a
 * separate per-channel model. PORTAL is the only value ever set by
 * currently-implemented code (M3.4 Phase C); the rest are reserved for
 * M3.5-M3.8 intake channels.
 */
export const QuoteSource = {
  PORTAL: "PORTAL",
  MANUAL: "MANUAL",
  FILE_IMPORT: "FILE_IMPORT",
  EMAIL: "EMAIL",
  TELEGRAM: "TELEGRAM",
  WHATSAPP: "WHATSAPP",
} as const;
export type QuoteSource = (typeof QuoteSource)[keyof typeof QuoteSource];

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

// ── M3.1 Phase D — Purchase Request ──
// Deliberately excludes payloadHash/idempotencyKey (never exposed in normal
// API responses — Architecture Gate Revision 1 / Phase D §35).
// submittedAt/cancelledAt/cancelledByUserId/approval were added in Phase E,
// once submit/approve/reject/cancel/assign actually populate them.

export interface PurchaseRequestApprovalStepView {
  status: ApprovalStatus;
  stepOrder: number;
  approverRole: UserRole;
  assignedUserId: string | null;
  decidedById: string | null;
  decidedAt: string | null;
  comment: string | null;
}

/** Bounded — a single step only (M3.1 has exactly one), never a full steps[] array (Phase E §31/§37: "expose only through the bounded detail approval view"). */
export interface PurchaseRequestApprovalView {
  status: ApprovalStatus;
  completedAt: string | null;
  step: PurchaseRequestApprovalStepView | null;
}

export interface PurchaseRequestItemSummary {
  id: string;
  productId: string | null;
  itemName: string;
  skuSnapshot: string | null;
  description: string | null;
  quantity: string;
  uomCode: UomCode;
  technicalSpec: Record<string, unknown> | null;
  requiredDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseRequestSummary {
  id: string;
  requestNumber: string;
  requesterId: string;
  departmentId: string | null;
  categoryId: string | null;
  status: PurchaseRequestStatus;
  priority: PurchaseRequestPriority;
  requiredDate: string | null;
  reason: string | null;
  estimatedBudget: string | null;
  currency: string;
  assignedBuyerUserId: string | null;
  submittedAt: string | null;
  cancelledAt: string | null;
  cancelledByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  items: PurchaseRequestItemSummary[];
  approval: PurchaseRequestApprovalView | null;
}

/** LIST row — lightweight, no items[] (see itemCount), same shape discipline as StockMovementListItem. */
export interface PurchaseRequestListItem {
  id: string;
  requestNumber: string;
  status: PurchaseRequestStatus;
  priority: PurchaseRequestPriority;
  requesterId: string;
  departmentId: string | null;
  assignedBuyerUserId: string | null;
  requiredDate: string | null;
  itemCount: number;
  createdAt: string;
}

export interface PurchaseRequestListResult {
  items: PurchaseRequestListItem[];
  total: number;
  page: number;
  pageSize: number;
}

// ── M3.2 — Supplier Master (Architecture Gate Revision 1, locked) ──

export const SupplierStatus = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  BLOCKED: "BLOCKED",
  ARCHIVED: "ARCHIVED",
} as const;
export type SupplierStatus = (typeof SupplierStatus)[keyof typeof SupplierStatus];

export interface CategorySummary {
  id: string;
  name: string;
  active: boolean;
}

export interface SupplierContactView {
  id: string;
  supplierId: string;
  fullName: string;
  position: string | null;
  phone: string | null;
  email: string | null;
  telegram: string | null;
  isPrimary: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierCapabilityView {
  categoryId: string;
  categoryName: string;
}

/** LIST row — lightweight, no contacts/categories[] (same discipline as PurchaseRequestListItem). */
export interface SupplierSummary {
  id: string;
  supplierCode: string;
  companyName: string;
  legalName: string | null;
  tin: string | null;
  countryCode: string | null;
  status: SupplierStatus;
  rating: string | null;
  createdAt: string;
}

/** Bounded detail: fields + contacts + capabilities. Never bank/legacy-country fields (Revision 1 R11) — those are DB-only, not part of any DTO. */
export interface SupplierDetail {
  id: string;
  supplierCode: string;
  companyName: string;
  legalName: string | null;
  tin: string | null;
  countryCode: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  rating: string | null;
  status: SupplierStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  contacts: SupplierContactView[];
  categories: SupplierCapabilityView[];
}

export interface SupplierListResult {
  items: SupplierSummary[];
  total: number;
  page: number;
  pageSize: number;
}

// ── M3.3 Phase B — RFQ (Architecture Gate Revision 1, locked) ──
// Deliberately excludes portalTokenHash/tokenExpiresAt/idempotencyKey/
// payloadHash everywhere below — never exposed in a normal API response
// (Revision 1 §12/§20/§26). No Quote/Recommendation/PurchaseOrder nesting
// (those modules don't exist yet; RfqDetail stays bounded even once they
// do). Quantity is always `string` (Decimal, never a Prisma type in web),
// technicalSpec reuses the exact same `Record<string, unknown> | null`
// narrowing already established by PurchaseRequestItemSummary.

/** LIST row — lightweight, no items[]/suppliers[] (same discipline as PurchaseRequestListItem/SupplierSummary); itemCount/supplierCount are DB-aggregated, never a per-row detail fetch. */
export interface RfqSummary {
  id: string;
  rfqNumber: string;
  status: RfqStatus;
  deadline: string | null;
  purchaseRequest: {
    id: string;
    requestNumber: string;
  };
  itemCount: number;
  supplierCount: number;
  createdAt: string;
  sentAt: string | null;
}

/** requiredDate follows the same UTC-midnight business-date convention as PurchaseRequestItem.requiredDate — display with formatBusinessDate, never formatDateTime (Revision 1 §16/§17). internalItemNote is never supplier-facing. */
export interface RfqItemView {
  id: string;
  purchaseRequestItemId: string;
  productId: string | null;
  itemName: string;
  skuSnapshot: string | null;
  description: string | null;
  quantity: string;
  uomCode: UomCode;
  technicalSpec: Record<string, unknown> | null;
  requiredDate: string | null;
  internalItemNote: string | null;
}

/** currentSupplierStatus is the Supplier's live status (bounded — status enum only, never the full Supplier object); status/invitedAt are this RFQSupplier row's own lifecycle (Revision 1 §26). */
/**
 * M3.4 Phase C — `portalAccessActive`/`portalAccessExpiresAt` are derived,
 * internal-only metadata (never on SupplierPortalRfqView): Revoke
 * deliberately leaves `status`/`invitedAt`/`viewedAt` unchanged (Architecture
 * §14), so `status` alone cannot tell the internal RFQ UI whether a
 * credential is CURRENTLY usable. `portalAccessActive` is computed as
 * `portalTokenHash != null && tokenExpiresAt != null && tokenExpiresAt >
 * now` at serialization time — never derived from `status`.
 * `portalAccessExpiresAt` is shown whenever a token hash currently exists,
 * even if already expired (useful to the Web UI regardless of active/
 * inactive) — `null` only once revoked (both DB fields become null
 * together). Never `portalTokenHash`/the raw token.
 */
export interface RfqSupplierView {
  id: string;
  supplierId: string;
  supplierCodeSnapshot: string;
  companyNameSnapshot: string;
  status: RfqSupplierStatus;
  invitedAt: string | null;
  currentSupplierStatus: SupplierStatus;
  portalAccessActive: boolean;
  portalAccessExpiresAt: string | null;
}

/** Bounded detail: header + PR summary + items + suppliers. No Quote, no token/idempotency fields (Revision 1 §44). */
export interface RfqDetail {
  id: string;
  rfqNumber: string;
  status: RfqStatus;
  deadline: string | null;
  supplierInstructions: string | null;
  internalNotes: string | null;
  purchaseRequest: {
    id: string;
    requestNumber: string;
    status: PurchaseRequestStatus;
  };
  items: RfqItemView[];
  suppliers: RfqSupplierView[];
  createdAt: string;
  sentAt: string | null;
  closedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}

export interface RfqListResult {
  items: RfqSummary[];
  total: number;
  page: number;
  pageSize: number;
}

// ── M3.4 Supplier Portal Phase B (Architecture Gate + Revision 1/2, locked) ──
// Every view below is a hand-written, explicitly-bounded shape — never a
// narrowed/reused RfqDetail or a raw Prisma object spread. Deliberately
// excludes, everywhere below: internalNotes, internalItemNote, PR
// requestNumber/requester/buyer/internal status, createdBy, AuditLog, other
// RFQSuppliers/Suppliers/Quotes, idempotency fields, portalTokenHash,
// tokenExpiresAt, Supplier bank/internal notes, AIExtraction, Attachment,
// PurchaseOrder (Revision 1 D19-D21/§17-20, Revision 1 Revision-of-Revision
// §21/§28-30). `PortalContext` (server-internal, carries tokenHash) is
// deliberately NOT exported from this package — it never reaches the
// browser (Revision 1 §26).

/** Supplier-safe item snapshot — no internalItemNote, no Product/PurchaseRequestItem relation metadata (Revision 1 §18/§23). */
export interface SupplierPortalRfqItemView {
  id: string;
  itemName: string;
  skuSnapshot: string | null;
  description: string | null;
  quantity: string;
  uomCode: UomCode;
  technicalSpec: Record<string, unknown> | null;
  requiredDate: string | null;
}

/** rfqItemId + unitPrice are the Supplier's own submitted values; quantity/lineSubtotal are always server-derived, never client-supplied (Revision 1 D25/D29). */
export interface SupplierPortalQuoteItemView {
  rfqItemId: string;
  unitPrice: string;
  quantity: string;
  lineSubtotal: string;
}

/** subtotal/totalBeforeVat are server-computed from authoritative Decimal fields (Revision 1 §23) — deliberately NO vatAmount/grandTotal field; no fiscal formula is asserted in M3.4. No payloadHash, no AI/review fields, no attachments/PO. */
export interface SupplierPortalQuoteView {
  id: string;
  currency: string;
  vatRate: string | null;
  vatIncluded: boolean;
  deliveryCost: string;
  deliveryIncluded: boolean;
  leadTimeDays: number | null;
  paymentTerms: string | null;
  warranty: string | null;
  notes: string | null;
  status: QuoteStatus;
  submittedAt: string;
  items: SupplierPortalQuoteItemView[];
  subtotal: string;
  totalBeforeVat: string;
}

/**
 * `myStatus` is deliberately the real `RfqSupplierStatus` enum — a small,
 * closed, non-leaky vocabulary (Revision 1 Revision-of-Revision §28: no
 * value here names an internal workflow concept, so no separate portal-only
 * vocabulary was invented). `deadline` is typed `string | null` for
 * defensive serialization even though a Supplier can only ever authenticate
 * against a SENT RFQ (which M3.3's own `send()` guarantees has a non-null,
 * future-at-send-time deadline) — matching this package's existing
 * "never assume the DB invariant, type defensively" convention (see
 * RfqSummary.deadline's own nullability for the exact same reasoning on the
 * internal side).
 */
export interface SupplierPortalRfqView {
  rfqNumber: string;
  deadline: string | null;
  supplierInstructions: string | null;
  status: Extract<RfqStatus, "SENT" | "CLOSED" | "CANCELLED">;
  items: SupplierPortalRfqItemView[];
  myStatus: RfqSupplierStatus;
  myQuote: SupplierPortalQuoteView | null;
}

/** Internal bounded Quote read (Revision 1 D32/D67) — same business fields as SupplierPortalQuoteView plus enough identifiers for the internal RFQ detail page to display it; no payloadHash/portalTokenHash/tokenExpiresAt/AIExtraction/Attachment/PurchaseOrder/other Suppliers' Quotes. */
/**
 * `source` (Addendum §8/§26) is internal-only provenance — never present on
 * `SupplierPortalQuoteView`, since the Supplier already knows how they
 * submitted it. `null` means the Quote predates the M3.4 Multi-Channel
 * Quote Intake Addendum and must never be assumed to be any specific
 * channel (never falsely displayed as PORTAL).
 */
export interface QuoteView {
  id: string;
  rfqId: string;
  rfqSupplierId: string;
  supplierId: string;
  supplierCodeSnapshot: string;
  companyNameSnapshot: string;
  currency: string;
  vatRate: string | null;
  vatIncluded: boolean;
  deliveryCost: string;
  deliveryIncluded: boolean;
  leadTimeDays: number | null;
  paymentTerms: string | null;
  warranty: string | null;
  notes: string | null;
  status: QuoteStatus;
  submittedAt: string;
  source: QuoteSource | null;
  items: SupplierPortalQuoteItemView[];
  subtotal: string;
  totalBeforeVat: string;
}

/** Returned ONCE, at issuance/reissue time (Revision 1 §63/D63) — never portalTokenHash, never persisted beyond the immediate response. */
export interface PortalAccessIssuedView {
  token: string;
}

// ── Realtime Foundation — domain event contract ──
export * from "./events";
