/**
 * Tests for `newo lint` primitives: discovery + reporters.
 *
 * Covers the glue between newo-cli and newo-dsl-analyzer. The analyzer
 * itself is tested by its own package under newo-dsl-lsp/packages/*.
 */
import assert from 'assert';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { describe, it, before, after } from 'node:test';

import { discoverFromPath } from '../dist/lint/discovery.js';
import { pickReporter } from '../dist/lint/reporters/index.js';
import { createLinter } from 'newo-dsl-analyzer';

describe('lint discovery', () => {
  let tmpDir;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'newo-lint-test-'));
    await fs.writeFile(path.join(tmpDir, 'a.jinja'), '{{SendMessage(message="hi")}}');
    await fs.writeFile(path.join(tmpDir, 'b.guidance'), '{{#system}}hello{{/system}}');
    await fs.writeFile(path.join(tmpDir, 'c.nsl'), '{% set x = 1 %}');
    await fs.writeFile(path.join(tmpDir, 'd.nslg'), '{{#user}}hi{{/user}}');
    await fs.writeFile(path.join(tmpDir, 'e.txt'), 'not a script file');
    const nested = path.join(tmpDir, 'nested', 'deep');
    await fs.ensureDir(nested);
    await fs.writeFile(path.join(nested, 'f.jinja'), '{% if x %}y{% endif %}');
  });

  after(async () => {
    await fs.remove(tmpDir);
  });

  it('finds all four DSL extensions by default', async () => {
    const found = await discoverFromPath(tmpDir);
    const names = found.map(f => path.basename(f.absPath)).sort();
    assert.deepStrictEqual(names, ['a.jinja', 'b.guidance', 'c.nsl', 'd.nslg', 'f.jinja']);
  });

  it('restricts to cli_v1 extensions when --format cli_v1', async () => {
    const found = await discoverFromPath(tmpDir, { format: 'cli_v1' });
    const names = found.map(f => path.basename(f.absPath)).sort();
    assert.deepStrictEqual(names, ['a.jinja', 'b.guidance', 'f.jinja']);
  });

  it('restricts to newo_v2 extensions when --format newo_v2', async () => {
    const found = await discoverFromPath(tmpDir, { format: 'newo_v2' });
    const names = found.map(f => path.basename(f.absPath)).sort();
    assert.deepStrictEqual(names, ['c.nsl', 'd.nslg']);
  });

  it('accepts a single file path', async () => {
    const filePath = path.join(tmpDir, 'a.jinja');
    const found = await discoverFromPath(filePath);
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].absPath, filePath);
  });

  it('returns empty for a missing path', async () => {
    const found = await discoverFromPath(path.join(tmpDir, 'nonexistent'));
    assert.deepStrictEqual(found, []);
  });
});

describe('lint reporter selection', () => {
  it('returns text reporter by default', () => {
    const reporter = pickReporter(undefined);
    assert.ok(typeof reporter.write === 'function');
  });

  it('returns json reporter for "json"', () => {
    const reporter = pickReporter('json');
    const out = reporter.write({ results: [], errorCount: 0, warningCount: 0 });
    const parsed = JSON.parse(out);
    assert.deepStrictEqual(parsed, { results: [], errorCount: 0, warningCount: 0 });
  });

  it('returns SARIF 2.1.0 envelope for "sarif"', () => {
    const reporter = pickReporter('sarif');
    const out = reporter.write({ results: [], errorCount: 0, warningCount: 0 });
    const parsed = JSON.parse(out);
    assert.strictEqual(parsed.version, '2.1.0');
    assert.ok(Array.isArray(parsed.runs));
    assert.strictEqual(parsed.runs[0].tool.driver.name, 'newo-lint');
  });
});

describe('analyzer integration via createLinter', () => {
  it('detects unknown functions and reports W101', () => {
    const linter = createLinter();
    const source = '{{UnknownFunctionXYZZY(foo="bar")}}';
    const result = linter.lint(source, '/fake/path.jinja');
    const codes = result.diagnostics.map(d => d.code);
    assert.ok(codes.includes('W101'), `expected W101 in ${codes.join(',')}`);
  });

  it('honors off overrides via rules option', () => {
    const linter = createLinter({ rules: { W101: 'off' } });
    const source = '{{UnknownFunctionXYZZY(foo="bar")}}';
    const result = linter.lint(source, '/fake/path.jinja');
    const codes = result.diagnostics.map(d => d.code);
    assert.ok(!codes.includes('W101'), `W101 should be suppressed, got ${codes.join(',')}`);
  });

  it('returns a stable ProjectLintReport shape from lintProject', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'newo-lint-proj-'));
    try {
      await fs.writeFile(path.join(tmp, 'a.jinja'), '{{SendMessage(message="ok")}}');
      const linter = createLinter();
      const report = linter.lintProject(tmp);
      assert.ok(Array.isArray(report.results));
      assert.strictEqual(typeof report.errorCount, 'number');
      assert.strictEqual(typeof report.warningCount, 'number');
    } finally {
      await fs.remove(tmp);
    }
  });
});
