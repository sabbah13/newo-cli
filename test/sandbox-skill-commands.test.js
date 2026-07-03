/**
 * Unit tests for v3.8.0 features (newo_cli_improvement_requirements.md):
 *
 *   R1 - sandbox connector selection:
 *        findSandboxConnector(client, verbose, {integrationIdn, connectorIdn})
 *        and listRunningSandboxConnectors()
 *   R2 - pollForResponse custom timeout
 *   R3 - resolveRemoteSkill() IDN-path resolution and parseModelFlag()
 *
 * All tests use a fake axios client (plain object with a get() handler),
 * no network access required.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'node:path';

import {
  findSandboxConnector,
  listRunningSandboxConnectors,
  pollForResponse
} from '../dist/sandbox/chat.js';
import { resolveRemoteSkill, parseModelFlag } from '../dist/sync/remote-skill.js';
import { findLocalProjectWorkspace } from '../dist/cli/commands/update-skill.js';

/**
 * Build a fake axios client backed by a routes map: url -> response data.
 * Supports exact matches only (params are ignored).
 */
function fakeClient(routes) {
  return {
    async get(url) {
      if (url in routes) {
        return { data: routes[url] };
      }
      const err = new Error(`fakeClient: unexpected GET ${url}`);
      err.response = { status: 404 };
      throw err;
    }
  };
}

function scriptedChatHistoryClient(polls) {
  let index = 0;
  return {
    async get(url) {
      if (url !== '/api/v1/chat/history') {
        throw new Error(`unexpected GET ${url}`);
      }
      const items = polls[Math.min(index, polls.length - 1)] || [];
      index++;
      return { data: { items } };
    }
  };
}

function sandboxSession(overrides = {}) {
  return {
    user_persona_id: 'p1',
    user_actor_id: 'a1',
    agent_persona_id: 'agent-persona',
    connector_idn: 'sandbox',
    session_id: 's1',
    external_id: 'x',
    ...overrides
  };
}

const SANDBOX_ROUTES = {
  '/api/v1/integrations': [
    { id: 'int-sandbox', idn: 'sandbox', title: 'Sandbox' },
    { id: 'int-api', idn: 'api', title: 'API' }
  ],
  '/api/v1/integrations/int-sandbox/connectors': [
    { id: 'c1', connector_idn: 'convo_agent_sandbox', integration_idn: 'sandbox', status: 'running', title: 'Convo', settings: [] },
    { id: 'c2', connector_idn: 'vibe_agent', integration_idn: 'sandbox', status: 'running', title: 'Vibe', settings: [] },
    { id: 'c3', connector_idn: 'stopped_agent', integration_idn: 'sandbox', status: 'stopped', title: 'Stopped', settings: [] }
  ]
};

// --- R1: connector selection ---

test('findSandboxConnector without options keeps legacy behavior (first running)', async () => {
  const connector = await findSandboxConnector(fakeClient(SANDBOX_ROUTES), false);
  assert.equal(connector.connector_idn, 'convo_agent_sandbox');
});

test('findSandboxConnector selects exact connector by connectorIdn', async () => {
  const connector = await findSandboxConnector(fakeClient(SANDBOX_ROUTES), false, { connectorIdn: 'vibe_agent' });
  assert.equal(connector.connector_idn, 'vibe_agent');
  assert.equal(connector.id, 'c2');
});

test('findSandboxConnector never selects non-running connectors', async () => {
  await assert.rejects(
    findSandboxConnector(fakeClient(SANDBOX_ROUTES), false, { connectorIdn: 'stopped_agent' }),
    /stopped_agent.*not found.*Available: convo_agent_sandbox, vibe_agent/s
  );
});

test('findSandboxConnector lists available connectors in not-found error', async () => {
  await assert.rejects(
    findSandboxConnector(fakeClient(SANDBOX_ROUTES), false, { connectorIdn: 'no_such' }),
    /Available: convo_agent_sandbox, vibe_agent/
  );
});

test('findSandboxConnector throws on unknown integration when connectorIdn given', async () => {
  await assert.rejects(
    findSandboxConnector(fakeClient(SANDBOX_ROUTES), false, { integrationIdn: 'nope', connectorIdn: 'vibe_agent' }),
    /Integration 'nope' not found/
  );
});

