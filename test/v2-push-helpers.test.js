/**
 * Unit tests for V2ProjectSyncStrategy internal helpers introduced by the
 * v3.7.4 push refactor (skill creation from V2 flow YAML).
 *
 * These cover three risk areas flagged during code review:
 *  - isAlreadyExistsApiError must not mis-match generic "does not exist"
 *  - assertSkillModelResolved must reject empty model/provider before the
 *    request reaches the platform
 *  - normalize/build helpers must keep stable, predictable shapes
 *
 * The class is instantiated with stub deps; TypeScript `private` modifiers
 * disappear at runtime so the methods are reachable from JS tests.
 */
import assert from 'assert';
import { describe, it } from 'node:test';
import { V2ProjectSyncStrategy } from '../dist/domain/strategies/sync/V2ProjectSyncStrategy.js';

const noopLogger = { info: () => {}, warn: () => {}, verbose: () => {} };
const stubFactory = async () => ({});

function makeStrategy() {
  return new V2ProjectSyncStrategy(stubFactory, noopLogger);
}

describe('V2ProjectSyncStrategy helpers', function () {
  describe('isAlreadyExistsApiError', function () {
    const strategy = makeStrategy();

    it('matches 409 with "already exists"', function () {
      const err = { response: { status: 409, data: { message: 'Skill already exists' } } };
      assert.strictEqual(strategy.isAlreadyExistsApiError(err), true);
    });

    it('matches 400 with "already exists" in nested detail', function () {
      const err = { response: { status: 400, data: { detail: 'IDN already exists in flow' } } };
      assert.strictEqual(strategy.isAlreadyExistsApiError(err), true);
    });

    it('matches 422 with "duplicate key"', function () {
      const err = { response: { status: 422, data: { error: 'duplicate key violates unique constraint' } } };
      assert.strictEqual(strategy.isAlreadyExistsApiError(err), true);
    });

    it('does NOT match 404 "does not exist"', function () {
      const err = { response: { status: 404, data: { message: 'Flow does not exist' } } };
      assert.strictEqual(strategy.isAlreadyExistsApiError(err), false);
    });

    it('does NOT match 400 "doesn\'t exist" (was a false-positive under old loose matcher)', function () {
      const err = { response: { status: 400, data: { message: "Skill doesn't exist" } } };
      assert.strictEqual(strategy.isAlreadyExistsApiError(err), false);
    });

    it('does NOT match 500 even with "already exists" in body', function () {
      const err = { response: { status: 500, data: { message: 'already exists' } } };
      assert.strictEqual(strategy.isAlreadyExistsApiError(err), false);
    });

    it('handles errors with no response object', function () {
      const err = new Error('network down');
      assert.strictEqual(strategy.isAlreadyExistsApiError(err), false);
    });

    it('returns false for null/undefined instead of throwing', function () {
      assert.strictEqual(strategy.isAlreadyExistsApiError(null), false);
      assert.strictEqual(strategy.isAlreadyExistsApiError(undefined), false);
    });
  });

  describe('createMissingSkillParameters', function () {
    const baseMetadata = {
      id: 'sk-remote-1',
      idn: 'sk',
      title: 'Sk',
      runner_type: 'guidance',
      model: { model_idn: 'gpt-4o', provider_idn: 'openai' },
      parameters: [{ name: 'a', default_value: '' }],
      path: '',
    };

    it('creates only missing parameters and counts successes', async function () {
      const strategy = makeStrategy();
      const posted = [];
      const client = {
        post: async (_url, body) => {
          posted.push(body.name);
          return { data: { id: 'param-id' } };
        },
      };
      const local = {
        ...baseMetadata,
        parameters: [
          { name: 'a', default_value: '' },
          { name: 'b', default_value: 'x' },
        ],
      };
      const created = await strategy.createMissingSkillParameters(client, baseMetadata, local);
      assert.strictEqual(created, 1);
      assert.deepStrictEqual(posted, ['b']);
    });

    it('does NOT count a parameter that already exists remotely (swallowed 409)', async function () {
      const strategy = makeStrategy();
      const client = {
        post: async () => {
          const err = new Error('conflict');
          err.response = { status: 409, data: { message: 'Parameter already exists' } };
          throw err;
        },
      };
      const local = {
        ...baseMetadata,
        parameters: [
          { name: 'a', default_value: '' },
          { name: 'b', default_value: '' },
        ],
      };
      const created = await strategy.createMissingSkillParameters(client, baseMetadata, local);
      assert.strictEqual(created, 0);
    });

    it('rethrows non already-exists errors', async function () {
      const strategy = makeStrategy();
      const client = {
        post: async () => {
          const err = new Error('boom');
          err.response = { status: 500, data: { message: 'internal' } };
          throw err;
        },
      };
      const local = { ...baseMetadata, parameters: [{ name: 'new_param', default_value: '' }] };
      await assert.rejects(
        () => strategy.createMissingSkillParameters(client, baseMetadata, local),
        /boom/
      );
    });
  });

  describe('assertSkillModelResolved', function () {
    const strategy = makeStrategy();

    function metadata(model_idn, provider_idn) {
      return {
        id: '',
        idn: 'sk',
        title: 'Sk',
        runner_type: 'guidance',
        model: { model_idn, provider_idn },
        parameters: [],
        path: '',
      };
    }

    it('passes when both model_idn and provider_idn are set', function () {
      assert.doesNotThrow(() => strategy.assertSkillModelResolved(metadata('gpt-4o', 'openai'), 'p/a/f/s'));
    });

    it('throws when model_idn is empty', function () {
      assert.throws(
        () => strategy.assertSkillModelResolved(metadata('', 'openai'), 'p/a/f/s'),
        /Cannot resolve model for skill p\/a\/f\/s/
      );
    });

    it('throws when provider_idn is empty', function () {
      assert.throws(
        () => strategy.assertSkillModelResolved(metadata('gpt-4o', ''), 'p/a/f/s'),
        /provider_idn=""/
      );
    });

    it('throws when both are empty', function () {
      assert.throws(
        () => strategy.assertSkillModelResolved(metadata('', ''), 'proj/agent/flow/skill'),
        /Set either skill\.model\.\* or flow default_model_idn/
      );
    });
  });

  describe('normalizeRunnerType', function () {
    const strategy = makeStrategy();

    it('returns "nsl" for "nsl"', function () {
      assert.strictEqual(strategy.normalizeRunnerType('nsl'), 'nsl');
    });

    it('returns "guidance" for "guidance"', function () {
      assert.strictEqual(strategy.normalizeRunnerType('guidance'), 'guidance');
    });

    it('returns "guidance" for undefined', function () {
      assert.strictEqual(strategy.normalizeRunnerType(undefined), 'guidance');
    });

    it('returns "guidance" for unknown values (safe fallback)', function () {
      assert.strictEqual(strategy.normalizeRunnerType('python'), 'guidance');
    });
  });

  describe('normalizeParameters', function () {
    const strategy = makeStrategy();

    it('returns empty array for undefined', function () {
      assert.deepStrictEqual(strategy.normalizeParameters(undefined), []);
    });

    it('returns empty array for empty input', function () {
      assert.deepStrictEqual(strategy.normalizeParameters([]), []);
    });

    it('coerces null/undefined default_value to ""', function () {
      const out = strategy.normalizeParameters([
        { name: 'a', default_value: null },
        { name: 'b' },
        { name: 'c', default_value: 'keep' },
      ]);
      assert.deepStrictEqual(out, [
        { name: 'a', default_value: '' },
        { name: 'b', default_value: '' },
        { name: 'c', default_value: 'keep' },
      ]);
    });
  });

  describe('skillMetadataDiffers', function () {
    const strategy = makeStrategy();

    const base = {
      id: 'x',
      idn: 'sk',
      title: 'Sk',
      runner_type: 'guidance',
      model: { model_idn: 'gpt-4o', provider_idn: 'openai' },
      parameters: [{ name: 'topic', default_value: '' }],
      path: '',
    };

    it('returns false for identical metadata', function () {
      assert.strictEqual(strategy.skillMetadataDiffers({ ...base }, { ...base }), false);
    });

    it('detects title change', function () {
      assert.strictEqual(
        strategy.skillMetadataDiffers({ ...base, title: 'Old' }, { ...base, title: 'New' }),
        true
      );
    });

    it('detects runner_type change', function () {
      assert.strictEqual(
        strategy.skillMetadataDiffers({ ...base }, { ...base, runner_type: 'nsl' }),
        true
      );
    });

    it('detects model change', function () {
      assert.strictEqual(
        strategy.skillMetadataDiffers(
          { ...base },
          { ...base, model: { model_idn: 'gpt-4o', provider_idn: 'azure' } }
        ),
        true
      );
    });

    it('detects parameter set change (new param added locally)', function () {
      assert.strictEqual(
        strategy.skillMetadataDiffers(
          { ...base, parameters: [] },
          { ...base }
        ),
        true
      );
    });

    it('ignores model key order (map stores provider_idn first, YAML builds model_idn first)', function () {
      // Regression: JSON.stringify(model) comparison flagged all 1342 skills
      // of a live account as changed on every push.
      const fromMap = { ...base, model: { provider_idn: 'openai', model_idn: 'gpt-4o' } };
      const fromYaml = { ...base, model: { model_idn: 'gpt-4o', provider_idn: 'openai' } };
      assert.strictEqual(strategy.skillMetadataDiffers(fromMap, fromYaml), false);
    });

    it('ignores parameter order', function () {
      const a = { ...base, parameters: [{ name: 'x', default_value: '' }, { name: 'y', default_value: '1' }] };
      const b = { ...base, parameters: [{ name: 'y', default_value: '1' }, { name: 'x', default_value: '' }] };
      assert.strictEqual(strategy.skillMetadataDiffers(a, b), false);
    });
  });

  describe('buildV2SkillMetadataFromYaml', function () {
    const strategy = makeStrategy();

    const flowDef = {
      idn: 'flow',
      title: 'Flow',
      default_runner_type: 'guidance',
      default_model_idn: 'gpt-4o',
      default_provider_idn: 'openai',
      events: [],
      state_fields: [],
      skills: [],
    };

    it('uses skill-level model when present', function () {
      const skill = {
        idn: 'sk',
        title: 'Sk',
        runner_type: 'guidance',
        model: { model_idn: 'claude-sonnet-4-6', provider_idn: 'anthropic' },
        parameters: [],
      };
      const meta = strategy.buildV2SkillMetadataFromYaml(skill, flowDef, 'guidance');
      assert.strictEqual(meta.model.model_idn, 'claude-sonnet-4-6');
      assert.strictEqual(meta.model.provider_idn, 'anthropic');
    });

    it('falls back to flow default model when skill model missing', function () {
      const skill = { idn: 'sk', title: 'Sk', runner_type: 'guidance', parameters: [] };
      const meta = strategy.buildV2SkillMetadataFromYaml(skill, flowDef, 'guidance');
      assert.strictEqual(meta.model.model_idn, 'gpt-4o');
      assert.strictEqual(meta.model.provider_idn, 'openai');
    });

    it('preserves id/path from existing metadata', function () {
      const skill = { idn: 'sk', title: 'Sk', runner_type: 'guidance', parameters: [] };
      const existing = {
        id: 'remote-uuid',
        idn: 'sk',
        title: 'Sk',
        runner_type: 'guidance',
        model: { model_idn: 'x', provider_idn: 'y' },
        parameters: [],
        path: '/agent/flow/sk',
      };
      const meta = strategy.buildV2SkillMetadataFromYaml(skill, flowDef, 'guidance', existing);
      assert.strictEqual(meta.id, 'remote-uuid');
      assert.strictEqual(meta.path, '/agent/flow/sk');
    });

    it('returns empty strings when neither skill nor flow declare a model (caught by assertSkillModelResolved)', function () {
      const skill = { idn: 'sk', title: 'Sk', runner_type: 'guidance', parameters: [] };
      const emptyFlow = { ...flowDef, default_model_idn: '', default_provider_idn: '' };
      const meta = strategy.buildV2SkillMetadataFromYaml(skill, emptyFlow, 'guidance');
      assert.strictEqual(meta.model.model_idn, '');
      assert.strictEqual(meta.model.provider_idn, '');
    });
  });
});
