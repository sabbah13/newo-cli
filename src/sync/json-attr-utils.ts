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
 * Without normalization, several bugs leak through:
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
 * 3. (Bug 3.7.2-a) Canvas JSON strings with structural newlines (real
 *    U+000A between tokens) can be emitted by yaml.dump as double-quoted
 *    scalars with `\n` escape sequences. patchYamlToPyyaml then converts
 *    those to single-quoted YAML scalars, where `\n` is treated as two
 *    literal chars (backslash + n). On push the platform stores those
 *    literal chars and the Builder calls JSON.parse, which fails on
 *    backslash-n as structural whitespace.
 *
 * 4. (Bug 3.7.2-b) Canvas body text contains Markdown with `\_`
 *    (backslash + underscore). `\_` is not a valid JSON escape sequence
 *    per RFC 8259 (valid ones: " \ / b f n r t uXXXX). Chrome V8's
 *    JSON.parse is strict: it throws SyntaxError on `\_`, silently
 *    blanking the Builder.
 *
 * The fix for (3) and (4): for `value_type: json` string values, repair
 * invalid escape sequences (escaping the stray backslash so the literal
 * text is preserved) then compact via JSON.parse + JSON.stringify.
 * Compaction removes structural newlines and re-serializes all string
 * values with only valid JSON escapes, producing a single-line string
 * that round-trips through YAML without corruption.
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
 * Fix invalid JSON escape sequences inside JSON string values.
 *
 * Per RFC 8259, valid escape sequences inside a JSON string are:
 *   \" \\ \/ \b \f \n \r \t \uXXXX
 * Anything else (e.g. `\_` `\.` from Markdown) is invalid and causes
 * JSON.parse to throw. Fix: escape the stray backslash (e.g. `\_` →
 * `\\_`), which JSON.parse decodes back to the literal `\_` — preserving
 * the Markdown escape rather than dropping it to a bare `_` (which would
 * let paired underscores render as italics in the Builder).
 *
 * Only modifies characters inside JSON string values (tracks quote
 * context). Structural characters outside strings are untouched.
 */
export function fixInvalidJsonEscapes(s: string): string {
  const VALID_ESCAPES = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u']);
  const result: string[] = [];
  let inString = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (inString) {
      if (c === '\\' && i + 1 < s.length) {
        const next = s[i + 1]!;
        if (VALID_ESCAPES.has(next)) {
          result.push(c, next);
        } else {
          // Escape the stray backslash instead of dropping it, so the
          // literal text is preserved (\_ → \\_, which JSON.parse decodes
          // back to \_). Dropping it (\_ → _) silently alters Markdown:
          // paired underscores then render as emphasis/italics in Builder.
          result.push('\\', '\\', next);
        }
        i += 2;
        continue;
      } else if (c === '"') {
        inString = false;
        result.push(c);
      } else {
        result.push(c);
      }
    } else {
      if (c === '"') {
        inString = true;
        result.push(c);
      } else {
        result.push(c);
      }
    }
    i++;
  }
  return result.join('');
}

/**
 * Coerce a JSON-typed attribute's value to a STRING suitable for storage
 * in attributes.yaml and for sending to the platform.
 *
 * - `null` / `undefined` → `''`
 * - object → compact JSON string (`JSON.stringify(value)`)
 * - string → fix invalid escapes (e.g. `\_` → `_`), then compact via
 *            JSON.parse + JSON.stringify. If parsing still fails after
 *            fixing escapes, return the fixed string as-is.
 * - other → `String(value)`
 *
 * Compacting removes structural newlines and guarantees a single-line
 * string that yaml.dump serializes without escape-sequence corruption in
 * the patchYamlToPyyaml pass. See module-level comment for full context.
 */
export function normalizeJsonValueForStorage(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') {
    const fixed = fixInvalidJsonEscapes(value);
    try {
      return JSON.stringify(JSON.parse(fixed));
    } catch {
      return fixed;
    }
  }
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
 * fixed string). Use this on both sides of a comparison so that pretty-
 * vs compact-printed JSON does not register as a change, and so that an
 * object on one side equals its stringified form on the other side.
 */
export function canonicalJsonValue(value: unknown): string {
  return normalizeJsonValueForStorage(value);
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
