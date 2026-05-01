/**
 * JSON-typed attribute helpers.
 *
 * Why this exists:
 *
 * The NEWO platform stores some attributes (e.g.
 * `project_attributes_private_dynamic_workflow_builder_canvas`) as
 * `value_type: json`. The API may return the `value` field as either a
 * STRING containing JSON or as an already-parsed OBJECT.
 *
 * Without normalization, two bugs leak through:
 *
 * 1. When the API returns the value as an OBJECT, `yaml.dump` serializes
 *    it as a YAML structure (mappings/sequences). Pushing back then sends
 *    `{"value": {...}}` instead of `{"value": "..."}`, breaking the
 *    Workflow Builder which expects the canvas as a JSON STRING.
 *
 * 2. The push-time change check used `String(localAttr.value)` for
 *    comparison. With objects this collapses to `"[object Object]"` on
 *    both sides — silently masking real changes — and with mismatched
 *    string vs object representations it triggers spurious pushes that
 *    overwrite the canvas with the wrong shape (Builder shows blank).
 *
 * The fix is conservative: for `value_type: json` only, always coerce the
 * value to a STRING when persisting and when pushing, and use canonical
 * JSON for comparisons. String-typed values in the wild are left
 * untouched, so no churn for the majority of attributes.
 */

/**
 * True if the attribute is a JSON-typed attribute (case- and
 * format-insensitive: handles `json`, `JSON`, `AttributeValueTypes.json`,
 * `ValueType.JSON`, etc.).
 */
export function isJsonValueType(valueType: unknown): boolean {
  if (typeof valueType !== 'string') return false;
  const lower = valueType.toLowerCase();
  return lower === 'json' || lower.endsWith('.json');
}

/**
 * Coerce a JSON-typed attribute's value to a STRING suitable for storage
 * in attributes.yaml and for sending to the platform.
 *
 * - `null` / `undefined` → `''`
 * - object → compact JSON string (`JSON.stringify(value)`)
 * - string → returned as-is (we trust the platform's existing format)
 * - other → `String(value)`
 *
 * We deliberately do NOT re-format string values, even when they look
 * like JSON. Many existing canvases are stored pretty-printed and
 * reformatting would create huge spurious diffs in users' repos.
 */
export function normalizeJsonValueForStorage(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * Canonical comparison for JSON-typed attribute values.
 *
 * Returns the canonical form (compact JSON if parseable, otherwise the
 * raw string). Use this on both sides of a comparison so that pretty- vs
 * compact-printed JSON does not register as a change, and so that an
 * object on one side equals its stringified form on the other side.
 */
export function canonicalJsonValue(value: unknown): string {
  const stringified = normalizeJsonValueForStorage(value);
  if (stringified === '') return '';
  try {
    return JSON.stringify(JSON.parse(stringified));
  } catch {
    return stringified;
  }
}

/**
 * True if two JSON-typed attribute values are semantically equal.
 *
 * Handles the four mismatched representations that can occur during a
 * pull/push cycle:
 *   string vs string (different whitespace/indent), object vs string,
 *   string vs object, object vs object.
 */
export function jsonValuesEqual(a: unknown, b: unknown): boolean {
  return canonicalJsonValue(a) === canonicalJsonValue(b);
}
