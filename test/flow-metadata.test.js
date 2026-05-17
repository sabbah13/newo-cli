/**
 * Unit tests for flow-metadata sync (GH issue #3 regression coverage).
 *
 * These tests exercise the reconciler in src/sync/flow-metadata.ts using a
 * fake AxiosInstance. The goal is to lock in the contract that fixes the
 * reported bug: edits to local flow metadata.yaml must propagate to the
 * platform (title, events, state_fields), without wiping unrelated data.
 */
import assert from 'assert';
import {
  syncFlowMetadata,
  emptyFlowSyncCounts,
  flowEventDiffers,
  flowStateDiffers,
  totalFlowSyncOps,
  describeFlowSyncCounts
} from '../dist/sync/flow-metadata.js';

/**
 * Build a stub AxiosInstance whose .get/.patch/.post/.put/.delete just record
 * calls and return canned responses keyed by URL. Lets us assert exactly
 * which API calls the reconciler issues.
 */
function makeFakeClient(spec) {
  const calls = [];
  function record(method, url, data) {
    calls.push({ method, url, data });
    const responder = spec[`${method} ${url}`] ?? spec[`${method} *`];
    if (!responder) {
      const err = new Error(`unexpected ${method} ${url}`);
      err.response = { status: 599, data: { message: 'no stub' } };
      throw err;
    }
    if (typeof responder === 'function') return Promise.resolve(responder(data));
    return Promise.resolve(responder);
  }
  return {
    calls,
    get: (url, _config) => record('GET', url),
    post: (url, data) => record('POST', url, data),
    put: (url, data) => record('PUT', url, data),
    patch: (url, data) => record('PATCH', url, data),
    delete: (url) => record('DELETE', url),
    request: (cfg) => record(cfg.method.toUpperCase(), cfg.url, cfg.data),
  };
}

