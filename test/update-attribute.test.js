/**
 * Unit tests for `newo update-attribute` — the pure body-builder helper.
 *
 * The command GETs the current attribute, overlays only the flags the caller
 * passed, and PUTs the full object back (so no metadata is lost). The reference
 * platform request (Builder UI) sends the complete object including
 * is_read_only, possible_values, and value_type — the earlier implementation
 * projected to a fixed 8-field subset and silently dropped is_read_only on every
 * edit. buildAttributeUpdateBody is the metadata-faithful merge that fixes that.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAttributeUpdateBody } from '../dist/cli/commands/update-attribute.js';

// A representative attribute exactly as the platform returns it (mirrors the
// reference curl's --data-raw shape, plus the `id` the GET includes).
function sampleAttribute(overrides = {}) {
  return {
    id: '371b7cd4-1577-42c9-926a-1b5b9a1311a7',
    idn: 'project_attributes_setting_test_mode',
    value: 'False',
    title: 'Testing - Test Mode [C] [IMPORTANT]',
    description: 'This setting switches booking flows into test behavior.',
    group: '4. Agent Behavior - Advanced',
    is_hidden: true,
    is_read_only: false,
    possible_values: [],
    value_type: 'bool',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Metadata preservation
// ---------------------------------------------------------------------------

test('drops id from the body (id belongs in the URL, not the payload)', () => {
  const body = buildAttributeUpdateBody(sampleAttribute(), { value: 'True' });
  assert.equal('id' in body, false);
});

test('preserves is_read_only and every other field the platform returned', () => {
  const current = sampleAttribute();
  const body = buildAttributeUpdateBody(current, { value: 'True' });
  // Every field except id is carried over verbatim...
  assert.equal(body.is_read_only, false);
  assert.equal(body.is_hidden, true);
  assert.equal(body.idn, current.idn);
  assert.equal(body.title, current.title);
  assert.equal(body.description, current.description);
  assert.equal(body.group, current.group);
  assert.deepEqual(body.possible_values, []);
  assert.equal(body.value_type, 'bool');
  // ...only value changes.
  assert.equal(body.value, 'True');
});

test('carries an unknown/extra field through untouched (future-proof round-trip)', () => {
  const current = sampleAttribute({ some_future_field: 'keep-me' });
  const body = buildAttributeUpdateBody(current, { value: 'True' });
  assert.equal(body.some_future_field, 'keep-me');
});

// ---------------------------------------------------------------------------
// Falsy value handling (the --value 0 / "" / false trap)
// ---------------------------------------------------------------------------

test('applies an empty-string value instead of leaving the old value', () => {
  const body = buildAttributeUpdateBody(sampleAttribute({ value: 'x' }), { value: '' });
  assert.equal(body.value, '');
});

test('applies "0" and "False" values', () => {
  assert.equal(buildAttributeUpdateBody(sampleAttribute(), { value: '0' }).value, '0');
  assert.equal(buildAttributeUpdateBody(sampleAttribute({ value: 'True' }), { value: 'False' }).value, 'False');
});

test('leaves value untouched when no value override is given', () => {
  const body = buildAttributeUpdateBody(sampleAttribute({ value: 'keep' }), { title: 'New title' });
  assert.equal(body.value, 'keep');
  assert.equal(body.title, 'New title');
});

// ---------------------------------------------------------------------------
// Field overrides
// ---------------------------------------------------------------------------

test('overlays title, description, group, is_hidden, value_type, possible_values', () => {
  const body = buildAttributeUpdateBody(sampleAttribute(), {
    title: 'T',
    description: 'D',
    group: 'G',
    is_hidden: false,
    value_type: 'string',
    possible_values: ['a', 'b'],
  });
  assert.equal(body.title, 'T');
  assert.equal(body.description, 'D');
  assert.equal(body.group, 'G');
  assert.equal(body.is_hidden, false);
  assert.equal(body.value_type, 'string');
  assert.deepEqual(body.possible_values, ['a', 'b']);
});

// ---------------------------------------------------------------------------
// JSON-typed values (canvas-safety)
// ---------------------------------------------------------------------------

test('compacts a JSON-typed value to a single-line STRING', () => {
  const current = sampleAttribute({ value_type: 'json', value: '{}' });
  const pretty = '{\n  "a": 1,\n  "b": [1, 2]\n}';
  const body = buildAttributeUpdateBody(current, { value: pretty });
  assert.equal(typeof body.value, 'string');
  assert.equal(body.value.includes('\n'), false);
  assert.deepEqual(JSON.parse(body.value), { a: 1, b: [1, 2] });
});

test('normalizes against the NEW value_type when type and value change together', () => {
  // current type is string, but caller switches to json AND sets a pretty value
  const current = sampleAttribute({ value_type: 'string', value: 'x' });
  const body = buildAttributeUpdateBody(current, {
    value_type: 'json',
    value: '{\n  "k": "v"\n}',
  });
  assert.equal(body.value_type, 'json');
  assert.equal(body.value.includes('\n'), false);
  assert.deepEqual(JSON.parse(body.value), { k: 'v' });
});

test('does NOT JSON-normalize a plain string value', () => {
  const current = sampleAttribute({ value_type: 'string', value: 'old' });
  const body = buildAttributeUpdateBody(current, { value: 'line one\nline two' });
  // plain string preserved verbatim (newline kept, not compacted)
  assert.equal(body.value, 'line one\nline two');
});
