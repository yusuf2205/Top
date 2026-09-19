"use client";

import { useEffect, useState } from "react";
import type { SupplierPortalQuoteView, SupplierPortalRfqView } from "@top/types";
import { bootstrapPortalToken } from "../../../lib/portal-token";
import { portalApi, PortalApiError } from "../../../lib/portal-api-client";
import { classifyPortalError, type PortalErrorState } from "../../../lib/portal-error";
import { PortalErrorView, PortalNoTokenView } from "../../../components/portal/portal-error-view";
import { PortalRfqView } from "../../../components/portal/portal-rfq-view";

/**
 * M3.4 Phase D §5/§6/§40 — the public Supplier Portal entry point. No
 * `ProtectedRoute`/`AppShell` (mirrors the existing `/invite/[token]` public
 * route, apps/web/app/invite/[token]/page.tsx) — this page must work in a
 * clean/incognito browser with zero TOP Procurement login session.
 *
 * State machine: bootstrapping -> (no-token | error | ready). Once ready,
 * `PortalRfqView` owns all further state routing from the RFQ data itself
 * (submitted/declined/closed/deadline-passed) — this component only ever
 * calls the portal API ONCE up front (`open`, one time, on mount) plus
 * whatever the child components trigger explicitly on user action (§42/§44
 * — no polling, no effect-driven mutation calls).
 */
type PageState = { kind: "loading" } | { kind: "no-token" } | { kind: "error"; error: PortalErrorState } | { kind: "ready"; rfq: SupplierPortalRfqView };

export default function PortalRfqPage() {
  const [state, setState] = useState<PageState>({ kind: "loading" });

  async function load() {
    const token = bootstrapPortalToken();
    if (!token) {
      setState({ kind: "no-token" });
      return;
    }
    setState({ kind: "loading" });
    try {
      const rfq = await portalApi.open();
      setState({ kind: "ready", rfq });
    } catch (err) {
      const statusCode = err instanceof PortalApiError ? err.statusCode || null : null;
      setState({ kind: "error", error: classifyPortalError(statusCode) });
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="portal-page">
      {state.kind === "loading" && <p className="muted">Загрузка…</p>}
      {state.kind === "no-token" && <PortalNoTokenView />}
      {state.kind === "error" && <PortalErrorView error={state.error} onRetry={state.error.kind !== "invalid-link" ? load : undefined} />}
      {state.kind === "ready" && (
        <PortalRfqView
          rfq={state.rfq}
          // §42: use the returned SupplierPortalQuoteView directly — no
          // redundant GET. The rest of `rfq` (items/deadline/etc.) is
          // unchanged by a submit, only myStatus/myQuote need updating.
          onQuoteSubmitted={(quote: SupplierPortalQuoteView) => setState((s) => (s.kind === "ready" ? { kind: "ready", rfq: { ...s.rfq, myStatus: "SUBMITTED", myQuote: quote } } : s))}
          // decline already returns the full updated view — use it directly.
          onDeclined={(rfq: SupplierPortalRfqView) => setState({ kind: "ready", rfq })}
        />
      )}
    </main>
  );
}
