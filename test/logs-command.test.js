import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  collectLogsForDisplay,
  fetchAndDisplayLogs
} from '../dist/cli/commands/logs.js';

function logEntry(id, name, datetime = '2026-06-16T10:00:00.000Z') {
  return {
    log_id: id,
    level: 'info',
    log_type: 'call',
    project_idn: 'proj',
    data: {
      name,
      flow_idn: 'Flow',
      skill_idn: 'Skill'
    },
    message: `${name} message`,
    datetime
  };
}

async function captureConsoleLog(fn) {
  const originalLog = console.log;
  const lines = [];
  console.log = (...args) => {
    lines.push(args.join(' '));
  };

  try {
    await fn();
  } finally {
    console.log = originalLog;
  }

  return lines;
}

async function withMockNewoApi(handler, fn) {
  const requests = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    requests.push({
      method: req.method,
      pathname: url.pathname,
      query: Object.fromEntries(url.searchParams.entries())
    });

    if (req.method === 'POST' && url.pathname === '/api/v1/auth/api-key/token') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        access_token: 'access-token-for-cli-test',
        refresh_token: 'refresh-token-for-cli-test',
        expires_in: 3600
      }));
      return;
    }

    const response = handler(req.method, url);
    res.writeHead(response.status || 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(response.body));
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    return await fn(baseUrl, requests);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function runCli(args, env) {
  const cliPath = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  const cwd = await mkdtemp(path.join(tmpdir(), 'newo-cli-logs-test-'));

  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      env: {
        PATH: process.env.PATH,
        HOME: cwd,
        ...env
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`CLI timed out: ${args.join(' ')}`));
    }, 10_000);

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

test('collectLogsForDisplay paginates when filtering by data.name', async () => {
  const calls = [];
  const pages = {
    1: [logEntry('1', 'Other'), logEntry('2', 'Other')],
    2: [logEntry('3', 'Gen'), logEntry('4', 'Other')],
    3: []
  };

  const logs = await collectLogsForDisplay(
    {},
    { page: 1, per: 2 },
    'Gen',
    async (_client, params) => {
      calls.push(params.page);
      return { items: pages[params.page] || [] };
    }
  );

  assert.deepEqual(calls, [1, 2, 3]);
  assert.deepEqual(logs.map(log => log.log_id), ['3']);
});

test('collectLogsForDisplay fetches a single page without name filter', async () => {
  const calls = [];

  const logs = await collectLogsForDisplay(
    {},
    { page: 2, per: 2 },
    null,
    async (_client, params) => {
      calls.push(params.page);
      return { items: [logEntry('2', 'Gen')] };
    }
  );

  assert.deepEqual(calls, [2]);
  assert.deepEqual(logs.map(log => log.log_id), ['2']);
});

test('fetchAndDisplayLogs --raw prints only JSONL records', async () => {
  const lines = await captureConsoleLog(async () => {
    await fetchAndDisplayLogs(
      {},
      { page: 1, per: 2 },
      false,
      true,
      null,
      async () => ({
        items: [
          logEntry('2', 'Gen', '2026-06-16T10:00:02.000Z'),
          logEntry('1', 'Gen', '2026-06-16T10:00:01.000Z')
        ]
      })
    );
  });

  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map(line => JSON.parse(line).log_id), ['1', '2']);
  assert.ok(lines.every(line => line.startsWith('{') && line.endsWith('}')));
});

test('fetchAndDisplayLogs --raw prints nothing for empty results', async () => {
  const lines = await captureConsoleLog(async () => {
    await fetchAndDisplayLogs(
      {},
      { page: 1, per: 2 },
      false,
      true,
      null,
      async () => ({ items: [] })
    );
  });

  assert.deepEqual(lines, []);
});

test('CLI logs --raw emits only JSONL records', async () => {
  await withMockNewoApi(
    (method, url) => {
      assert.equal(method, 'GET');
      assert.equal(url.pathname, '/api/v1/analytics/logs');
      return {
        body: {
          items: [
            logEntry('2', 'Gen', '2026-06-16T10:00:02.000Z'),
            logEntry('1', 'Gen', '2026-06-16T10:00:01.000Z')
          ]
        }
      };
    },
    async baseUrl => {
      const result = await runCli(
        ['logs', '--raw', '--per', '2', '--hours', '1'],
        {
          NEWO_BASE_URL: baseUrl,
          NEWO_API_KEY: 'cli-test-api-key'
        }
      );

      assert.equal(result.code, 0, result.stderr);
      const lines = result.stdout.trim().split('\n');
      assert.equal(lines.length, 2);
      assert.deepEqual(lines.map(line => JSON.parse(line).log_id), ['1', '2']);
      assert.ok(lines.every(line => line.startsWith('{') && line.endsWith('}')));
      assert.equal(result.stderr, '');
    }
  );
});

test('CLI logs --name paginates through the entrypoint', async () => {
  const pages = {
    1: [logEntry('1', 'Other'), logEntry('2', 'Other')],
    2: [logEntry('3', 'Gen'), logEntry('4', 'Other')],
    3: []
  };

  await withMockNewoApi(
    (method, url) => {
      assert.equal(method, 'GET');
      assert.equal(url.pathname, '/api/v1/analytics/logs');
      const page = Number(url.searchParams.get('page') || '1');
      return { body: { items: pages[page] || [] } };
    },
    async (baseUrl, requests) => {
      const result = await runCli(
        ['logs', '--name', 'Gen', '--json', '--per', '2', '--hours', '1'],
        {
          NEWO_BASE_URL: baseUrl,
          NEWO_API_KEY: 'cli-test-api-key'
        }
      );

      assert.equal(result.code, 0, result.stderr);
      const logs = JSON.parse(result.stdout);
      assert.deepEqual(logs.map(log => log.log_id), ['3']);
      assert.equal(result.stderr, '');

      const logPages = requests
        .filter(request => request.pathname === '/api/v1/analytics/logs')
        .map(request => Number(request.query.page));
      assert.deepEqual(logPages, [1, 2, 3]);
    }
  );
});
