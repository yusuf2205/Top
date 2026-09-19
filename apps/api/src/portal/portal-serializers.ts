import { Prisma } from "@top/database";
import type { QuoteSource, QuoteView, SupplierPortalQuoteItemView, SupplierPortalQuoteView, SupplierPortalRfqItemView, SupplierPortalRfqView } from "@top/types";

/**
 * M3.4 Supplier Portal Phase C (Architecture §21-27, §50). Explicit,
 * hand-written serializers only — never a Prisma object spread across the
 * external/internal-quote boundary. Shared by both the internal
 * `RfqPortalAccessService` (QuoteView) and the external `PortalService`
 * (SupplierPortalRfqView/SupplierPortalQuoteView) so the exact-same Decimal
 * math backs both — never two competing total-computation implementations.
 *
 * All money/quantity math uses `Prisma.Decimal` exact arithmetic — never
 * `Number()`/`parseFloat()`/`Math.*` (§26). `.toString()` on a Decimal
 * reproduces its exact stored/computed digits, never introducing rounding.
 */

interface QuoteItemRow {
  rfqItemId: string;
  unitPrice: Prisma.Decimal;
  quantity: Prisma.Decimal;
}

interface QuoteRow {
  id: string;
  currency: string;
  vatRate: Prisma.Decimal | null;
  vatIncluded: boolean;
  deliveryCost: Prisma.Decimal;
  deliveryIncluded: boolean;
  leadTimeDays: number | null;
  paymentTerms: string | null;
  warranty: string | null;
  notes: string | null;
  status: string;
  submittedAt: Date;
  items: QuoteItemRow[];
}

/**
 * lineSubtotal = unitPrice × quantity; subtotal = Σ lineSubtotal (§27).
 * Deliberately does NOT compute vatAmount/grandTotal/normalized total — no
 * fiscal formula is asserted in M3.4 (Revision 1 §23).
 */
function computeItems(items: QuoteItemRow[]): { views: SupplierPortalQuoteItemView[]; subtotal: Prisma.Decimal } {
  let subtotal = new Prisma.Decimal(0);
  const views = items.map((item) => {
    const lineSubtotal = item.unitPrice.mul(item.quantity);
    subtotal = subtotal.add(lineSubtotal);
    return {
      rfqItemId: item.rfqItemId,
      unitPrice: item.unitPrice.toString(),
      quantity: item.quantity.toString(),
      lineSubtotal: lineSubtotal.toString(),
    };
  });
  return { views, subtotal };
}

export function toSupplierPortalQuoteView(quote: QuoteRow): SupplierPortalQuoteView {
  const { views, subtotal } = computeItems(quote.items);
  const totalBeforeVat = subtotal.add(quote.deliveryCost);
  return {
    id: quote.id,
    currency: quote.currency,
    vatRate: quote.vatRate?.toString() ?? null,
    vatIncluded: quote.vatIncluded,
    deliveryCost: quote.deliveryCost.toString(),
    deliveryIncluded: quote.deliveryIncluded,
    leadTimeDays: quote.leadTimeDays,
    paymentTerms: quote.paymentTerms,
    warranty: quote.warranty,
    notes: quote.notes,
    status: quote.status as SupplierPortalQuoteView["status"],
    submittedAt: quote.submittedAt.toISOString(),
    items: views,
    subtotal: subtotal.toString(),
    totalBeforeVat: totalBeforeVat.toString(),
  };
}

/**
 * Internal bounded read (§50) — same business fields plus identifiers; no
 * payloadHash/portalTokenHash/tokenExpiresAt/AIExtraction/Attachment/
 * PurchaseOrder. `source` (Multi-Channel Quote Intake Addendum §8/§26) is
 * added ONLY here, never inside `toSupplierPortalQuoteView`/`QuoteRow` —
 * the Supplier-facing view must never expose it (§8: "the Supplier already
 * knows how they submitted it").
 */
export function toQuoteView(
  quote: QuoteRow & {
    rfqId: string;
    rfqSupplierId: string;
    supplierId: string;
    supplierCodeSnapshot: string;
    companyNameSnapshot: string;
    source: string | null;
  }
): QuoteView {
  const base = toSupplierPortalQuoteView(quote);
  return {
    ...base,
    rfqId: quote.rfqId,
    rfqSupplierId: quote.rfqSupplierId,
    supplierId: quote.supplierId,
    supplierCodeSnapshot: quote.supplierCodeSnapshot,
    companyNameSnapshot: quote.companyNameSnapshot,
    source: quote.source as QuoteSource | null,
  };
}

/** Explicit allow-list (§22) — never internalItemNote/purchaseRequestItemId/productId/internal relations. */
export function toSupplierPortalRfqItemView(item: {
  id: string;
  itemName: string;
  skuSnapshot: string | null;
  description: string | null;
  quantity: Prisma.Decimal;
  uomCode: string;
  technicalSpec: Prisma.JsonValue;
  requiredDate: Date | null;
}): SupplierPortalRfqItemView {
  return {
    id: item.id,
    itemName: item.itemName,
    skuSnapshot: item.skuSnapshot,
    description: item.description,
    quantity: item.quantity.toString(),
    uomCode: item.uomCode as SupplierPortalRfqItemView["uomCode"],
    technicalSpec: (item.technicalSpec as Record<string, unknown> | null) ?? null,
    requiredDate: item.requiredDate?.toISOString() ?? null,
  };
}

/** Explicit allow-list (§21) — never internalNotes/createdBy/PR fields/other suppliers/idempotency/portal hash fields. */
export function toSupplierPortalRfqView(input: {
  rfqNumber: string;
  deadline: Date | null;
  supplierInstructions: string | null;
  status: string;
  items: Array<Parameters<typeof toSupplierPortalRfqItemView>[0]>;
  myStatus: string;
  myQuote: QuoteRow | null;
}): SupplierPortalRfqView {
  return {
    rfqNumber: input.rfqNumber,
    deadline: input.deadline?.toISOString() ?? null,
    supplierInstructions: input.supplierInstructions,
    status: input.status as SupplierPortalRfqView["status"],
    items: input.items.map(toSupplierPortalRfqItemView),
    myStatus: input.myStatus as SupplierPortalRfqView["myStatus"],
    myQuote: input.myQuote ? toSupplierPortalQuoteView(input.myQuote) : null,
  };
}
