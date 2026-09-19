import type { SupplierPortalQuoteView } from "@top/types";
import { formatDateTime } from "../../lib/pr-labels";

/**
 * M3.4 Phase D §15 — shown whenever `myQuote != null`, regardless of RFQ
 * status (SENT/CLOSED/CANCELLED), while the credential remains valid. Never
 * editable — the backend's one-Quote-per-RFQSupplier rule is authoritative;
 * this is a read view only. No `source` field — `SupplierPortalQuoteView`
 * deliberately never exposes it (the Supplier already knows how they
 * submitted it).
 */
export function PortalQuoteReadonly({ quote }: { quote: SupplierPortalQuoteView }) {
  return (
    <div className="card">
      <div className="card-header">
        <h2 style={{ margin: 0 }}>Ваше предложение отправлено</h2>
      </div>
      <p className="form-success">Предложение получено {formatDateTime(quote.submittedAt)}. Изменить его уже нельзя.</p>

      <table className="data-table">
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
          <div className="meta-value">{quote.deliveryIncluded ? "Включена в цену" : `${quote.deliveryCost} ${quote.currency}`}</div>
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
        {quote.leadTimeDays !== null && (
          <div>
            <div className="meta-label">Срок поставки</div>
            <div className="meta-value">{quote.leadTimeDays} дн.</div>
          </div>
        )}
        {quote.paymentTerms && (
          <div>
            <div className="meta-label">Условия оплаты</div>
            <div className="meta-value">{quote.paymentTerms}</div>
          </div>
        )}
        {quote.warranty && (
          <div>
            <div className="meta-label">Гарантия</div>
            <div className="meta-value">{quote.warranty}</div>
          </div>
        )}
        {quote.notes && (
          <div style={{ gridColumn: "1 / -1" }}>
            <div className="meta-label">Комментарий</div>
            <div className="meta-value">{quote.notes}</div>
          </div>
        )}
      </div>
    </div>
  );
}
