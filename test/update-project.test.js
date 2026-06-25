/**
 * Unit tests for `newo update-project` core logic (v3.7.7).
 *
 * Covers the spec acceptance criteria:
 *  - GET → merge → PATCH preserves untouched fields
 *  - `version` is sent in the PATCHed body
 *  - the request uses the `by-id/{id}` path with the PATCH method
 *  - the re-read/print path returns the effective server state
 *
 * Uses a fake axios client (get/patch) — no network, no auth.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildProjectUpdateBody,
  applyProjectUpdate
} from '../dist/cli/commands/update-project.js';
import { forceUpdateProject } from '../dist/api.js';

const NAF_META = {
  id: '4b96faab-58b9-4680-b3e8-1b526eae15eb',
  idn: 'naf',
  title: 'NAF (Newo AI Employee Framework)',
  description: null,
  version: '4.4.0',
  is_auto_update_enabled: true,
  registry_idn: 'production',
  registry_item_idn: 'naf',
  registry_item_version: null,
  updated_at: '2026-05-28T00:00:00.000Z'
};

/** Fake axios client recording calls; PATCH mutates the stored meta. */
function makeFakeClient(initialMeta) {
  let meta = { ...initialMeta };
  const calls = [];
  return {
    calls,
    async get(url) {
      calls.push({ method: 'get', url });
      return { data: { ...meta } };
    },
    async patch(url, body) {
      calls.push({ method: 'patch', url, body });
      // PATCH defaults omitted fields — model that by replacing wholesale.
      meta = {
        ...meta,
        idn: body.idn,
        title: body.title,
        description: body.description,
        version: body.version,
        is_auto_update_enabled: body.is_auto_update_enabled,
        registry_idn: body.registry_idn,
        registry_item_idn: body.registry_item_idn,
        registry_item_version: body.registry_item_version
      };
      return { data: { ...meta } };
    }
  };
}

describe('buildProjectUpdateBody', () => {
  it('overlays version while preserving every untouched field', () => {
    const body = buildProjectUpdateBody(NAF_META, { version: '4.5.2' });
    assert.equal(body.version, '4.5.2');
    assert.equal(body.idn, 'naf');
    assert.equal(body.title, 'NAF (Newo AI Employee Framework)');
    assert.equal(body.description, null);
    assert.equal(body.is_auto_update_enabled, true); // not flipped to false
    assert.equal(body.registry_idn, 'production');
    assert.equal(body.registry_item_idn, 'naf');
    assert.equal(body.registry_item_version, null);
  });

  it('sends a full object (all mutable fields present)', () => {
    const body = buildProjectUpdateBody(NAF_META, { version: '4.5.2' });
    assert.deepEqual(Object.keys(body).sort(), [
      'description',
      'idn',
      'is_auto_update_enabled',
      'registry_idn',
      'registry_item_idn',
      'registry_item_version',
      'title',
      'version'
    ]);
  });

  it('applies optional overrides (auto-update, registry_item_version, title)', () => {
    const body = buildProjectUpdateBody(NAF_META, {
      version: '4.5.2',
      is_auto_update_enabled: false,
      registry_item_version: '4.5.2',
      title: 'Renamed'
    });
    assert.equal(body.is_auto_update_enabled, false);
    assert.equal(body.registry_item_version, '4.5.2');
    assert.equal(body.title, 'Renamed');
  });

  it('coerces missing meta fields to safe defaults', () => {
    const sparse = { id: 'x', idn: 'p', title: 'P' };
    const body = buildProjectUpdateBody(sparse, { version: '1.0.0' });
    assert.equal(body.description, null);
    assert.equal(body.is_auto_update_enabled, false);
    assert.equal(body.registry_idn, '');
    assert.equal(body.registry_item_idn, null);
    assert.equal(body.registry_item_version, null);
  });
});

describe('applyProjectUpdate', () => {
  it('GETs by-id, PATCHes by-id, then re-GETs', async () => {
    const client = makeFakeClient(NAF_META);
    const { before, after } = await applyProjectUpdate(client, NAF_META.id, { version: '4.5.2' });

    assert.equal(before.version, '4.4.0');
    assert.equal(after.version, '4.5.2');

    assert.equal(client.calls.length, 3);
    assert.deepEqual(
      client.calls.map((c) => c.method),
      ['get', 'patch', 'get']
    );
    for (const c of client.calls) {
      assert.equal(c.url, `/api/v1/designer/projects/by-id/${NAF_META.id}`);
    }
  });

  it('sends version in the PATCH body and preserves is_auto_update_enabled', async () => {
    const client = makeFakeClient(NAF_META);
    await applyProjectUpdate(client, NAF_META.id, { version: '4.5.2' });

    const patch = client.calls.find((c) => c.method === 'patch');
    assert.equal(patch.body.version, '4.5.2');
    assert.equal(patch.body.is_auto_update_enabled, true);
    assert.equal(patch.body.idn, 'naf');
  });

  it('returns effective server state from the re-read', async () => {
    const client = makeFakeClient(NAF_META);
    const { after } = await applyProjectUpdate(client, NAF_META.id, {
      version: '4.5.2',
      is_auto_update_enabled: false
    });
    assert.equal(after.version, '4.5.2');
    assert.equal(after.is_auto_update_enabled, false);
  });
});

describe('forceUpdateProject', () => {
  it('POSTs the by-id/force-update endpoint with no body', async () => {
    const calls = [];
    const client = {
      async post(url, body) {
        calls.push({ url, body });
        return { data: null };
      }
    };
    await forceUpdateProject(client, NAF_META.id);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `/api/v1/designer/projects/by-id/${NAF_META.id}/force-update`);
    assert.equal(calls[0].body, undefined);
  });
});
