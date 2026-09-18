const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseLocalDateParts(value: string): [number, number, number] | null {
  if (!value) return null;
  const match = DATE_RE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return [year, month, day];
}

/**
 * Local-calendar-day <-> ISO instant conversion for the RFQ created-date
 * range filter (Phase E final fix). An HTML `<input type="date">` value
 * ("YYYY-MM-DD") carries no timezone — it means the VIEWER's own local
 * calendar day, e.g. a UTC+5 user picking "17.09.2026" means their local
 * 17 September, not UTC 17 September. The RFQ list query's
 * `createdAtFrom`/`createdAtTo` are matched with Prisma `gte`/`lte` directly
 * against `createdAt` (apps/api/src/rfqs/rfqs.service.ts) — both ends
 * INCLUSIVE — so the correct boundary instants are the viewer's local
 * midnight through the viewer's local 23:59:59.999, built with the
 * multi-argument `Date` constructor (which is defined to use the host's
 * local timezone), never a bare `"YYYY-MM-DDT00:00:00.000Z"` string (that
 * would silently shift the boundary by the viewer's own UTC offset).
 *
 * Both return `undefined` — never throw, never produce an `Invalid Date` —
 * for an empty or malformed value, so the caller can simply omit the query
 * parameter rather than ever send something the backend would reject.
 */
export function localDateStartToIso(value: string): string | undefined {
  const parsed = parseLocalDateParts(value);
  if (!parsed) return undefined;
  const [year, month, day] = parsed;
  const d = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

export function localDateEndToIso(value: string): string | undefined {
  const parsed = parseLocalDateParts(value);
  if (!parsed) return undefined;
  const [year, month, day] = parsed;
  const d = new Date(year, month - 1, day, 23, 59, 59, 999);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

/**
 * Inverse — renders a persisted UTC instant back into the LOCAL calendar day
 * a `<input type="date">` expects, so re-opening the filter bar shows the day
 * the viewer actually picked (never a naive `.slice(0, 10)` off the raw ISO
 * string, which would show the WRONG day whenever the local/UTC offset
 * crosses midnight). Same local-getter discipline as `isoToDeadlineLocal`.
 */
export function isoToLocalDateInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
