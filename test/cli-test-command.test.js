/**
 * Spawn-CLI integration tests for `newo test` (CLI-TEST-1 st-02), on the
 * test/logs-command.test.js mock-API pattern: a loopback HTTP server
 * (listen(0, 127.0.0.1)) stands in for the NEWO platform, a 10s kill guard
 * bounds every spawn, and every request the CLI makes is recorded in
 * requests[] so "zero API calls" claims are actually verified, not assumed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PERSONA_ID = 'persona-1';
const ACTOR_ID = 'actor-1';

/**
 * Mock NEWO platform for a `newo test` run: auth, connector discovery,
 * persona/actor creation, and a scripted chat history keyed off how many
 * user turns have been sent so far (config.replies[turnIndex - 1]; `null`
 * means "the agent never replies", i.e. a timeout).
 *
 * config.replies[i] may also be an array of strings - a multi-bubble reply,
 * revealed progressively (bubble N only appears once this turn has been
 * polled N+1 times), so callers can drive the settle-window collection path.
 *
 * config.authStatus - non-200 status to return from the auth endpoint (setup-phase
 *   failure regression).
 * config.sendFailsOnTurn - 1-based turn index whose send request 500s (run-phase
 *   failure regression - the error propagates out of `sendMessage`, unswallowed).
 * config.omitExternalEventId - when true, chat-history items omit `external_event_id`
 *   entirely, so the converter's `'chat_history'` placeholder fallback kicks in
 *   (regression for `normalizeActEventId`'s guard).
 */
async function withMockNewoApi(config, fn) {
  const requests = [];
  const state = { sendCount: 0, historyPollCounts: {} };

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    requests.push({ method: req.method, pathname: url.pathname });

    const respond = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.method === 'POST' && url.pathname === '/api/v1/auth/api-key/token') {
      if (config.authStatus && config.authStatus !== 200) {
        return respond(config.authStatus, { error: 'auth failed (mocked)' });
      }
      return respond(200, {
        access_token: 'access-token-for-cli-test',
        refresh_token: 'refresh-token-for-cli-test',
        expires_in: 3600
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/integrations') {
      return respond(200, [{ id: 'int-sandbox', idn: 'sandbox', title: 'Sandbox' }]);
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/integrations/int-sandbox/connectors') {
      return respond(200, [
        { id: 'c1', connector_idn: config.connectorIdn || 'vibe_agent', integration_idn: 'sandbox', status: 'running', title: 'Vibe' }
      ]);
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/customer/personas') {
      return respond(200, { id: PERSONA_ID });
    }
    if (req.method === 'POST' && url.pathname === `/api/v1/customer/personas/${PERSONA_ID}/actors`) {
      return respond(200, { id: ACTOR_ID });
    }
    if (req.method === 'POST' && url.pathname === `/api/v1/chat/user/${ACTOR_ID}`) {
      state.sendCount += 1;
      if (config.sendFailsOnTurn && state.sendCount === config.sendFailsOnTurn) {
        return respond(500, { error: 'send failed (mocked)' });
      }
      return respond(200, {});
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/chat/history') {
      const turnIndex = state.sendCount;
      if (turnIndex === 0) return respond(200, { items: [] });

      state.historyPollCounts[turnIndex] = (state.historyPollCounts[turnIndex] || 0) + 1;
      const pollCount = state.historyPollCounts[turnIndex];

      const reply = config.replies[turnIndex - 1];
      const now = new Date().toISOString();
      const items = [
        {
          id: `u${turnIndex}`,
          is_agent: false,
          external_event_id: config.omitExternalEventId ? undefined : `user-evt-${turnIndex}`,
          datetime: now,
          payload: { text: 'turn' }
        }
      ];

      if (Array.isArray(reply)) {
        // Multi-bubble: bubble i only appears once this turn has been polled i+1 times.
        reply.forEach((bubbleText, bubbleIndex) => {
          if (pollCount <= bubbleIndex) return;
          items.unshift({
            id: `a${turnIndex}_${bubbleIndex}`,
            is_agent: true,
            external_event_id: config.omitExternalEventId ? undefined : `agent-evt-${turnIndex}-${bubbleIndex}`,
            datetime: now,
            payload: { text: bubbleText },
            flow_idn: 'TestFlow',
            skill_idn: 'TestSkill',
            session_id: `sess-${turnIndex}`
          });
        });
      } else if (reply !== null && reply !== undefined) {
        items.unshift({
          id: `a${turnIndex}`,
          is_agent: true,
          external_event_id: config.omitExternalEventId ? undefined : `agent-evt-${turnIndex}`,
          datetime: now,
          payload: { text: reply },
          flow_idn: 'TestFlow',
          skill_idn: 'TestSkill',
          session_id: `sess-${turnIndex}`
        });
      }
      return respond(200, { items });
    }

    respond(404, { error: `unhandled ${req.method} ${url.pathname}` });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    return await fn(baseUrl, requests, state);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function writeScenario(dir, name, content) {
  const filePath = path.join(dir, name);
  await writeFile(filePath, content, 'utf8');
  return filePath;
}

async function runCli(args, env) {
  const cliPath = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  const cwd = await mkdtemp(path.join(tmpdir(), 'newo-cli-test-cmd-'));

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
      resolve({ code, stdout, stderr, cwd });
    });
  });
}

