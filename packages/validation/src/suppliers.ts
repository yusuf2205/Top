import { z } from "zod";

/**
 * M3.2 (Architecture Gate Revision 1, locked). DTO shapes for Supplier —
 * same discipline as purchase-requests.ts: every object schema uses
 * `.strict()`, so a client submitting a server-controlled field gets an
 * explicit 400, never a silent drop.
 *
 * ────────────────────────────────────────────────────────────
 * NEVER accepted anywhere in this file:
 * ────────────────────────────────────────────────────────────
 *   id / organizationId / supplierCode / normalizedTin / payloadHash
 *                    — server-derived (tenant context, EntitySequence,
 *                      normalization, canonical hash).
 *   status           — only through updateSupplierStatusSchema's own
 *                      dedicated endpoint, never the general update body.
 *   rating           — only through updateSupplierRatingSchema's own
 *                      dedicated endpoint, never the general update body
 *                      (Revision 1 R18/R23 — resolves the ambiguity between
 *                      "one PATCH for everything" and a distinct audit
 *                      action/RBAC boundary for rating changes).
 *   createdAt / updatedAt
 *                    — DB-managed.
 *   bankName / mfo / bankAccount / country (legacy)
 *                    — LEGACY/reserved fields (Revision 1 R11); not part of
 *                      the M3.2 API surface at all, in any schema here.
 */

const companyNameSchema = z.string().trim().min(1).max(300);
const legalNameSchema = z.string().trim().min(1).max(300);
const tinSchema = z.string().trim().min(1).max(50);
/** ISO 3166-1 alpha-2 shape only — no allow-list, no external country service (Revision 1 R11). */
const countryCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Must be a 2-letter ISO 3166-1 country code");
const addressSchema = z.string().trim().max(500);
const phoneSchema = z.string().trim().min(1).max(50); // trim only for M3.2 (Revision 1 R10) — no format normalization yet
const emailSchema = z.string().trim().toLowerCase().email().max(255);
const websiteSchema = z.string().trim().max(500).url("Must be a valid URL");
const notesSchema = z.string().trim().max(5000);

/**
 * Decimal(5,2), business range 1.00–5.00 (Revision 1 R7/R22). The regex's
 * leading `[1-5]` already forbids anything below 1; the `.refine` catches
 * the one gap the regex alone can't (e.g. "5.50" is regex-valid but > 5).
 */
export const supplierRatingString = z
  .string()
  .trim()
  .regex(/^[1-5](\.\d{1,2})?$/, "Must be a decimal between 1 and 5 with at most 2 decimal places")
  .refine((v) => Number(v) <= 5, "Must not exceed 5");

export const supplierStatusValues = ["ACTIVE", "INACTIVE", "BLOCKED", "ARCHIVED"] as const;
export type SupplierStatusValue = (typeof supplierStatusValues)[number];

/**
 * Final Hardening fix: makes an optional string field explicitly
 * CLEARABLE on update — `omitted` leaves the field unchanged (existing
 * `.optional()` behavior), an explicit `null` clears it to DB NULL, and a
 * trimmed-to-empty string ALSO clears it to null (so a UI that just empties
 * a text input doesn't need to know to send `null` specifically). The
 * preprocess runs on the RAW value, before `schema`'s own `.trim()`/`.min(1)`
 * ever sees it — so an all-whitespace input never hits `.min(1)` and fails
 * validation instead of clearing.
 */
function clearable<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (typeof v === "string" && v.trim().length === 0 ? null : v), schema.nullable());
}

// ────────────────────────────────────────────────────────────
// CREATE / UPDATE (general master-data fields)
// ────────────────────────────────────────────────────────────

export const createSupplierSchema = z
  .object({
    companyName: companyNameSchema,
    legalName: legalNameSchema.optional(),
    tin: tinSchema.optional(),
    countryCode: countryCodeSchema.optional(),
    address: addressSchema.optional(),
    phone: phoneSchema.optional(),
    email: emailSchema.optional(),
    website: websiteSchema.optional(),
    notes: notesSchema.optional(),
    idempotencyKey: z.string().trim().min(1).max(128).optional(),
  })
  .strict();
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;

