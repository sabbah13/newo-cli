/**
 * Regression tests for `value_type: json` attribute round-trips.
 *
 * Bug (reported by Bob, Apr 2026):
 *   After `newo pull` followed by `newo push --only attributes`, the
 *   Workflow Builder canvas in the NEWO UI shows a blank screen. The
 *   project attribute `project_attributes_private_dynamic_workflow_builder_canvas`
 *   has `value_type: json`, and the CLI was sending a different shape on
 *   push than what the platform expects to read back into Builder.
 *
 * Two failure modes existed:
 *
 *   1. The API can return the `value` field as either a JSON STRING or
 *      an already-parsed OBJECT (`value: string | object`). When it
 *      returned an object, `yaml.dump` serialized it as a YAML structure
 *      (mappings/sequences). On the next push the CLI sent
 *      `{"value": {...object...}}` instead of `{"value": "...json..."}`,
 *      and the platform stored it in a shape Builder couldn't render.
 *
 *   2. The push-time change check used `String(localAttr.value)`. With
 *      objects this collapses to `"[object Object]"` on both sides
 *      (silently masking real changes), and with mismatched string vs
 *      object representations it spuriously triggered pushes that
 *      overwrote the canvas with the wrong shape.
 *
 * The fix in `src/sync/json-attr-utils.ts` always coerces JSON-typed
 * values to a STRING when persisting and when pushing, and uses
 * canonical (compact) JSON for change comparison.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';
import { patchYamlToPyyaml } from '../dist/format/yaml-patch.js';
import {
  isJsonValueType,
  normalizeJsonValueForStorage,
  canonicalJsonValue,
  jsonValuesEqual,
} from '../dist/sync/json-attr-utils.js';

// ---------------------------------------------------------------------------
// isJsonValueType
// ---------------------------------------------------------------------------

test('isJsonValueType matches "json" and "JSON" case-insensitively', () => {
  assert.equal(isJsonValueType('json'), true);
  assert.equal(isJsonValueType('JSON'), true);
  assert.equal(isJsonValueType('Json'), true);
});

test('isJsonValueType matches enum-prefixed forms (AttributeValueTypes.json, ValueType.JSON)', () => {
  assert.equal(isJsonValueType('AttributeValueTypes.json'), true);
  assert.equal(isJsonValueType('ValueType.JSON'), true);
});

test('isJsonValueType returns false for non-json types', () => {
  assert.equal(isJsonValueType('string'), false);
  assert.equal(isJsonValueType('number'), false);
  assert.equal(isJsonValueType('enum'), false);
  assert.equal(isJsonValueType('AttributeValueTypes.string'), false);
  assert.equal(isJsonValueType(undefined), false);
  assert.equal(isJsonValueType(null), false);
});

// ---------------------------------------------------------------------------
// normalizeJsonValueForStorage
// ---------------------------------------------------------------------------

test('normalizeJsonValueForStorage converts an object value to compact JSON string', () => {
  const obj = { title: 'Workflow Builder', types: [{ idn: 'a' }] };
  const out = normalizeJsonValueForStorage(obj);
  assert.equal(typeof out, 'string');
  assert.equal(out, '{"title":"Workflow Builder","types":[{"idn":"a"}]}');
});

test('normalizeJsonValueForStorage leaves string values untouched (preserves pretty-printing)', () => {
  // We deliberately do NOT reformat string values, even if they look
  // like JSON, to avoid huge spurious diffs on first re-pull.
  const pretty = '{\n  "title": "X",\n  "description": "Step 1.\\n\\nStep 2."\n}';
  assert.equal(normalizeJsonValueForStorage(pretty), pretty);
});

test('normalizeJsonValueForStorage returns "" for null/undefined', () => {
  assert.equal(normalizeJsonValueForStorage(null), '');
  assert.equal(normalizeJsonValueForStorage(undefined), '');
});

// ---------------------------------------------------------------------------
// canonicalJsonValue / jsonValuesEqual
// ---------------------------------------------------------------------------

test('canonicalJsonValue produces the same form for pretty and compact JSON strings', () => {
  const pretty = '{\n  "a": 1,\n  "b": 2\n}';
  const compact = '{"a":1,"b":2}';
  assert.equal(canonicalJsonValue(pretty), canonicalJsonValue(compact));
});

test('jsonValuesEqual: pretty vs compact JSON string compare equal', () => {
  const pretty = '{\n  "a": 1,\n  "b": 2\n}';
  const compact = '{"a":1,"b":2}';
  assert.equal(jsonValuesEqual(pretty, compact), true);
});

test('jsonValuesEqual: object vs equivalent JSON string compare equal', () => {
  const obj = { a: 1, b: 2 };
  const str = '{"a":1,"b":2}';
  assert.equal(jsonValuesEqual(obj, str), true);
  assert.equal(jsonValuesEqual(str, obj), true);
});

test('jsonValuesEqual: object vs object compare equal', () => {
  const a = { x: [1, 2], y: 'z' };
  const b = { x: [1, 2], y: 'z' };
  assert.equal(jsonValuesEqual(a, b), true);
});

test('jsonValuesEqual: detects a real semantic change in the canvas', () => {
  const before = { types: [{ idn: 'a' }] };
  const after  = { types: [{ idn: 'b' }] };
  assert.equal(jsonValuesEqual(before, after), false);
});

// ---------------------------------------------------------------------------
// End-to-end: API returns OBJECT → save → push must send a STRING
// ---------------------------------------------------------------------------

/**
 * Replicate the path through saveCustomerAttributes/saveProjectAttributes
 * just enough to verify that an object-valued json attribute is stored
 * as a string (never as a YAML structure).
 */
