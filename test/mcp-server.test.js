/**
 * Integration test for the NEWO MCP server.
 *
 * Spawns `node dist/cli.js mcp serve`, drives a JSON-RPC handshake over its
 * stdio, and asserts:
 *
 *   - Server boots and responds to `initialize` with the expected protocol
 *     version and serverInfo.
 *   - `tools/list` returns all six tools with `inputSchema` fields.
 *   - `tools/call` against `newo_list_customers` (no network, reads env)
 *     returns a structured response.
 *   - Stderr stays free of stray stdout writes (no JSON-RPC corruption).
 *
 * Skipped automatically if the dist build is missing — keeps the test suite
 * green on a fresh clone where the user hasn't run `npm run build` yet.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLI = resolve(__dirname, '..', 'dist', 'cli.js');

function runMcpHandshake(messages, timeoutMs = 5000) {
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn('node', [CLI, 'mcp', 'serve'], {
      env: { ...process.env, NEWO_QUIET_MODE: 'true' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      rejectResult(new Error(`MCP server timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      rejectResult(err);
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolveResult({ stdout, stderr });
    });

    // Pipe each message followed by a newline.
    for (const m of messages) {
      child.stdin.write(JSON.stringify(m) + '\n');
    }

    // Give the server a beat to finish writing, then close stdin.
    setTimeout(() => child.stdin.end(), 1500);
  });
}

function parseJsonRpcFrames(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return { _parseError: true, raw: l };
      }
    });
}

test('mcp serve responds to initialize with serverInfo', { skip: !existsSync(CLI) }, async () => {
  const { stdout, stderr } = await runMcpHandshake([
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
  ]);

  // Stderr should contain the readiness banner, nothing else dramatic.
  assert.match(stderr, /server ready/, `stderr missing readiness banner: ${stderr}`);

  const frames = parseJsonRpcFrames(stdout);
  const initResponse = frames.find((f) => f.id === 1);
  assert.ok(initResponse, `no init response in stdout: ${stdout}`);
  assert.equal(initResponse.jsonrpc, '2.0');
  assert.ok(initResponse.result, 'init result missing');
  assert.equal(initResponse.result.serverInfo.name, 'newo-mcp');
  assert.equal(initResponse.result.serverInfo.version, '3.8.0');
});

test('tools/list returns all six tools with inputSchema', { skip: !existsSync(CLI) }, async () => {
  const { stdout } = await runMcpHandshake([
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ]);

  const frames = parseJsonRpcFrames(stdout);
  const listResponse = frames.find((f) => f.id === 2);
  assert.ok(listResponse, `no tools/list response: ${stdout}`);

  const tools = listResponse.result.tools;
  assert.equal(tools.length, 6, `expected 6 tools, got ${tools.length}`);

  const expectedNames = [
    'newo_list_customers',
    'newo_profile',
    'newo_list_actions',
    'newo_logs',
    'newo_test',
    'newo_status',
  ];
  for (const name of expectedNames) {
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool, `missing tool: ${name}`);
    assert.ok(tool.description, `tool ${name} missing description`);
    assert.ok(tool.inputSchema, `tool ${name} missing inputSchema`);
  }
});

test('tools/call newo_list_customers returns structured content', { skip: !existsSync(CLI) }, async () => {
  const { stdout } = await runMcpHandshake([
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'newo_list_customers', arguments: {} },
    },
  ]);

  const frames = parseJsonRpcFrames(stdout);
  const callResponse = frames.find((f) => f.id === 2);
  assert.ok(callResponse, `no tools/call response: ${stdout}`);
  assert.ok(callResponse.result, `call result missing`);

  const { content, structuredContent } = callResponse.result;
  assert.ok(Array.isArray(content) && content.length > 0, 'content missing');
  assert.equal(content[0].type, 'text');
  assert.match(content[0].text, /customer/i, 'text content does not mention customers');
  assert.ok(structuredContent, 'structuredContent missing');
  assert.ok(Array.isArray(structuredContent.customers), 'structuredContent.customers not an array');
});

test('mcp tools --json prints tool catalog (no server boot)', { skip: !existsSync(CLI) }, async () => {
  const child = spawn('node', [CLI, 'mcp', 'tools', '--json'], {
    env: { ...process.env, NEWO_QUIET_MODE: 'true' },
  });
  let out = '';
  child.stdout.on('data', (c) => (out += c.toString('utf8')));
  await new Promise((r) => child.on('close', r));
  const parsed = JSON.parse(out);
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed.length, 6);
  for (const t of parsed) {
    assert.ok(t.name && t.name.startsWith('newo_'));
    assert.ok(t.description && t.description.length > 30);
  }
});
