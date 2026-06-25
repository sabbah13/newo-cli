import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pullConversationBySession } from '../dist/sync/conversations.js';

// Minimal fake axios client: routes client.get(url, {params}) to a handler map.
// Records every chat/history actor id it was asked for, so tests can assert
// which actors were (and were not) fetched.
function makeClient({ personasByPage = {}, historyByActor = {} } = {}) {
  const historyActorCalls = [];
  const client = {
    get: async (url, config = {}) => {
      const params = config.params || {};
      if (url === '/api/v1/bff/conversations/user-personas') {
        const page = params.page || 1;
        return { data: personasByPage[page] || { items: [], metadata: { page, per: params.per, total: 0 } } };
      }
      if (url === '/api/v1/chat/history') {
        historyActorCalls.push(params.user_actor_id);
        const pages = historyByActor[params.user_actor_id] || {};
        const page = params.page || 1;
        return { data: pages[page] || { items: [] } };
      }
      throw new Error(`unexpected GET ${url}`);
    }
  };
  return { client, historyActorCalls };
}

function personasResponse(items) {
  return { items, metadata: { page: 1, per: 50, total: items.length } };
}

test('resolves persona by session_id, builds oldest-first chronicle, maps speakers', async () => {
  const { client, historyActorCalls } = makeClient({
    personasByPage: {
      1: personasResponse([
        {
          id: 'p1',
          name: 'John',
          actors: [
            { id: 'svc1', integration_idn: 'program_timer' },
            { id: 'a1', integration_idn: 'newo_chat' }
          ]
        }
      ])
    },
    historyByActor: {
      a1: {
        // API returns newest-first; the chronicle must come back oldest-first.
        1: {
          items: [
            { datetime: '2026-01-01T10:00:02.000Z', is_agent: true, payload: { text: 'agent reply' }, external_event_id: 'e2' },
            { datetime: '2026-01-01T10:00:01.000Z', is_agent: false, payload: { text: 'user hello' }, external_event_id: 'e1' }
          ]
        }
      }
    }
  });

  const chronicle = await pullConversationBySession(client, 'sess-1', false);

  assert.equal(chronicle.session_id, 'sess-1');
  assert.deepEqual(chronicle.personas, [{ id: 'p1', name: 'John' }]);
  assert.equal(chronicle.total_acts, 2);
  // Service actor must be skipped; only the dialog actor is fetched.
  assert.deepEqual(historyActorCalls, ['a1']);
  assert.deepEqual(chronicle.actor_ids, ['a1']);
  // Oldest-first ordering + speaker mapping.
  assert.equal(chronicle.acts[0].message, 'user hello');
  assert.equal(chronicle.acts[0].speaker, 'user');
  assert.equal(chronicle.acts[1].message, 'agent reply');
  assert.equal(chronicle.acts[1].speaker, 'agent');
  assert.equal(chronicle.acts[0].external_event_id, 'e1');
});

test('empty session (no personas) yields an empty chronicle', async () => {
  const { client, historyActorCalls } = makeClient({
    personasByPage: { 1: personasResponse([]) }
  });

  const chronicle = await pullConversationBySession(client, 'sess-empty', false);

  assert.equal(chronicle.total_acts, 0);
  assert.deepEqual(chronicle.acts, []);
  assert.deepEqual(chronicle.personas, []);
  assert.deepEqual(historyActorCalls, []);
});

test('excludes all service actors (program_timer, magic_browser)', async () => {
  const { client, historyActorCalls } = makeClient({
    personasByPage: {
      1: personasResponse([
        {
          id: 'p1',
          name: 'Jane',
          actors: [
            { id: 'svc1', integration_idn: 'program_timer' },
            { id: 'svc2', integration_idn: 'magic_browser' },
            { id: 'voice1', integration_idn: 'newo_voice' }
          ]
        }
      ])
    },
    historyByActor: {
      voice1: { 1: { items: [{ datetime: '2026-01-01T00:00:00.000Z', is_agent: false, payload: { text: 'hi' } }] } }
    }
  });

  const chronicle = await pullConversationBySession(client, 'sess-2', false);

  assert.deepEqual(historyActorCalls, ['voice1']);
  assert.deepEqual(chronicle.actor_ids, ['voice1']);
  assert.equal(chronicle.total_acts, 1);
});

test('paginates chat/history until a short page', async () => {
  const fullPage = Array.from({ length: 200 }, (_, i) => ({
    datetime: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
    is_agent: i % 2 === 0,
    payload: { text: `msg ${i}` }
  }));

  const { client, historyActorCalls } = makeClient({
    personasByPage: {
      1: personasResponse([{ id: 'p1', name: 'John', actors: [{ id: 'a1', integration_idn: 'newo_chat' }] }])
    },
    historyByActor: {
      a1: {
        1: { items: fullPage },
        2: { items: [{ datetime: '2026-01-01T01:00:00.000Z', is_agent: false, payload: { text: 'last' } }] }
      }
    }
  });

  const chronicle = await pullConversationBySession(client, 'sess-3', false);

  // page 1 (200) + page 2 (1), then stop because page 2 < 200.
  assert.equal(chronicle.total_acts, 201);
  assert.deepEqual(historyActorCalls, ['a1', 'a1']);
});
