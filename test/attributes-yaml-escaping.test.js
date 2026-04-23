/**
 * Regression tests for attributes.yaml serialization.
 *
 * Bug: the pre-fix code ran `replace(/\\"/g, '"')` on the YAML output to
 * prettify JSON-looking values, which stripped legitimate backslash-escapes
 * from double-quoted scalars. That produced invalid YAML like
 *   value: "["+37410333310"]"
 * which then caused `newo push --format newo_v2` to fail at load time.
 *
 * These tests exercise the post-processing pipeline (yaml.dump →
 * patchYamlToPyyaml) with values known to break the old output, and assert
 * that the generated YAML parses back to the original values.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';
import { patchYamlToPyyaml } from '../dist/format/yaml-patch.js';

function serializeAttributes(attrs) {
  const clean = attrs.map(a => ({
    idn: a.idn,
    value: a.value,
    title: a.title ?? '',
    description: a.description ?? '',
    group: a.group ?? '',
    is_hidden: a.is_hidden ?? false,
    possible_values: a.possible_values ?? [],
    value_type: `__ENUM_PLACEHOLDER_${a.value_type ?? 'STRING'}__`,
  }));
  let out = yaml.dump({ attributes: clean }, {
    indent: 2,
    quotingType: '"',
    forceQuotes: false,
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
    flowLevel: -1,
  });
  out = out.replace(/__ENUM_PLACEHOLDER_(\w+)__/g, '!enum "AttributeValueTypes.$1"');
  return patchYamlToPyyaml(out);
}

function parseAfterStrippingEnumTag(yamlText) {
  return yaml.load(yamlText.replace(/!enum "AttributeValueTypes\.(\w+)"/g, '$1'));
}

test('phone-list style JSON array with quotes parses back intact', () => {
  const original = '["+37410333310"]';
  const out = serializeAttributes([{ idn: 'phones', value: original }]);
  assert.match(out, /value: '\["\+37410333310"]'/,
    'should be single-quoted (not broken double-quoted)');
  const parsed = parseAfterStrippingEnumTag(out);
  assert.equal(parsed.attributes[0].value, original);
});

test('nested JSON object with quotes round-trips', () => {
  const original = '[{"id":1,"name":"AMI"}]';
  const out = serializeAttributes([{ idn: 'items', value: original }]);
  const parsed = parseAfterStrippingEnumTag(out);
  assert.equal(parsed.attributes[0].value, original);
});

test('long AMI-like string with embedded quotes round-trips', () => {
  const original =
    'Line one with "quoted" words. ' +
    'Another segment with more "quoted" bits and "even more" literal quotes, ' +
    'continuing past 80 columns to force the pyyaml continuation wrapping.';
  const out = serializeAttributes([{ idn: 'ami_long', value: original }]);
  const parsed = parseAfterStrippingEnumTag(out);
  assert.equal(parsed.attributes[0].value, original);
});

test('plain scalar with embedded double quotes round-trips', () => {
  const original = 'She said "hi"';
  const out = serializeAttributes([{ idn: 'plain', value: original }]);
  const parsed = parseAfterStrippingEnumTag(out);
  assert.equal(parsed.attributes[0].value, original);
});

test('value with both single and double quotes round-trips', () => {
  const original = `It's "quoted" and complicated`;
  const out = serializeAttributes([{ idn: 'mixed', value: original }]);
  const parsed = parseAfterStrippingEnumTag(out);
  assert.equal(parsed.attributes[0].value, original);
});

test('multiline value round-trips', () => {
  const original = 'line1\nline2\nline with "quote"\nline4';
  const out = serializeAttributes([{ idn: 'multi', value: original }]);
  const parsed = parseAfterStrippingEnumTag(out);
  assert.equal(parsed.attributes[0].value, original);
});

test('falsy values (0, false, empty string) preserved', () => {
  const attrs = [
    { idn: 'zero',  value: 0,      value_type: 'NUMBER' },
    { idn: 'bfalse', value: false, value_type: 'BOOL'   },
    { idn: 'empty', value: '',     value_type: 'STRING' },
  ];
  const out = serializeAttributes(attrs);
  const parsed = parseAfterStrippingEnumTag(out);
  assert.equal(parsed.attributes[0].value, 0);
  assert.equal(parsed.attributes[1].value, false);
  assert.equal(parsed.attributes[2].value, '');
});

test('null value preserved', () => {
  const out = serializeAttributes([{ idn: 'n', value: null }]);
  const parsed = parseAfterStrippingEnumTag(out);
  assert.equal(parsed.attributes[0].value, null);
});

test('pre-fix broken output regressed (guardrail)', () => {
  // Simulate what the old buggy code produced and confirm js-yaml rejects it.
  // This codifies that the invalid shape must never be written again.
  const broken = [
    'attributes:',
    '  - idn: phones',
    '    value: "["+37410333310"]"',
    '    title: ""',
    '',
  ].join('\n');
  assert.throws(() => yaml.load(broken), /mapping entry|unexpected end|unidentified alias|indent/);
});

test('deeply nested JSON round-trips', () => {
  const original = '{"nested":{"arr":["a","b","c with \\"quote\\""]}}';
  const out = serializeAttributes([{ idn: 'deep', value: original }]);
  const parsed = parseAfterStrippingEnumTag(out);
  assert.equal(parsed.attributes[0].value, original);
});

test('value_type enum tag round-trips', () => {
  const out = serializeAttributes([{ idn: 'vt', value: 'x', value_type: 'NUMBER' }]);
  assert.match(out, /!enum "AttributeValueTypes\.NUMBER"/);
  const parsed = parseAfterStrippingEnumTag(out);
  assert.equal(parsed.attributes[0].value_type, 'NUMBER');
});