test('findSandboxConnector returns null (legacy) on missing integration without connectorIdn', async () => {
  const connector = await findSandboxConnector(fakeClient(SANDBOX_ROUTES), false, { integrationIdn: 'nope' });
  assert.equal(connector, null);
});

test('listRunningSandboxConnectors returns only running connectors', async () => {
  const connectors = await listRunningSandboxConnectors(fakeClient(SANDBOX_ROUTES));
  assert.deepEqual(connectors.map(c => c.connector_idn), ['convo_agent_sandbox', 'vibe_agent']);
});

// --- R2: poll timeout ---

test('pollForResponse honors custom timeoutMs and reports empty result', async () => {
  const client = {
    async get(url) {
      if (url === '/api/v1/chat/history') return { data: { items: [] } };
      throw new Error(`unexpected GET ${url}`);
    }
  };
  const session = {
    user_persona_id: 'p1',
    user_actor_id: 'a1',
    agent_persona_id: null,
    connector_idn: 'sandbox',
    session_id: null,
    external_id: 'x'
  };

  const startedAt = Date.now();
  const { acts, userAct } = await pollForResponse(client, session, new Date(), false, 1000);
  const elapsed = Date.now() - startedAt;

  assert.deepEqual(acts, []);
  assert.equal(userAct, null);
  // 1s timeout -> well under the legacy 60s; generous upper bound for CI jitter
  assert.ok(elapsed < 10_000, `expected fast timeout, took ${elapsed}ms`);
});

test('pollForResponse returns agent act and matching user act with external_event_id', async () => {
  const now = new Date();
  const later = new Date(now.getTime() + 2000).toISOString();
  const client = {
    async get(url) {
      if (url === '/api/v1/chat/history') {
        return {
          data: {
            items: [
              { id: 'm2', is_agent: true, external_event_id: 'evt-agent', payload: { text: 'pong' }, datetime: later, flow_idn: 'VibeFlow', skill_idn: 'reply', session_id: 's1' },
              { id: 'm1', is_agent: false, external_event_id: 'evt-user', payload: { text: 'ping' }, datetime: later }
            ]
          }
        };
      }
      throw new Error(`unexpected GET ${url}`);
    }
  };
  const session = {
    user_persona_id: 'p1',
    user_actor_id: 'a1',
    agent_persona_id: null,
    connector_idn: 'vibe_agent',
    session_id: null,
    external_id: 'x'
  };

  const { acts, userAct } = await pollForResponse(client, session, now, false, 5000);

  assert.equal(acts.length, 1);
  assert.equal(acts[0].is_agent, true);
  assert.equal(acts[0].external_event_id, 'evt-agent');
  assert.equal(acts[0].source_text, 'pong');
  assert.ok(userAct, 'user act should be captured');
  assert.equal(userAct.external_event_id, 'evt-user');
});

test('pollForResponse default settleMs returns only newest agent act', async () => {
  const sentAt = new Date('2026-07-03T18:00:00.000Z');
  const client = scriptedChatHistoryClient([
    [
      { id: 'newest', is_agent: true, payload: { text: 'newest bubble' }, datetime: '2026-07-03T18:00:02.000Z' },
      { id: 'older', is_agent: true, payload: { text: 'older bubble' }, datetime: '2026-07-03T18:00:01.000Z' }
    ]
  ]);

  const { acts } = await pollForResponse(client, sandboxSession(), sentAt, false, 2000);

  assert.deepEqual(acts.map(act => act.id), ['newest']);
  assert.equal(acts[0].source_text, 'newest bubble');
});

