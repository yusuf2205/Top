import { PrismaClient } from "@prisma/client";
import { getTenantContext } from "./tenant-context";

/**
 * Models that carry organizationId directly. Every read/write on these models
 * automatically gets organizationId injected from the current tenant context —
 * it is structurally impossible to query them without it via this client.
 *
 * Models that do NOT carry organizationId directly (RFQItem, RFQSupplier, QuoteItem,
 * PurchaseRequestItem, PurchaseRequestComment, PurchaseOrderItem, AIExtraction,
 * ApprovalInstance/ApprovalStepInstance, SupplierContact/SupplierDocument/SupplierCategory,
 * Recommendation) are reached only through a tenant-checked parent (e.g. load the RFQ
 * first — which IS enforced — then its items). That is a service-layer responsibility,
 * not something this extension can enforce generically without a join per model.
 * Each module's integration test suite MUST include a
 * "Tenant A cannot access Tenant B" case that exercises these child models specifically
 * (see ARCHITECTURE.md §1.5 / FINAL-INFRASTRUCTURE-ARCHITECTURE.md p.15).
 */
const DIRECT_TENANT_MODELS = new Set([
  "User",
  "Department",
  "Category",
  "Supplier",
  "PurchaseRequest",
  "RFQ",
  "PurchaseOrder",
  "ApprovalRule",
  "TaxRule",
  "ExchangeRate",
  "Notification",
  "AuditLog",
  "Attachment",
  "Invitation",
  "Product",
  "ProductCategory",
  "UomConversion",
  "Warehouse",
  "Location",
  "StockBalance",
  "StockLot",
  "StockLotPlacement",
  "StockPiece",
]);

const READ_OPERATIONS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

const WHERE_WRITE_OPERATIONS = new Set(["update", "updateMany", "upsert", "delete", "deleteMany"]);

function withOrganizationId<T extends object | undefined>(where: T, organizationId: string): T {
  return { ...(where ?? ({} as T)), organizationId } as T;
}

/**
 * Tenant-safe Prisma client — use this everywhere in application code.
 * Requires an active tenant context (see tenant-context.ts); throws otherwise.
 */
export function createTenantSafePrismaClient() {
  const base = new PrismaClient();

  return base.$extends({
    name: "tenant-isolation",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!DIRECT_TENANT_MODELS.has(model)) {
            return query(args);
          }

          const { organizationId } = getTenantContext();
          const a = args as { where?: object; data?: object | object[] };

          if (READ_OPERATIONS.has(operation) || WHERE_WRITE_OPERATIONS.has(operation)) {
            a.where = withOrganizationId(a.where, organizationId);
          }

          if (operation === "create") {
            a.data = { ...(a.data as object), organizationId };
          }

          if (operation === "createMany" && Array.isArray(a.data)) {
            a.data = a.data.map((row) => ({ ...row, organizationId }));
          }

          return query(a as never);
        },
      },
    },
  });
}

export type TenantSafePrismaClient = ReturnType<typeof createTenantSafePrismaClient>;

/**
 * System-level client that bypasses tenant isolation entirely.
 * ONLY for: seed scripts, cross-tenant admin/cron jobs that explicitly loop
 * per-organization themselves, and migrations. Never inject this into
 * request-scoped application code.
 */
export function createSystemPrismaClient() {
  return new PrismaClient();
}