const ALL_PASS_SCENARIO = `
name: all pass
turns:
  - message: "Hi"
    expect:
      contains: "Hello"
  - message: "Bye"
    expect:
      contains: "Goodbye"
`;

test('CLI test: every turn passes -> exit 0, --json matches the design contract', async () => {
  await withMockNewoApi({ replies: ['Hello there!', 'Goodbye now'] }, async (baseUrl, requests) => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'newo-cli-test-scenario-'));
    const scenarioPath = await writeScenario(cwd, 'scenario.yaml', ALL_PASS_SCENARIO);

    const result = await runCli(['test', scenarioPath, '--json', '--timeout', '5'], {
      NEWO_BASE_URL: baseUrl,
      NEWO_API_KEY: 'cli-test-api-key'
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, '');

    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.passed, true);
    assert.equal(parsed.connector_idn, 'vibe_agent');
    assert.deepEqual(parsed.summary, { total: 2, passed: 2, failed: 0, skipped: 0 });
    assert.equal(parsed.turns.length, 2);

    assert.equal(parsed.turns[0].status, 'pass');
    assert.equal(parsed.turns[0].response, 'Hello there!');
    assert.equal(parsed.turns[0].user_external_event_id, 'user-evt-1');
    assert.equal(parsed.turns[0].agent_external_event_id, 'agent-evt-1');
    assert.equal(parsed.turns[0].flow_idn, 'TestFlow');
    assert.equal(parsed.turns[0].skill_idn, 'TestSkill');
    assert.equal(parsed.turns[0].session_id, 'sess-1');
    assert.ok(typeof parsed.turns[0].elapsed_ms === 'number');

    assert.equal(parsed.turns[1].status, 'pass');
    assert.equal(parsed.turns[1].user_external_event_id, 'user-evt-2');

    const sendRequests = requests.filter(r => r.pathname === `/api/v1/chat/user/${ACTOR_ID}`);
    assert.equal(sendRequests.length, 2, 'both turns were sent');
  });
});

test('CLI test: a failing turn aborts the run, skips remaining turns, and exits 1', async () => {
  const scenario = `
turns:
  - message: "Hi"
    expect:
      contains: "Hello"
  - message: "Where is my order?"
    expect:
      contains: "tracking number"
  - message: "Never sent"
    expect:
      contains: "anything"
`;

  await withMockNewoApi({ replies: ['Hello there!', 'I have no idea what you mean'] }, async (baseUrl, requests) => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'newo-cli-test-scenario-'));
    const scenarioPath = await writeScenario(cwd, 'scenario.yaml', scenario);

    const result = await runCli(['test', scenarioPath, '--json', '--timeout', '5'], {
      NEWO_BASE_URL: baseUrl,
      NEWO_API_KEY: 'cli-test-api-key'
    });

    assert.equal(result.code, 1);
    const parsed = JSON.parse(result.stdout);

    assert.equal(parsed.passed, false);
    assert.deepEqual(parsed.summary, { total: 3, passed: 1, failed: 1, skipped: 1 });

    assert.equal(parsed.turns[0].status, 'pass');
    assert.equal(parsed.turns[1].status, 'fail');
    assert.ok(parsed.turns[1].failures.some(f => f.includes('tracking number')));

    assert.deepEqual(parsed.turns[2], {
      index: 3,
      message: 'Never sent',
      status: 'skipped',
      reason: 'aborted after turn 2 failure'
    });

    // The skipped turn's message was never sent to the platform.
    const sendRequests = requests.filter(r => r.pathname === `/api/v1/chat/user/${ACTOR_ID}`);
    assert.equal(sendRequests.length, 2, 'only the first two turns were sent');
  });
});

