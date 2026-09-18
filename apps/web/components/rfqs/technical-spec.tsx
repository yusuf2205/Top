import { formatSpecValue } from "../../lib/rfq-technical-spec";

/**
 * technicalSpec is `Record<string, unknown> | null` — an arbitrary bag of
 * key/value pairs with no fixed schema (Phase D §55). No PR UI renderer
 * exists yet to reuse, so this is a small, deliberately generic key/value
 * table: never `JSON.stringify` dumped as a wall of text, never
 * `dangerouslySetInnerHTML`, and never a schema-specific renderer built for
 * fields that don't exist yet. `formatSpecValue` (lib/rfq-technical-spec.ts)
 * always coerces every value — including a nested object/array — to a plain
 * string before it ever reaches JSX, so this can never crash with "Objects
 * are not valid as a React child" regardless of what shape a given
 * organization's data happens to have (Phase E §19). Long values wrap via
 * the existing `.meta-value` `overflow-wrap: break-word` rule rather than
 * being truncated — nothing is silently dropped (Phase E §20).
 */
export function TechnicalSpec({ spec }: { spec: Record<string, unknown> | null }) {
  if (!spec || Object.keys(spec).length === 0) return null;

  return (
    <dl className="meta-grid" style={{ marginTop: "0.5rem" }}>
      {Object.entries(spec).map(([key, value]) => (
        <div key={key}>
          <div className="meta-label">{key}</div>
          <div className="meta-value">{formatSpecValue(value)}</div>
        </div>
      ))}
    </dl>
  );
}