test('pollForResponse settle mode collects multiple bubbles across polls', async () => {
  const sentAt = new Date('2026-07-03T18:00:00.000Z');
  const client = scriptedChatHistoryClient([
    [
      { id: 'first', is_agent: true, payload: { text: 'first bubble' }, datetime: '2026-07-03T18:00:01.000Z' }
    ],
    [
      { id: 'second', is_agent: true, payload: { text: 'second bubble' }, datetime: '2026-07-03T18:00:02.000Z' },
      { id: 'first', is_agent: true, payload: { text: 'first bubble' }, datetime: '2026-07-03T18:00:01.000Z' }
    ],
    [
      { id: 'second', is_agent: true, payload: { text: 'second bubble' }, datetime: '2026-07-03T18:00:02.000Z' },
      { id: 'first', is_agent: true, payload: { text: 'first bubble' }, datetime: '2026-07-03T18:00:01.000Z' }
    ]
  ]);

  const { acts } = await pollForResponse(client, sandboxSession(), sentAt, false, 4000, 250);

  assert.deepEqual(acts.map(act => act.id), ['first', 'second']);
  assert.deepEqual(acts.map(act => act.source_text), ['first bubble', 'second bubble']);
});

test('pollForResponse settle mode returns when settle window expires', async () => {
  const sentAt = new Date('2026-07-03T18:00:00.000Z');
  const client = scriptedChatHistoryClient([
    [
      { id: 'only', is_agent: true, payload: { text: 'single bubble' }, datetime: '2026-07-03T18:00:01.000Z' }
    ],
    [
      { id: 'only', is_agent: true, payload: { text: 'single bubble' }, datetime: '2026-07-03T18:00:01.000Z' }
    ]
  ]);

  const startedAt = Date.now();
  const { acts } = await pollForResponse(client, sandboxSession(), sentAt, false, 3000, 250);
  const elapsed = Date.now() - startedAt;

  assert.deepEqual(acts.map(act => act.id), ['only']);
  assert.ok(elapsed < 3000, `expected settle expiry before timeout, took ${elapsed}ms`);
});

test('pollForResponse settle mode returns observed acts when overall timeout wins', async () => {
  const sentAt = new Date('2026-07-03T18:00:00.000Z');
  const client = scriptedChatHistoryClient([
    [
      { id: 'partial', is_agent: true, payload: { text: 'partial bubble' }, datetime: '2026-07-03T18:00:01.000Z' }
    ]
  ]);

  const startedAt = Date.now();
  const { acts } = await pollForResponse(client, sandboxSession(), sentAt, false, 1000, 10_000);
  const elapsed = Date.now() - startedAt;

  assert.deepEqual(acts.map(act => act.id), ['partial']);
  assert.ok(elapsed < 1400, `expected timeout budget to win before settle window, took ${elapsed}ms`);
});

test('pollForResponse settle mode deterministically handles missing ids duplicate ids and equal datetimes', async () => {
  async function collectActs() {
    const sentAt = new Date('2026-07-03T18:00:00.000Z');
    const equalDatetime = '2026-07-03T18:00:01.000Z';
    const client = scriptedChatHistoryClient([
      [
        { id: 'dup', is_agent: true, payload: { text: 'alpha' }, datetime: equalDatetime }
      ],
      [
        { is_agent: true, payload: { text: 'missing id' }, datetime: equalDatetime, flow_idn: 'flow-a', skill_idn: 'skill-a' },
        { id: 'dup', is_agent: true, payload: { text: 'beta' }, datetime: equalDatetime },
        { id: 'dup', is_agent: true, payload: { text: 'alpha' }, datetime: equalDatetime }
      ],
      [
        { is_agent: true, payload: { text: 'missing id' }, datetime: equalDatetime, flow_idn: 'flow-a', skill_idn: 'skill-a' },
        { id: 'dup', is_agent: true, payload: { text: 'beta' }, datetime: equalDatetime },
        { id: 'dup', is_agent: true, payload: { text: 'alpha' }, datetime: equalDatetime }
      ]
    ]);

    const { acts } = await pollForResponse(client, sandboxSession(), sentAt, false, 3000, 250);
    return acts.map(act => ({
      id: act.id,
      datetime: act.datetime,
      text: act.source_text
    }));
  }

  const firstRun = await collectActs();
  const secondRun = await collectActs();

  assert.deepEqual(firstRun, secondRun);
  assert.deepEqual(firstRun.map(act => act.text), ['alpha', 'missing id', 'beta']);
  assert.equal(firstRun[0].id, 'dup');
  assert.match(firstRun[1].id, /^chat_history_/);
  assert.equal(firstRun[2].id, 'dup');
});

