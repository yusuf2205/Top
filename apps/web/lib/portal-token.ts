/**
 * M3.4 Phase D §5/§6/§37 — Supplier Portal token bootstrap + in-memory-only
 * storage. The raw portal token enters ONLY via the URL fragment
 * (`/portal/rfq#token=<raw>`), is read once, held in a module-level
 * variable, and the fragment is stripped immediately via
 * `history.replaceState` before any other page interaction. There is
 * deliberately NO localStorage/sessionStorage/IndexedDB/cookie persistence —
 * a full page refresh loses the token, which is intentional (§6): weakening
 * storage to solve the refresh UX is explicitly forbidden.
 *
 * Split into pure functions (`extractTokenFromHash`) — unit-testable without
 * jsdom — and the DOM-touching bootstrap (`bootstrapPortalToken`), which this
 * repo's Jest config cannot exercise (no jsdom/testing-library; see
 * `rfq-technical-spec.ts`'s own note on the same constraint) and is instead
 * left to browser acceptance testing.
 */

let token: string | null = null;

export function getPortalToken(): string | null {
  return token;
}

/** Test-only escape hatch — production code never calls this directly, only `bootstrapPortalToken`. */
export function setPortalToken(value: string | null): void {
  token = value;
}

/**
 * Pure: given a `location.hash` string (with or without the leading `#`),
 * extracts and URL-decodes the `token` fragment parameter, or `null` if
 * absent/empty. Never throws on a malformed hash — a corrupt/garbage
 * fragment simply yields `null` (treated the same as "no token" by the page,
 * which then shows the invalid/missing-link state).
 */
export function extractTokenFromHash(hash: string): string | null {
  const trimmed = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!trimmed) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(trimmed);
  } catch {
    return null;
  }
  const raw = params.get("token");
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Reads `window.location.hash` once, stores the extracted token in memory,
 * and strips the fragment via `history.replaceState` (§37 — the token must
 * never remain visible in the URL bar, DOM, browser history entry text, or
 * anywhere else after this call). Idempotent: calling it again after the
 * fragment has already been stripped simply finds no token and leaves the
 * in-memory value untouched (a component remount within the same tab must
 * not lose an already-bootstrapped token).
 */
export function bootstrapPortalToken(): string | null {
  if (typeof window === "undefined") return token;
  const extracted = extractTokenFromHash(window.location.hash);
  if (extracted) {
    token = extracted;
    const url = window.location.pathname + window.location.search;
    window.history.replaceState(null, "", url);
  }
  return token;
}
