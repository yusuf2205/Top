import type { SupplierPortalQuoteView, SupplierPortalRfqView } from "@top/types";
import type { SubmitQuoteInput } from "@top/validation";
import { getPortalToken } from "./portal-token";

/**
 * M3.4 Phase D §7/§38/§39 — a dedicated, fully isolated API client for the
 * public Supplier Portal. Deliberately does NOT import/touch
 * `api-client.ts`'s internal-JWT `accessToken`/`request()`/refresh flow —
 * the portal token is a completely different credential (an RFQSupplier's
 * own opaque bearer token, resolved by `PortalAuthGuard`, never the
 * internal JWT). This client must work in a clean/incognito browser with no
 * TOP Procurement login session at all, so it never sends
 * `credentials: "include"` either (the portal has no cookie-based session —
 * every request stands alone, authenticated only by the `Authorization`
 * header this client attaches from `getPortalToken()`).
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class PortalApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

async function portalRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getPortalToken();
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    // Network-level failure (no HTTP response at all) — distinct from any
    // HTTP status the backend itself returned (Phase D §40).
    throw new PortalApiError(0, "NETWORK_ERROR", "Network request failed");
  }

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new PortalApiError(res.status, body.code ?? "ERROR", body.message ?? "Request failed");
  }
  return body as T;
}

export const portalApi = {
  open: () => portalRequest<SupplierPortalRfqView>("/api/v1/portal/rfq/open", { method: "POST" }),
  get: () => portalRequest<SupplierPortalRfqView>("/api/v1/portal/rfq"),
  submitQuote: (input: SubmitQuoteInput) => portalRequest<SupplierPortalQuoteView>("/api/v1/portal/rfq/quote", { method: "POST", body: JSON.stringify(input) }),
  decline: () => portalRequest<SupplierPortalRfqView>("/api/v1/portal/rfq/decline", { method: "POST" }),
};