describe('flow-metadata sync (issue #3)', function() {
  describe('flowEventDiffers', function() {
    const baseRemote = {
      id: 'event-1',
      idn: 'evt',
      description: 'orig',
      skill_selector: 'skill_idn',
      skill_idn: 'SkillA',
      state_idn: null,
      interrupt_mode: 'queue',
      integration_idn: 'api',
      connector_idn: 'webhook'
    };

    it('returns false when local matches remote', function() {
      assert.strictEqual(flowEventDiffers({ ...baseRemote }, baseRemote), false);
    });

    it('returns true when description changes', function() {
      assert.strictEqual(flowEventDiffers({ ...baseRemote, description: 'new' }, baseRemote), true);
    });

    it('returns true when skill_idn changes', function() {
      assert.strictEqual(flowEventDiffers({ ...baseRemote, skill_idn: 'SkillB' }, baseRemote), true);
    });

    it('returns true when interrupt_mode changes', function() {
      assert.strictEqual(flowEventDiffers({ ...baseRemote, interrupt_mode: 'interrupt' }, baseRemote), true);
    });

    it('treats undefined and empty string as equal', function() {
      const local = { ...baseRemote, integration_idn: undefined };
      const remote = { ...baseRemote, integration_idn: '' };
      assert.strictEqual(flowEventDiffers(local, remote), false);
    });

    it('treats null and undefined as equal', function() {
      const local = { ...baseRemote, state_idn: undefined };
      const remote = { ...baseRemote, state_idn: null };
      assert.strictEqual(flowEventDiffers(local, remote), false);
    });
  });

  describe('flowStateDiffers', function() {
    const remote = { id: 's1', idn: 'st', title: 'State', default_value: 'x', scope: 'flow' };

    it('returns false on equal states', function() {
      assert.strictEqual(flowStateDiffers({ ...remote }, remote), false);
    });

    it('detects title change', function() {
      assert.strictEqual(flowStateDiffers({ ...remote, title: 'New' }, remote), true);
    });

    it('detects default_value change', function() {
      assert.strictEqual(flowStateDiffers({ ...remote, default_value: 'y' }, remote), true);
    });
  });

  describe('syncFlowMetadata', function() {
    const flowId = 'flow-uuid';

    const baseLocal = {
      id: flowId,
      idn: 'TestFlow',
      title: 'Test Flow',
      description: 'desc',
      default_runner_type: 'guidance',
      default_model: { provider_idn: 'openai', model_idn: 'gpt4o' },
      events: [],
      state_fields: []
    };

    it('issues no write calls when local matches remote (no-op)', async function() {
      const remoteFlow = {
        title: baseLocal.title,
        description: baseLocal.description,
        default_runner_type: baseLocal.default_runner_type
      };

      const fake = makeFakeClient({
        [`GET /api/v1/designer/flows/${flowId}/events`]: { data: [] },
        [`GET /api/v1/designer/flows/${flowId}/states`]: { data: [] }
      });

      const counts = emptyFlowSyncCounts();
      await syncFlowMetadata(fake, flowId, baseLocal, remoteFlow, false, counts);

      // Only the two GETs should have happened.
      assert.strictEqual(fake.calls.length, 2);
      assert.deepStrictEqual(fake.calls.map(c => c.method), ['GET', 'GET']);
      assert.strictEqual(totalFlowSyncOps(counts), 0);
    });

    it('PATCHes the flow when title differs', async function() {
      const remoteFlow = { title: 'Old Title', description: 'desc', default_runner_type: 'guidance' };
      const fake = makeFakeClient({
        [`PATCH /api/v1/designer/flows/${flowId}`]: { data: '' },
        [`GET /api/v1/designer/flows/${flowId}/events`]: { data: [] },
        [`GET /api/v1/designer/flows/${flowId}/states`]: { data: [] }
      });

      const counts = emptyFlowSyncCounts();
      await syncFlowMetadata(fake, flowId, baseLocal, remoteFlow, false, counts);

      const patch = fake.calls.find(c => c.method === 'PATCH');
      assert(patch, 'expected a PATCH call');
      assert.strictEqual(patch.data.title, 'Test Flow');
      assert.strictEqual(patch.data.idn, 'TestFlow');
      assert.strictEqual(counts.flowsUpdated, 1);
    });

    it('creates events missing on the platform', async function() {
      const local = {
        ...baseLocal,
        events: [
          {
            id: '',
            idn: 'new_event',
            description: 'new',
            skill_selector: 'skill_idn',
            skill_idn: 'SomeSkill',
            interrupt_mode: 'queue',
            integration_idn: 'api',
            connector_idn: 'webhook'
          }
        ]
      };

      const fake = makeFakeClient({
        [`GET /api/v1/designer/flows/${flowId}/events`]: { data: [] },
        [`GET /api/v1/designer/flows/${flowId}/states`]: { data: [] },
        [`POST /api/v1/designer/flows/${flowId}/events`]: { data: { id: 'new-event-id' } }
      });

      const counts = emptyFlowSyncCounts();
      // pass null for remoteFlow so we skip the flow PATCH
      await syncFlowMetadata(fake, flowId, local, null, false, counts);

      const post = fake.calls.find(c => c.method === 'POST');
      assert(post, 'expected a POST');
      assert.strictEqual(post.data.idn, 'new_event');
      assert.strictEqual(post.data.skill_idn, 'SomeSkill');
      assert.strictEqual(counts.eventsCreated, 1);
      assert.strictEqual(counts.eventsUpdated, 0);
      assert.strictEqual(counts.eventsDeleted, 0);
    });

    it('updates events that exist in both but differ', async function() {
      const local = {
        ...baseLocal,
        events: [
          {
            id: '',
            idn: 'evt',
            description: 'updated description',
            skill_selector: 'skill_idn',
            skill_idn: 'SomeSkill',
            interrupt_mode: 'queue',
            integration_idn: 'api',
            connector_idn: 'webhook'
          }
        ]
      };
      const remoteEvent = {
        id: 'remote-event-id',
        idn: 'evt',
        description: 'old description',
        skill_selector: 'skill_idn',
        skill_idn: 'SomeSkill',
        state_idn: null,
        interrupt_mode: 'queue',
        integration_idn: 'api',
        connector_idn: 'webhook'
      };

      const fake = makeFakeClient({
        [`GET /api/v1/designer/flows/${flowId}/events`]: { data: [remoteEvent] },
        [`GET /api/v1/designer/flows/${flowId}/states`]: { data: [] },
        [`PATCH /api/v1/designer/flows/events/remote-event-id`]: { data: '' }
      });

      const counts = emptyFlowSyncCounts();
      await syncFlowMetadata(fake, flowId, local, null, false, counts);

      const patch = fake.calls.find(c => c.method === 'PATCH');
      assert(patch, 'expected a PATCH');
      assert.strictEqual(patch.url, `/api/v1/designer/flows/events/remote-event-id`);
      assert.strictEqual(patch.data.description, 'updated description');
      assert.strictEqual(counts.eventsUpdated, 1);
      assert.strictEqual(counts.eventsCreated, 0);
      assert.strictEqual(counts.eventsDeleted, 0);
    });

    it('deletes platform events that are missing locally (full sync)', async function() {
      const local = {
        ...baseLocal,
        events: []  // explicitly empty
      };
      const remoteEvent = {
        id: 'rogue-event-id',
        idn: 'rogue_event',
        description: 'should be deleted',
        skill_selector: 'skill_idn',
        skill_idn: 'SomeSkill',
        state_idn: null,
        interrupt_mode: 'queue',
        integration_idn: 'api',
        connector_idn: 'webhook'
      };

      const fake = makeFakeClient({
        [`GET /api/v1/designer/flows/${flowId}/events`]: { data: [remoteEvent] },
        [`GET /api/v1/designer/flows/${flowId}/states`]: { data: [] },
        [`DELETE /api/v1/designer/flows/events/rogue-event-id`]: { data: '' }
      });

      const counts = emptyFlowSyncCounts();
      await syncFlowMetadata(fake, flowId, local, null, false, counts);

      const del = fake.calls.find(c => c.method === 'DELETE');
      assert(del, 'expected a DELETE');
      assert.strictEqual(del.url, `/api/v1/designer/flows/events/rogue-event-id`);
      assert.strictEqual(counts.eventsDeleted, 1);
    });

    it('creates, updates, and deletes states in a single pass', async function() {
      const local = {
        ...baseLocal,
        state_fields: [
          { id: '', idn: 'kept', title: 'Kept New', default_value: 'v', scope: 'flow' },
          { id: '', idn: 'created', title: 'Created', default_value: '', scope: 'flow' }
        ]
      };
      const remoteStates = [
        { id: 'kept-id', idn: 'kept', title: 'Kept Old', default_value: 'v', scope: 'flow' },
        { id: 'gone-id', idn: 'gone', title: 'Gone', default_value: '', scope: 'flow' }
      ];

      const fake = makeFakeClient({
        [`GET /api/v1/designer/flows/${flowId}/events`]: { data: [] },
        [`GET /api/v1/designer/flows/${flowId}/states`]: { data: remoteStates },
        [`PUT /api/v1/designer/flows/states/kept-id`]: { data: '' },
        [`POST /api/v1/designer/flows/${flowId}/states`]: { data: { id: 'created-id' } },
        [`DELETE /api/v1/designer/flows/states/gone-id`]: { data: '' }
      });

      const counts = emptyFlowSyncCounts();
      await syncFlowMetadata(fake, flowId, local, null, false, counts);

      assert.strictEqual(counts.statesCreated, 1);
      assert.strictEqual(counts.statesUpdated, 1);
      assert.strictEqual(counts.statesDeleted, 1);
    });

    it('records and continues on per-event errors (does not throw)', async function() {
      const local = {
        ...baseLocal,
        events: [
          { id: '', idn: 'event_a', description: '', skill_selector: 'skill_idn', skill_idn: 'A', interrupt_mode: 'queue', integration_idn: 'api', connector_idn: 'webhook' },
          { id: '', idn: 'event_b', description: '', skill_selector: 'skill_idn', skill_idn: 'B', interrupt_mode: 'queue', integration_idn: 'api', connector_idn: 'webhook' }
        ]
      };

      let firstPost = true;
      const fake = makeFakeClient({
        [`GET /api/v1/designer/flows/${flowId}/events`]: { data: [] },
        [`GET /api/v1/designer/flows/${flowId}/states`]: { data: [] },
        [`POST /api/v1/designer/flows/${flowId}/events`]: () => {
          if (firstPost) {
            firstPost = false;
            const err = new Error('platform refused first event');
            err.response = { status: 422, data: { message: 'bad' } };
            throw err;
          }
          return { data: { id: 'second-id' } };
        }
      });

      const counts = emptyFlowSyncCounts();
      await syncFlowMetadata(fake, flowId, local, null, false, counts);

      assert.strictEqual(counts.eventsCreated, 1, 'second event still created');
      assert.strictEqual(counts.errors.length, 1, 'first failure recorded as error');
      assert(counts.errors[0].includes('event_a'), 'error mentions failing event idn');
    });
  });

  describe('describeFlowSyncCounts', function() {
    it('describes mixed operations', function() {
      const counts = emptyFlowSyncCounts();
      counts.flowsUpdated = 1;
      counts.eventsCreated = 2;
      counts.eventsDeleted = 1;
      counts.statesUpdated = 3;

      const text = describeFlowSyncCounts(counts);
      assert(text.includes('1 flow'));
      assert(text.includes('events +2/-1'));
      assert(text.includes('states ~3'));
    });

    it('returns empty string when no operations', function() {
      assert.strictEqual(describeFlowSyncCounts(emptyFlowSyncCounts()), '');
    });
  });
});