test('pollForResponse settle mode dedupes stable ids when timestamps change across polls', async () => {
  const sentAt = new Date('2026-07-03T18:00:00.000Z');
  const client = scriptedChatHistoryClient([
    [
      { id: 'same', is_agent: true, payload: { text: 'same bubble' }, datetime: '2026-07-03T18:00:01.000Z' }
    ],
    [
      { id: 'same', is_agent: true, payload: { text: 'same bubble' }, datetime: '2026-07-03T18:00:02.000Z' }
    ],
    [
      { id: 'same', is_agent: true, payload: { text: 'same bubble' }, datetime: '2026-07-03T18:00:03.000Z' }
    ]
  ]);

  const { acts } = await pollForResponse(client, sandboxSession(), sentAt, false, 3000, 250);

  assert.deepEqual(acts.map(act => act.source_text), ['same bubble']);
});

test('pollForResponse settle mode can poll past max attempts while timeout budget remains', async () => {
  const sentAt = new Date('2026-07-03T18:00:00.000Z');
  const client = scriptedChatHistoryClient([
    [
      { id: 'first', is_agent: true, payload: { text: 'first bubble' }, datetime: '2026-07-03T18:00:01.000Z' }
    ],
    [
      { id: 'second', is_agent: true, payload: { text: 'second bubble' }, datetime: '2026-07-03T18:00:02.000Z' },
      { id: 'first', is_agent: true, payload: { text: 'first bubble' }, datetime: '2026-07-03T18:00:01.000Z' }
    ]
  ]);

  const { acts } = await pollForResponse(client, sandboxSession(), sentAt, false, 1000, 250);

  assert.deepEqual(acts.map(act => act.source_text), ['first bubble', 'second bubble']);
});

test('pollForResponse settle mode keeps same-text bubbles distinct by correlation fields', async () => {
  const sentAt = new Date('2026-07-03T18:00:00.000Z');
  const equalDatetime = '2026-07-03T18:00:01.000Z';
  const client = scriptedChatHistoryClient([
    [
      { id: 'dup', is_agent: true, external_event_id: 'evt-1', payload: { text: 'OK' }, datetime: equalDatetime },
      { is_agent: true, external_event_id: 'evt-missing-1', payload: { text: 'OK' }, datetime: equalDatetime }
    ],
    [
      { id: 'dup', is_agent: true, external_event_id: 'evt-2', payload: { text: 'OK' }, datetime: equalDatetime },
      { is_agent: true, external_event_id: 'evt-missing-2', payload: { text: 'OK' }, datetime: equalDatetime },
      { id: 'dup', is_agent: true, external_event_id: 'evt-1', payload: { text: 'OK' }, datetime: equalDatetime },
      { is_agent: true, external_event_id: 'evt-missing-1', payload: { text: 'OK' }, datetime: equalDatetime }
    ],
    [
      { id: 'dup', is_agent: true, external_event_id: 'evt-2', payload: { text: 'OK' }, datetime: equalDatetime },
      { is_agent: true, external_event_id: 'evt-missing-2', payload: { text: 'OK' }, datetime: equalDatetime },
      { id: 'dup', is_agent: true, external_event_id: 'evt-1', payload: { text: 'OK' }, datetime: equalDatetime },
      { is_agent: true, external_event_id: 'evt-missing-1', payload: { text: 'OK' }, datetime: equalDatetime }
    ]
  ]);

  const { acts } = await pollForResponse(client, sandboxSession(), sentAt, false, 3000, 250);

  assert.deepEqual(acts.map(act => act.external_event_id), ['evt-1', 'evt-missing-1', 'evt-2', 'evt-missing-2']);
  assert.equal(acts[1].id.startsWith('chat_history_'), true);
  assert.equal(acts[3].id.startsWith('chat_history_'), true);
  assert.notEqual(acts[1].id, acts[3].id);
});

// --- R3: remote skill resolution ---