test('CLI test: human-readable failure output shows expected vs actual and a logs hint', async () => {
  const scenario = `
turns:
  - message: "Where is my order?"
    expect:
      contains: "tracking number"
`;

  await withMockNewoApi({ replies: ['I have no idea what you mean'] }, async (baseUrl) => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'newo-cli-test-scenario-'));
    const scenarioPath = await writeScenario(cwd, 'scenario.yaml', scenario);

    const result = await runCli(['test', scenarioPath, '--timeout', '5'], {
      NEWO_BASE_URL: baseUrl,
      NEWO_API_KEY: 'cli-test-api-key'
    });

    assert.equal(result.code, 1);
    assert.match(result.stdout, /FAIL/);
    assert.match(result.stdout, /Expected: contains "tracking number": not found in response/);
    assert.match(result.stdout, /Actual: I have no idea what you mean/);
    assert.match(result.stdout, /Event ID \(user turn\): user-evt-1/);
    assert.match(result.stdout, /newo logs --event-id user-evt-1/);
  });
});

test('CLI test: a turn that never gets a reply is classified as timeout, not a hang or crash', async () => {
  const scenario = `
turns:
  - message: "Hi"
    timeout: 1
    expect:
      contains: "Hello"
`;

  await withMockNewoApi({ replies: [null] }, async (baseUrl) => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'newo-cli-test-scenario-'));
    const scenarioPath = await writeScenario(cwd, 'scenario.yaml', scenario);

    const result = await runCli(['test', scenarioPath, '--json'], {
      NEWO_BASE_URL: baseUrl,
      NEWO_API_KEY: 'cli-test-api-key'
    });

    assert.equal(result.code, 1);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.turns[0].status, 'timeout');
    assert.ok(parsed.turns[0].failures.some(f => f.includes('timed out')));
    assert.equal(parsed.turns[0].agent_external_event_id, null);
  });
});

test('CLI test: malformed scenario YAML exits non-zero before any API call is made', async () => {
  const scenario = `
turns:
  - message: "Hi"
    expect:
      conatins: "Hello"
`;

  await withMockNewoApi({ replies: [] }, async (baseUrl, requests) => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'newo-cli-test-scenario-'));
    const scenarioPath = await writeScenario(cwd, 'scenario.yaml', scenario);

    const result = await runCli(['test', scenarioPath], {
      NEWO_BASE_URL: baseUrl,
      NEWO_API_KEY: 'cli-test-api-key'
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /unknown key "conatins"/);
    assert.equal(requests.length, 0, 'no request (not even auth) was made before validation failed');
  });
});

test('CLI test: a missing scenario file exits non-zero before any API call is made', async () => {
  await withMockNewoApi({ replies: [] }, async (baseUrl, requests) => {
    const result = await runCli(['test', '/no/such/scenario.yaml'], {
      NEWO_BASE_URL: baseUrl,
      NEWO_API_KEY: 'cli-test-api-key'
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /Scenario file not found/);
    assert.equal(requests.length, 0);
  });
});

test('CLI test: --connector not among running connectors reuses findSandboxConnector\'s error text', async () => {
  await withMockNewoApi({ replies: [] }, async (baseUrl, requests) => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'newo-cli-test-scenario-'));
    const scenarioPath = await writeScenario(cwd, 'scenario.yaml', ALL_PASS_SCENARIO);

    const result = await runCli(['test', scenarioPath, '--connector', 'no_such_connector'], {
      NEWO_BASE_URL: baseUrl,
      NEWO_API_KEY: 'cli-test-api-key'
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /Connector 'no_such_connector' not found among running connectors.*Available: vibe_agent/s);

    // Setup failure: connector discovery ran, but no persona/actor was ever created.
    const personaRequests = requests.filter(r => r.pathname === '/api/v1/customer/personas');
    assert.equal(personaRequests.length, 0);
  });
});

