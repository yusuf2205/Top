"use client";

import type { QuoteView } from "@top/types";
import { Dialog } from "../dialog";
import { getQuoteSourceLabel } from "../../lib/portal-access-labels";
import { formatDateTime } from "../../lib/pr-labels";

/**
 * M3.4 Phase D §4 — bounded internal Quote view. Every field shown here
 * comes straight from `QuoteView` (already a bounded, hand-written backend
 * serializer with no `payloadHash`/`portalTokenHash`/technical internals —
 * apps/api/src/portal/portal-serializers.ts). Monetary/quantity fields are
 * rendered as the exact strings the backend returned — never re-formatted
 * through `Number()`/`toLocaleString`, which would risk silently rounding a
 * genuinely significant digit off a real commercial figure (Phase D §12's
 * "no JS float for business logic" extends to not losing precision on
 * DISPLAY of an authoritative document either).
 */
export function QuoteDetailDialog({ quote, onClose }: { quote: QuoteView; onClose: () => void }) {
  return (
    <Dialog title="Предложение поставщика" onClose={onClose}>
      <div className="meta-grid">
        <div>
          <div className="meta-label">Источник</div>
          <div className="meta-value">{getQuoteSourceLabel(quote.source)}</div>
        </div>
        <div>
          <div className="meta-label">Получено</div>
          <div className="meta-value">{formatDateTime(quote.submittedAt)}</div>
        </div>
        <div>
          <div className="meta-label">Валюта</div>
          <div className="meta-value">{quote.currency}</div>
        </div>
        <div>
          <div className="meta-label">Срок поставки</div>
          <div className="meta-value">{quote.leadTimeDays !== null ? `${quote.leadTimeDays} дн.` : "—"}</div>
        </div>
        <div>
          <div className="meta-label">Условия оплаты</div>
          <div className="meta-value">{quote.paymentTerms ?? "—"}</div>
        </div>
        <div>
          <div className="meta-label">Гарантия</div>
          <div className="meta-value">{quote.warranty ?? "—"}</div>
        </div>
        {quote.notes && (
          <div style={{ gridColumn: "1 / -1" }}>
            <div className="meta-label">Комментарий поставщика</div>
            <div className="meta-value">{quote.notes}</div>
          </div>
        )}
      </div>

      <table className="data-table" style={{ marginTop: "1rem" }}>
        <thead>
          <tr>
            <th>Позиция</th>
            <th>Кол-во</th>
            <th>Цена за ед.</th>
            <th>Сумма</th>
          </tr>
        </thead>
        <tbody>
          {quote.items.map((item) => (
            <tr key={item.rfqItemId}>
              <td className="muted">{item.rfqItemId}</td>
              <td>{item.quantity}</td>
              <td>
                {item.unitPrice} {quote.currency}
              </td>
              <td>
                {item.lineSubtotal} {quote.currency}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="meta-grid" style={{ marginTop: "0.75rem" }}>
        <div>
          <div className="meta-label">Сумма по позициям</div>
          <div className="meta-value">
            {quote.subtotal} {quote.currency}
          </div>
        </div>
        <div>
          <div className="meta-label">Доставка</div>
          <div className="meta-value">
            {quote.deliveryIncluded ? "Включена в цену" : `${quote.deliveryCost} ${quote.currency}`}
          </div>
        </div>
        <div>
          <div className="meta-label">Итого без НДС</div>
          <div className="meta-value">
            <strong>
              {quote.totalBeforeVat} {quote.currency}
            </strong>
          </div>
        </div>
        <div>
          <div className="meta-label">НДС</div>
          <div className="meta-value">{quote.vatIncluded ? `Включён (${quote.vatRate ?? "—"}%)` : quote.vatRate ? `${quote.vatRate}% сверх суммы` : "Не указан"}</div>
        </div>
      </div>

      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </Dialog>
  );
}