function persistJsonAttr(rawValue, value_type = 'json') {
  // This mirrors the cleanAttribute() logic in src/sync/attributes.ts
  const processedValue = isJsonValueType(value_type)
    ? normalizeJsonValueForStorage(rawValue)
    : rawValue;

  const attr = {
    idn: 'workflow_builder_canvas',
    value: processedValue,
    title: '',
    description: '',
    group: '',
    is_hidden: false,
    possible_values: [],
    value_type: `__ENUM_PLACEHOLDER_${value_type}__`,
  };

  let yamlContent = yaml.dump({ attributes: [attr] }, {
    indent: 2,
    quotingType: '"',
    forceQuotes: false,
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
    flowLevel: -1,
  });
  yamlContent = yamlContent.replace(/__ENUM_PLACEHOLDER_(\w+)__/g, '!enum "AttributeValueTypes.$1"');
  return patchYamlToPyyaml(yamlContent);
}

function loadAttr(yamlText) {
  return yaml.load(yamlText.replace(/!enum "AttributeValueTypes\.(\w+)"/g, '$1'))
    .attributes[0];
}

test('object value is persisted as a STRING in YAML, not as a YAML structure', () => {
  // Pre-fix bug: yaml.dump would emit `value:\n  title: X\n  types:\n    ...`
  // and the next push would send the object back to the platform.
  const canvasObject = {
    title: 'Workflow Builder',
    types: [{ idn: 'introduction', description: 'Step 1.\n\nStep 2.' }],
  };
  const out = persistJsonAttr(canvasObject, 'json');

  // The YAML must NOT contain a nested structure under `value`.
  // Rather, it must look like `value: '{...}'` or `value: |-\n  {...}`.
  assert.ok(/^\s*value: ['|"][^\n]/m.test(out) || /value: \|/m.test(out),
    'value should be serialized as a scalar (string), not as a YAML mapping');
  assert.ok(!/^\s*value:\s*$/m.test(out),
    'value must not be an empty key followed by a YAML structure');

  // Round-trip: re-loaded value is a string.
  const reloaded = loadAttr(out);
  assert.equal(typeof reloaded.value, 'string',
    'value must be a STRING after round-trip, not an object');

  // The string parses back to the original canvas.
  assert.deepEqual(JSON.parse(reloaded.value), canvasObject);
});

test('string value with real newlines is preserved bit-for-bit through round-trip', () => {
  // This is the common case: the API returned the canvas as a
  // pretty-printed JSON string, with real newlines between fields and
  // \n escapes inside string values. Existing customer YAML files look
  // exactly like this — we must not change anything.
  const original = '{\n  "title": "X",\n  "description": "Step 1.\\n\\nStep 2."\n}';
  const out = persistJsonAttr(original, 'json');
  const reloaded = loadAttr(out);
  assert.equal(reloaded.value, original);
});

test('compact JSON string with embedded \\n inside string fields round-trips intact', () => {
  // Compact form, common when Builder UI saves the canvas.
  const original = '{"description":"Step 1.\\nStep 2."}';
  const out = persistJsonAttr(original, 'json');
  const reloaded = loadAttr(out);
  assert.equal(reloaded.value, original);
  // And after JSON.parse, the description has a real newline.
  assert.equal(JSON.parse(reloaded.value).description, 'Step 1.\nStep 2.');
});

// ---------------------------------------------------------------------------
// Push payload shape check (the actual bug)
// ---------------------------------------------------------------------------

/**
 * Mirror the push-side payload construction from
 * src/sync/attributes.ts/pushProjectAttributes and
 * AttributeSyncStrategy.pushProjectAttributes.
 */
function buildPushValue(localValue, value_type) {
  return isJsonValueType(value_type)
    ? normalizeJsonValueForStorage(localValue)
    : localValue;
}

test('push always sends JSON-typed value as a STRING (never an object)', () => {
  // Even if the YAML loader handed us an object (e.g. legacy file with a
  // YAML structure under `value`), we must coerce to string before the
  // PUT body is built — otherwise the platform stores it as a parsed
  // object and Builder blanks out.
  const canvasObject = { title: 'X', types: [] };
  const valueToSend = buildPushValue(canvasObject, 'json');
  assert.equal(typeof valueToSend, 'string');
  // And the resulting HTTP body has `"value": "..."`, not `"value": {...}`.
  const body = JSON.stringify({ value: valueToSend });
  assert.ok(body.startsWith('{"value":"'),
    `expected stringified value, got: ${body.slice(0, 60)}...`);
});

test('non-JSON attribute push payload is unchanged (regression guard)', () => {
  // The fix must only touch json-typed attributes. String/number/enum
  // attributes flow through exactly as before.
  assert.equal(buildPushValue('Impress Dental', 'string'), 'Impress Dental');
  assert.equal(buildPushValue(0, 'number'), 0);
  assert.equal(buildPushValue(false, 'bool'), false);
  assert.equal(buildPushValue('', 'string'), '');
});

// ---------------------------------------------------------------------------
// Change-detection regression
// ---------------------------------------------------------------------------

test('change-detection: object-valued local does not spuriously diff against string-valued remote', () => {
  // Pre-fix this would compare "[object Object]" vs "{...JSON...}" and
  // trigger a push that broke Builder.
  const local = { title: 'Workflow Builder', types: [] };
  const remote = '{"title":"Workflow Builder","types":[]}';
  assert.equal(jsonValuesEqual(local, remote), true,
    'object-vs-string canvas should compare equal (no spurious push)');
});

test('change-detection: pretty-printed local does not spuriously diff against compact remote', () => {
  // Pre-fix this would compare the pretty string against the compact
  // string and trigger a push every time, even when nothing changed.
  const local  = '{\n  "a": 1\n}';
  const remote = '{"a":1}';
  assert.equal(jsonValuesEqual(local, remote), true,
    'pretty vs compact canvas should compare equal (no spurious push)');
});

test('change-detection: real edit is still detected', () => {
  const local  = '{"types":[{"idn":"a"}]}';
  const remote = '{"types":[{"idn":"b"}]}';
  assert.equal(jsonValuesEqual(local, remote), false);
});
