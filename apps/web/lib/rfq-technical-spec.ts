/**
 * Pure value-formatting logic for `technicalSpec` (`Record<string, unknown> |
 * null`, Phase D §55 / Phase E §19-20) — split out of the `TechnicalSpec`
 * component so it can be unit-tested under this app's `lib`-only Jest config
 * (no jsdom/React Testing Library in this codebase, and Phase E explicitly
 * says not to add one). `technicalSpec` has no fixed schema — any individual
 * value could be a string/number/boolean/null/nested object/array — so this
 * must NEVER return a raw object/array (which would crash React with
 * "Objects are not valid as a React child" if handed straight to a child
 * position); it always coerces to a plain string, safely, even for a
 * circular reference (`JSON.stringify` throws — caught, falls back to a
 * placeholder rather than propagating).
 */
export function formatSpecValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "—";
  }
}
