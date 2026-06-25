import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pullSessionFull } from '../dist/sync/conversations.js';

// Fake axios client routing GET by path. chat/history & user-personas use
// {params}; getLogs puts the query in the URL string.
function makeClient({ personasByPage = {}, chatByActor = {}, logsByActor = {} } = {}) {
  const logCalls = [];
  const client = {
    get: async (url, config = {}) => {
      const params = config.params || {};
      const base = url.split('?')[0];
      if (base === '/api/v1/bff/conversations/user-personas') {
        const page = params.page || 1;
        return { data: personasByPage[page] || { items: [], metadata: { page, per: params.per, total: 0 } } };
      }
      if (base === '/api/v1/chat/history') {
        const pages = chatByActor[params.user_actor_id] || {};
        return { data: pages[params.page || 1] || { items: [] } };
      }
      if (base === '/api/v1/analytics/logs') {
        const q = new URLSearchParams(url.split('?')[1] || '');
        const actor = q.get('user_actor_ids');
        const page = Number(q.get('page') || '1');
        logCalls.push({ actor, from: q.get('from_datetime'), to: q.get('to_datetime'), page });
        const pages = logsByActor[actor] || {};
        return { data: pages[page] || { items: [] } };
      }
      throw new Error(`unexpected GET ${url}`);
    }
  };
  return { client, logCalls };
}

function personas(items) {
  return { items, metadata: { page: 1, per: 50, total: items.length } };
}

test('merges chat turns and logs into one chronological timeline', async () => {
  const { client, logCalls } = makeClient({
    personasByPage: {
      1: personas([
        { id: 'p1', name: 'User', actors: [
          { id: 'svc', integration_idn: 'program_timer' },
          { id: 'a1', integration_idn: 'newo_voice' }
        ] }
      ])
    },
    chatByActor: {
      a1: { 1: { items: [
        { datetime: '2026-01-01T10:00:01.000Z', is_agent: false, payload: { text: 'hi' }, external_event_id: 'e1' },
        { datetime: '2026-01-01T10:00:05.000Z', is_agent: true, payload: { text: 'hello' }, external_event_id: 'e2' }
      ] } }
    },
    logsByActor: {
      a1: { 1: { items: [
        { datetime: '2026-01-01T10:00:03.000Z', log_type: 'call', level: 'info',
          data: { name: 'Gen', source: { skill_idn: 'reply', model: { provider_idn: 'google', model_idn: 'gemini25_flash' } }, context: { flow_idn: 'MainFlow' }, external_event_id: 'e1' } }
      ] } }
    }
  });

  const r = await pullSessionFull(client, 'sess-1', false, 10);

  assert.equal(r.session_id, 'sess-1');
  assert.deepEqual(r.actor_ids, ['a1']); // service actor excluded
  assert.equal(r.total_messages, 2);
  assert.equal(r.total_log_entries, 1);
  // chronological interleave: hi(1s) → Gen(3s) → hello(5s)
  assert.deepEqual(r.timeline.map(e => e.kind), ['message', 'call', 'message']);
  assert.equal(r.timeline[0].text, 'hi');
  assert.equal(r.timeline[1].name, 'Gen');
  assert.equal(r.timeline[1].skill_idn, 'reply');
  assert.equal(r.timeline[1].flow_idn, 'MainFlow');
  assert.equal(r.timeline[1].model, 'google/gemini25_flash');
  assert.equal(r.timeline[2].text, 'hello');
});

test('log window is anchored on chat turns and padded at the tail', async () => {
  const { client, logCalls } = makeClient({
    personasByPage: { 1: personas([{ id: 'p1', name: 'U', actors: [{ id: 'a1', integration_idn: 'newo_chat' }] }]) },
    chatByActor: { a1: { 1: { items: [
      { datetime: '2026-01-01T10:00:00.000Z', is_agent: false, payload: { text: 'x' } }
    ] } } },
    logsByActor: { a1: { 1: { items: [] } } }
  });

  const r = await pullSessionFull(client, 'sess-2', false, 10);
  assert.ok(r.window);
  // from = turn - 5s, to = turn + 10min
  assert.equal(r.window.from, '2026-01-01T09:59:55.000Z');
  assert.equal(r.window.to, '2026-01-01T10:10:00.000Z');
  assert.equal(logCalls[0].from, r.window.from);
  assert.equal(logCalls[0].to, r.window.to);
});

test('no dialog turns → empty timeline, no log fetch (no window to anchor)', async () => {
  const { client, logCalls } = makeClient({
    personasByPage: { 1: personas([{ id: 'p1', name: 'U', actors: [{ id: 'a1', integration_idn: 'newo_chat' }] }]) },
    chatByActor: { a1: { 1: { items: [] } } }
  });

  const r = await pullSessionFull(client, 'sess-3', false, 10);
  assert.equal(r.total_messages, 0);
  assert.equal(r.window, null);
  assert.equal(r.timeline.length, 0);
  assert.equal(logCalls.length, 0); // logs not queried without a window
});
