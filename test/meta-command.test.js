import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pickMetaProject } from '../dist/cli/commands/meta.js';

const P = (id, idn) => ({ id, idn });

test('pickMetaProject uses the configured id when set', () => {
  assert.deepEqual(pickMetaProject('pid-1', [P('a', 'x'), P('b', 'y')]), {
    kind: 'use',
    projectId: 'pid-1'
  });
});

test('pickMetaProject uses the sole project when no id is configured', () => {
  assert.deepEqual(pickMetaProject(undefined, [P('only', 'solo')]), {
    kind: 'use',
    projectId: 'only'
  });
});

test('pickMetaProject lists candidates when ambiguous (no exit 1)', () => {
  const c = pickMetaProject(undefined, [P('a', 'x'), P('b', 'y')]);
  assert.equal(c.kind, 'list');
  assert.equal(c.projects.length, 2);
});

test('pickMetaProject reports none when there are no projects', () => {
  assert.deepEqual(pickMetaProject(undefined, []), { kind: 'none' });
});