test('CLI test: a reply split across multiple chat bubbles is fully collected and joined for assertions (judge round-0 must-fix 1)', async () => {
  const scenario = `
turns:
  - message: "Where is my order?"
    expect:
      contains: ["Order found", "Tracking number 12345"]
`;

  await withMockNewoApi({ replies: [['Order found.', 'Tracking number 12345.']] }, async (baseUrl, requests) => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'newo-cli-test-scenario-'));
    const scenarioPath = await writeScenario(cwd, 'scenario.yaml', scenario);

    const result = await runCli(['test', scenarioPath, '--json', '--timeout', '8'], {
      NEWO_BASE_URL: baseUrl,
      NEWO_API_KEY: 'cli-test-api-key'
    });

    assert.equal(result.code, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);

    assert.equal(parsed.turns[0].status, 'pass');
    // Both bubbles' source_text, joined with \n in chronological (act) order -
    // asserting only the newest bubble would make this fail on "Order found.".
    assert.equal(parsed.turns[0].response, 'Order found.\nTracking number 12345.');

    // The second bubble only appears on a later poll - proves the runner kept
    // polling past the first agent act instead of returning immediately.
    const historyRequests = requests.filter(r => r.pathname === '/api/v1/chat/history');
    assert.ok(historyRequests.length >= 2, `expected multiple history polls, got ${historyRequests.length}`);
  });
});

test('CLI test --json: a setup-phase failure (auth error) emits one {error, phase, file} object and exits 1 (judge round-0 must-fix 3)', async () => {
  await withMockNewoApi({ replies: [], authStatus: 500 }, async (baseUrl) => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'newo-cli-test-scenario-'));
    const scenarioPath = await writeScenario(cwd, 'scenario.yaml', ALL_PASS_SCENARIO);

    const result = await runCli(['test', scenarioPath, '--json'], {
      NEWO_BASE_URL: baseUrl,
      NEWO_API_KEY: 'cli-test-api-key'
    });

    assert.equal(result.code, 1);
    const parsed = JSON.parse(result.stdout);
    assert.equal(typeof parsed.error, 'string');
    assert.ok(parsed.error.length > 0);
    assert.equal(parsed.phase, 'setup');
    assert.equal(parsed.file, scenarioPath);
    // This is the error contract, not the turns-shaped result.
    assert.equal(parsed.turns, undefined);
  });
});

test('CLI test --json: an unexpected mid-run failure (send 500 on turn 2) emits one {error, phase: "run", file} object and exits 1 (judge round-0 must-fix 3)', async () => {
  const scenario = `
turns:
  - message: "Hi"
    expect:
      contains: "Hello"
  - message: "Second turn"
    expect:
      contains: "anything"
`;

  await withMockNewoApi({ replies: ['Hello there!'], sendFailsOnTurn: 2 }, async (baseUrl) => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'newo-cli-test-scenario-'));
    const scenarioPath = await writeScenario(cwd, 'scenario.yaml', scenario);

    const result = await runCli(['test', scenarioPath, '--json', '--timeout', '5'], {
      NEWO_BASE_URL: baseUrl,
      NEWO_API_KEY: 'cli-test-api-key'
    });

    assert.equal(result.code, 1);
    const parsed = JSON.parse(result.stdout);
    assert.equal(typeof parsed.error, 'string');
    assert.equal(parsed.phase, 'run');
    assert.equal(parsed.file, scenarioPath);
    assert.equal(parsed.turns, undefined);
  });
});

test('CLI test --json: a chat-history item without external_event_id yields null correlation fields (normalizeActEventId guard, judge round-0 nice-to-have)', async () => {
  await withMockNewoApi({ replies: ['Hello there!'], omitExternalEventId: true }, async (baseUrl) => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'newo-cli-test-scenario-'));
    const scenarioPath = await writeScenario(cwd, 'scenario.yaml', `
turns:
  - message: "Hi"
    expect:
      contains: "Hello"
`);

    const result = await runCli(['test', scenarioPath, '--json', '--timeout', '5'], {
      NEWO_BASE_URL: baseUrl,
      NEWO_API_KEY: 'cli-test-api-key'
    });

    assert.equal(result.code, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.turns[0].status, 'pass');
    // The converter falls back to the 'chat_history' placeholder when the API
    // omits external_event_id - normalizeActEventId must guard against ever
    // surfacing that placeholder as a real correlation key.
    assert.equal(parsed.turns[0].user_external_event_id, null);
    assert.equal(parsed.turns[0].agent_external_event_id, null);
  });
});

test('CLI test --help prints test-specific help, not the global summary', async () => {
  const result = await runCli(['test', '--help'], {});

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Usage: newo test <scenario-file\.yaml> \[options\]/);
  assert.match(result.stdout, /--timeout <seconds>/);
  assert.match(result.stdout, /fail-fast/);
  // Must NOT fall through to the global multi-command help screen.
  assert.doesNotMatch(result.stdout, /NEWO CLI - Multi-Customer Support/);
});