/**
 * companyName is NEVER clearable — it's the supplier's primary display
 * identity, required at create time and forever after. Every other field
 * here uses `clearable()` (Final Hardening fix): `null` (or a
 * trimmed-to-empty string) explicitly clears the field; omission leaves it
 * unchanged. Clearing `tin` also clears `normalizedTin` — enforced in
 * SuppliersService.update(), not here (normalizeTin(null) already returns
 * null, so no schema-level special case is needed).
 */
export const updateSupplierSchema = z
  .object({
    companyName: companyNameSchema.optional(),
    legalName: clearable(legalNameSchema).optional(),
    tin: clearable(tinSchema).optional(),
    countryCode: clearable(countryCodeSchema).optional(),
    address: clearable(addressSchema).optional(),
    phone: clearable(phoneSchema).optional(),
    email: clearable(emailSchema).optional(),
    website: clearable(websiteSchema).optional(),
    notes: clearable(notesSchema).optional(),
  })
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, "At least one field must be provided");
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;

// ────────────────────────────────────────────────────────────
// STATUS / RATING — dedicated endpoints (Revision 1 R18/R23)
// ────────────────────────────────────────────────────────────

/** `reason` is audit-context only (Revision 1 R14) — never a database column, never a status-history table. */
export const updateSupplierStatusSchema = z
  .object({
    status: z.enum(supplierStatusValues),
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();
export type UpdateSupplierStatusInput = z.infer<typeof updateSupplierStatusSchema>;

export const updateSupplierRatingSchema = z.object({ rating: supplierRatingString.nullable() }).strict();
export type UpdateSupplierRatingInput = z.infer<typeof updateSupplierRatingSchema>;

// ────────────────────────────────────────────────────────────
// LIST QUERY
// ────────────────────────────────────────────────────────────

export const listSuppliersQuerySchema = z
  .object({
    search: z.string().trim().min(1).max(200).optional(),
    status: z.enum(supplierStatusValues).optional(),
    categoryId: z.string().uuid().optional(),
    countryCode: countryCodeSchema.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type ListSuppliersQuery = z.infer<typeof listSuppliersQuerySchema>;

// ────────────────────────────────────────────────────────────
// CONTACTS
// ────────────────────────────────────────────────────────────

export const createSupplierContactSchema = z
  .object({
    fullName: z.string().trim().min(1).max(200),
    position: z.string().trim().max(200).optional(),
    phone: phoneSchema.optional(),
    email: emailSchema.optional(),
    telegram: z.string().trim().max(100).optional(),
    isPrimary: z.boolean().optional(),
  })
  .strict();
export type CreateSupplierContactInput = z.infer<typeof createSupplierContactSchema>;

/**
 * Deliberately excludes `active` — a contact is archived only via the
 * dedicated archive endpoint, never a generic PATCH field (Revision 1 R9's
 * API list). `fullName` is NEVER clearable (a contact must always have a
 * name); `position`/`phone`/`email`/`telegram` use `clearable()` (Final
 * Hardening fix), same semantics as the Supplier update schema.
 */
export const updateSupplierContactSchema = z
  .object({
    fullName: z.string().trim().min(1).max(200).optional(),
    position: clearable(z.string().trim().max(200)).optional(),
    phone: clearable(phoneSchema).optional(),
    email: clearable(emailSchema).optional(),
    telegram: clearable(z.string().trim().max(100)).optional(),
    isPrimary: z.boolean().optional(),
  })
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, "At least one field must be provided");
export type UpdateSupplierContactInput = z.infer<typeof updateSupplierContactSchema>;

// ────────────────────────────────────────────────────────────
// CAPABILITIES
// ────────────────────────────────────────────────────────────

export const addSupplierCapabilitySchema = z.object({ categoryId: z.string().uuid() }).strict();
export type AddSupplierCapabilityInput = z.infer<typeof addSupplierCapabilitySchema>;