const SKILL_ROUTES = {
  '/api/v1/designer/projects': [
    { id: 'proj-1', idn: 'vibe', title: 'Vibe' }
  ],
  '/api/v1/bff/agents/list': [
    {
      id: 'agent-1',
      idn: 'VibeAgent',
      flows: [
        { id: 'flow-1', idn: 'VibeFlow', title: 'Vibe Flow', default_runner_type: 'nsl', default_model: { provider_idn: 'openai', model_idn: 'gpt4o' } }
      ]
    }
  ],
  '/api/v1/designer/flows/flow-1/skills': [
    { id: 'skill-1', idn: 'structured_generation', title: 'SG', runner_type: 'nsl', model: { provider_idn: 'openai', model_idn: 'gpt54' }, parameters: [] }
  ],
  '/api/v1/designer/skills/skill-1': {
    id: 'skill-1',
    idn: 'structured_generation',
    title: 'SG',
    prompt_script: '{{ generate() }}',
    runner_type: 'nsl',
    model: { provider_idn: 'openai', model_idn: 'gpt54' },
    parameters: []
  }
};

test('resolveRemoteSkill resolves full skill by IDN path', async () => {
  const { project, agent, flow, skill } = await resolveRemoteSkill(fakeClient(SKILL_ROUTES), {
    projectIdn: 'vibe',
    agentIdn: 'VibeAgent',
    flowIdn: 'VibeFlow',
    skillIdn: 'structured_generation'
  });

  assert.equal(project.id, 'proj-1');
  assert.equal(agent.id, 'agent-1');
  assert.equal(flow.id, 'flow-1');
  assert.equal(skill.id, 'skill-1');
  // Full skill comes from the by-id endpoint (includes prompt_script)
  assert.equal(skill.prompt_script, '{{ generate() }}');
});

test('resolveRemoteSkill errors list available IDNs at each level', async () => {
  const base = {
    projectIdn: 'vibe',
    agentIdn: 'VibeAgent',
    flowIdn: 'VibeFlow',
    skillIdn: 'structured_generation'
  };

  await assert.rejects(
    resolveRemoteSkill(fakeClient(SKILL_ROUTES), { ...base, projectIdn: 'nope' }),
    /Project 'nope' not found.*Available projects: vibe/s
  );
  await assert.rejects(
    resolveRemoteSkill(fakeClient(SKILL_ROUTES), { ...base, agentIdn: 'nope' }),
    /Agent 'nope' not found.*Available agents: VibeAgent/s
  );
  await assert.rejects(
    resolveRemoteSkill(fakeClient(SKILL_ROUTES), { ...base, flowIdn: 'nope' }),
    /Flow 'nope' not found.*Available flows: VibeFlow/s
  );
  await assert.rejects(
    resolveRemoteSkill(fakeClient(SKILL_ROUTES), { ...base, skillIdn: 'nope' }),
    /Skill 'nope' not found.*Available skills: structured_generation/s
  );
});

test('parseModelFlag parses provider/model pairs', () => {
  assert.deepEqual(parseModelFlag('openai/gpt54'), { provider_idn: 'openai', model_idn: 'gpt54' });
  assert.deepEqual(parseModelFlag('google/gemini25_pro'), { provider_idn: 'google', model_idn: 'gemini25_pro' });
});

test('parseModelFlag rejects malformed values', () => {
  for (const bad of ['gpt54', 'openai/', '/gpt54', 'a/b/c', '']) {
    assert.throws(() => parseModelFlag(bad), /Invalid --model value/);
  }
});

test('findLocalProjectWorkspace detects pulled newo_v2 workspaces', async () => {
  const customerIdn = 'unit_update_skill_v2';
  const projectIdn = 'V2Project';
  const customerRoot = path.join(process.cwd(), 'newo_customers', customerIdn);
  const v2ProjectPath = path.join(customerRoot, projectIdn);

  await fs.remove(customerRoot);
  try {
    await fs.ensureDir(v2ProjectPath);
    const found = await findLocalProjectWorkspace(customerIdn, projectIdn);
    assert.equal(found, v2ProjectPath);
  } finally {
    await fs.remove(customerRoot);
  }
});
