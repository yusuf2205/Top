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
