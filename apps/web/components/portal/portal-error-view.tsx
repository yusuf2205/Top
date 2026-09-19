"use client";

import type { PortalErrorState } from "../../lib/portal-error";

/**
 * M3.4 Phase D §19/§20/§40 — one distinct, friendly message per error kind.
 * Never renders a raw backend stack/error object. "invalid-link"/"no-token"
 * deliberately share the same visual treatment (a calm, final state — no
 * retry loop, per §19), while rate-limited/server-error offer a retry
 * action since those ARE expected to resolve on their own shortly.
 */
export function PortalErrorView({ error, onRetry }: { error: PortalErrorState; onRetry?: () => void }) {
  return (
    <div className="card" style={{ textAlign: "center" }}>
      <p>{error.message}</p>
      {(error.kind === "rate-limited" || error.kind === "server-error" || error.kind === "network-error") && onRetry && (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          Попробовать снова
        </button>
      )}
    </div>
  );
}

export function PortalNoTokenView() {
  return (
    <div className="card" style={{ textAlign: "center" }}>
      <p>Ссылка больше недоступна в этой вкладке. Откройте исходную ссылку повторно.</p>
    </div>
  );
}
