import type { SupplierPortalQuoteView, SupplierPortalRfqView } from "@top/types";
import { PortalItemsList } from "./portal-items-list";
import { PortalQuoteForm } from "./portal-quote-form";
import { PortalQuoteReadonly } from "./portal-quote-readonly";
import { PortalDeclineButton, PortalDeclinedNotice } from "./portal-decline-flow";
import { formatDeadline, isDeadlineOverdue } from "../../lib/rfq-labels";

/**
 * M3.4 Phase D §8/§15-18 — the single state-routing view for whatever
 * `SupplierPortalRfqView` currently says. Header + items list are ALWAYS
 * shown (§8); below that, exactly one of: read-only submitted Quote / the
 * editable quote form + decline / a declined notice / a read-only
 * closed-cancelled-or-deadline-passed banner — backend remains the
 * authority on all of these (§17: "even if frontend accidentally renders
 * action, backend remains authority"), this is purely presentational
 * routing of already-authoritative server state.
 */
export function PortalRfqView({
  rfq,
  onQuoteSubmitted,
  onDeclined,
}: {
  rfq: SupplierPortalRfqView;
  onQuoteSubmitted: (quote: SupplierPortalQuoteView) => void;
  onDeclined: (rfq: SupplierPortalRfqView) => void;
}) {
  const deadlinePassed = isDeadlineOverdue(rfq.status, rfq.deadline);
  const rfqClosed = rfq.status === "CLOSED" || rfq.status === "CANCELLED";

  return (
    <>
      <div className="card">
        <h1 style={{ marginBottom: "0.25rem" }}>{rfq.rfqNumber}</h1>
        <div className="meta-grid">
          <div>
            <div className="meta-label">Срок ответа</div>
            <div className="meta-value">{formatDeadline(rfq.deadline)}</div>
          </div>
          {rfq.supplierInstructions && (
            <div style={{ gridColumn: "1 / -1" }}>
              <div className="meta-label">Инструкции</div>
              <div className="meta-value">{rfq.supplierInstructions}</div>
            </div>
          )}
        </div>
      </div>

      <PortalItemsList items={rfq.items} />

      {rfq.myQuote ? (
        <PortalQuoteReadonly quote={rfq.myQuote} />
      ) : rfq.myStatus === "DECLINED" ? (
        <PortalDeclinedNotice />
      ) : rfqClosed ? (
        <div className="card">
          <p className="muted">{rfq.status === "CLOSED" ? "Этот запрос закрыт. Отправка предложения недоступна." : "Этот запрос отменён. Отправка предложения недоступна."}</p>
        </div>
      ) : deadlinePassed ? (
        <div className="card">
          <p className="muted">Срок ответа по этому запросу истёк. Отправка предложения недоступна.</p>
        </div>
      ) : (
        <>
          <PortalQuoteForm items={rfq.items} onSubmitted={onQuoteSubmitted} />
          <PortalDeclineButton onDeclined={onDeclined} />
        </>
      )}
    </>
  );
}
