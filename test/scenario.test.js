/**
 * Unit tests for src/testing/scenario.ts (CLI-TEST-1 st-01):
 *
 *   - parseScenario: YAML parse + exhaustive schema validation, pure (no I/O).
 *   - assertTurn: contains/not_contains/regex assertion engine, AND semantics.
 *   - resolveTimeoutMs: turn > scenario > CLI > 60000ms precedence.
 *
 * No network, no fake axios needed - the whole module is pure.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseScenario,
  assertTurn,
  resolveTimeoutMs,
  DEFAULT_TIMEOUT_MS,
  ScenarioValidationError
} from '../dist/testing/scenario.js';

const SCENARIO_PATH = 'scenarios/example.yaml';

function validYaml(overrides = '') {
  return `
name: order status happy path
connector: vibe_agent
turns:
  - message: "Hi"
    expect:
      contains: "Hello"
${overrides}
`;
}

// --- parseScenario: happy path ---

test('parseScenario returns a fully-populated Scenario for valid YAML with all optional top-level keys', () => {
  const content = `
name: order status happy path
connector: vibe_agent
integration: sandbox
timeout: 90
turns:
  - message: "Hi"
    expect:
      contains: "Hello"
  - message: "Where is my order 123?"
    timeout: 120
    expect:
      contains: ["order", "123"]
      not_contains: "error"
      regex: "order\\\\s+#?123"
`;
  const scenario = parseScenario(content, SCENARIO_PATH);

  assert.equal(scenario.name, 'order status happy path');
  assert.equal(scenario.connectorIdn, 'vibe_agent');
  assert.equal(scenario.integrationIdn, 'sandbox');
  assert.equal(scenario.timeoutSeconds, 90);
  assert.equal(scenario.turns.length, 2);

  assert.deepEqual(scenario.turns[0], {
    message: 'Hi',
    expect: { contains: ['Hello'] }
  });
  assert.equal(scenario.turns[1].message, 'Where is my order 123?');
  assert.equal(scenario.turns[1].timeoutSeconds, 120);
  assert.deepEqual(scenario.turns[1].expect, {
    contains: ['order', '123'],
    notContains: ['error'],
    regex: 'order\\s+#?123'
  });
});

test('parseScenario omits optional top-level fields entirely when absent from YAML', () => {
  const scenario = parseScenario(validYaml(), SCENARIO_PATH);

  assert.ok(!('integration' in scenario) || scenario.integrationIdn === undefined);
  assert.equal(scenario.timeoutSeconds, undefined);
  assert.ok(!('integrationIdn' in scenario));
});

test('parseScenario normalizes a single-string contains/not_contains into a one-element array', () => {
  const scenario = parseScenario(
    `
turns:
  - message: "Hi"
    expect:
      contains: "Hello"
      not_contains: "error"
`,
    SCENARIO_PATH
  );

  assert.deepEqual(scenario.turns[0].expect.contains, ['Hello']);
  assert.deepEqual(scenario.turns[0].expect.notContains, ['error']);
});

// --- parseScenario: every validation error path ---

const INVALID_CASES = [
  {
    name: 'malformed YAML syntax',
    content: 'turns: [\n  - message: "unterminated',
    expectedSubstring: 'invalid YAML:'
  },
  {
    name: 'root is not a mapping (a scalar)',
    content: 'just a string',
    expectedSubstring: 'root: must be a YAML mapping'
  },
  {
    name: 'root is not a mapping (a list)',
    content: '- one\n- two',
    expectedSubstring: 'root: must be a YAML mapping'
  },
  {
    name: 'unknown top-level key',
    content: 'turns:\n  - message: "Hi"\n    expect:\n      contains: "Hello"\nexpects:\n  foo: bar',
    expectedSubstring: 'root: unknown key "expects"'
  },
  {
    name: 'name is not a string',
    content: 'name: 5\nturns:\n  - message: "Hi"\n    expect:\n      contains: "Hello"',
    expectedSubstring: 'name: must be a non-empty string'
  },
  {
    name: 'connector is an empty string',
    content: 'connector: ""\nturns:\n  - message: "Hi"\n    expect:\n      contains: "Hello"',
    expectedSubstring: 'connector: must be a non-empty string'
  },
  {
    name: 'integration is not a string',
    content: 'integration: 3\nturns:\n  - message: "Hi"\n    expect:\n      contains: "Hello"',
    expectedSubstring: 'integration: must be a non-empty string'
  },
  {
    name: 'top-level timeout is zero',
    content: 'timeout: 0\nturns:\n  - message: "Hi"\n    expect:\n      contains: "Hello"',
    expectedSubstring: 'timeout: must be a finite positive number of seconds'
  },
  {
    name: 'top-level timeout is negative',
    content: 'timeout: -5\nturns:\n  - message: "Hi"\n    expect:\n      contains: "Hello"',
    expectedSubstring: 'timeout: must be a finite positive number of seconds'
  },
  {
    name: 'top-level timeout is not a number',
    content: 'timeout: "soon"\nturns:\n  - message: "Hi"\n    expect:\n      contains: "Hello"',
    expectedSubstring: 'timeout: must be a finite positive number of seconds'
  },
  {
    name: 'turns key missing entirely',
    content: 'name: no turns here',
    expectedSubstring: 'turns: missing required key'
  },
  {
    name: 'turns is an empty array',
    content: 'turns: []',
    expectedSubstring: 'turns: must be a non-empty array'
  },
  {
    name: 'turns is not an array',
    content: 'turns: "nope"',
    expectedSubstring: 'turns: must be a non-empty array'
  },
  {
    name: 'a turn is not an object',
    content: 'turns:\n  - "just a string"',
    expectedSubstring: 'turns[0]: must be an object with "message" and "expect"'
  },
  {
    name: 'a turn has an unknown key',
    content: 'turns:\n  - message: "Hi"\n    expect:\n      contains: "Hello"\n    expects: {}',
    expectedSubstring: 'turns[0]: unknown key "expects"'
  },
  {
    name: 'a turn is missing message',
    content: 'turns:\n  - expect:\n      contains: "Hello"',
    expectedSubstring: 'turns[0]: missing required key "message"'
  },
  {
    name: 'a turn message is an empty string',
    content: 'turns:\n  - message: ""\n    expect:\n      contains: "Hello"',
    expectedSubstring: 'turns[0].message: must be a non-empty string'
  },
  {
    name: 'a turn message is not a string',
    content: 'turns:\n  - message: 42\n    expect:\n      contains: "Hello"',
    expectedSubstring: 'turns[0].message: must be a non-empty string'
  },
  {
    name: 'a turn is missing expect',
    content: 'turns:\n  - message: "Hi"',
    expectedSubstring: 'turns[0]: missing required key "expect"'
  },
  {
    name: 'a turn expect is not an object',
    content: 'turns:\n  - message: "Hi"\n    expect: "Hello"',
    expectedSubstring: 'turns[0].expect: required object with at least one of'
  },
  {
    name: 'a turn expect has an unknown key (typo)',
    content: 'turns:\n  - message: "Hi"\n    expect:\n      conatins: "Hello"',
    expectedSubstring: 'turns[0].expect: unknown key "conatins" (known: contains, not_contains, regex)'
  },
  {
    name: 'a turn expect has none of the known keys',
    content: 'turns:\n  - message: "Hi"\n    expect: {}',
    expectedSubstring: 'turns[0].expect: must specify at least one of'
  },
  {
    name: 'expect.contains is neither a string nor a list',
    content: 'turns:\n  - message: "Hi"\n    expect:\n      contains: 5',
    expectedSubstring: 'turns[0].expect.contains: must be a string or list of strings'
  },
  {
    name: 'expect.contains is an empty list',
    content: 'turns:\n  - message: "Hi"\n    expect:\n      contains: []',
    expectedSubstring: 'turns[0].expect.contains: must not be an empty list'
  },
  {
    name: 'expect.contains list has a non-string entry',
    content: 'turns:\n  - message: "Hi"\n    expect:\n      contains: ["ok", 5]',
    expectedSubstring: 'turns[0].expect.contains[1]: must be a string, got number'
  },
  {
    name: 'expect.not_contains is neither a string nor a list',
    content: 'turns:\n  - message: "Hi"\n    expect:\n      not_contains: 5',
    expectedSubstring: 'turns[0].expect.not_contains: must be a string or list of strings'
  },
  {
    name: 'expect.regex is not a string',
    content: 'turns:\n  - message: "Hi"\n    expect:\n      regex: 5',
    expectedSubstring: 'turns[0].expect.regex: must be a string'
  },
  {
    name: 'expect.regex does not compile',
    content: 'turns:\n  - message: "Hi"\n    expect:\n      regex: "order(unclosed"',
    expectedSubstring: 'turns[0].expect.regex: does not compile as a RegExp'
  },
  {
    name: 'a turn timeout is zero',
    content: 'turns:\n  - message: "Hi"\n    timeout: 0\n    expect:\n      contains: "Hello"',
    expectedSubstring: 'turns[0].timeout: must be a finite positive number of seconds'
  },
  {
    name: 'a turn timeout is non-finite (NaN via non-numeric YAML)',
    content: 'turns:\n  - message: "Hi"\n    timeout: "soon"\n    expect:\n      contains: "Hello"',
    expectedSubstring: 'turns[0].timeout: must be a finite positive number of seconds'
  },
  {
    name: 'the second turn is the one that is invalid (path indexing)',
    content:
      'turns:\n  - message: "Hi"\n    expect:\n      contains: "Hello"\n  - message: "Bye"\n    expect:\n      conatins: "Bye"',
    expectedSubstring: 'turns[1].expect: unknown key "conatins"'
  }
];

for (const invalidCase of INVALID_CASES) {
  test(`parseScenario rejects: ${invalidCase.name}`, () => {
    assert.throws(
      () => parseScenario(invalidCase.content, SCENARIO_PATH),
      (error) => {
        assert.ok(error instanceof ScenarioValidationError, 'error should be a ScenarioValidationError');
        assert.ok(
          error.message.startsWith(`scenario file: ${SCENARIO_PATH} - `),
          `error message should be path-bearing, got: ${error.message}`
        );
        assert.ok(
          error.message.includes(invalidCase.expectedSubstring),
          `expected error to include "${invalidCase.expectedSubstring}", got: ${error.message}`
        );
        return true;
      }
    );
  });
}

// --- assertTurn: every assertion combination ---

test('assertTurn passes when contains substring is present', () => {
  const result = assertTurn({ contains: ['Hello'] }, 'Hello there, how can I help?');
  assert.deepEqual(result, { passed: true, failures: [] });
});

test('assertTurn fails when contains substring is absent, naming the assertion and why', () => {
  const result = assertTurn({ contains: ['order'] }, 'Hello there!');
  assert.equal(result.passed, false);
  assert.deepEqual(result.failures, ['contains "order": not found in response']);
});

test('assertTurn contains applies AND semantics across a list - all must match', () => {
  const result = assertTurn({ contains: ['order', '123'] }, 'Your order #999 has shipped');
  assert.equal(result.passed, false);
  assert.deepEqual(result.failures, ['contains "123": not found in response']);
});

test('assertTurn contains list passes only when every substring is present', () => {
  const result = assertTurn({ contains: ['order', '123'] }, 'Your order #123 has shipped');
  assert.deepEqual(result, { passed: true, failures: [] });
});

test('assertTurn passes when not_contains substring is absent', () => {
  const result = assertTurn({ notContains: ['error'] }, 'All good here');
  assert.deepEqual(result, { passed: true, failures: [] });
});

test('assertTurn fails when not_contains substring is present, naming the assertion and why', () => {
  const result = assertTurn({ notContains: ['error'] }, 'An error occurred');
  assert.equal(result.passed, false);
  assert.deepEqual(result.failures, ['not_contains "error": found in response']);
});

test('assertTurn passes when regex matches', () => {
  const result = assertTurn({ regex: 'order\\s+#?123' }, 'Your order #123 has shipped');
  assert.deepEqual(result, { passed: true, failures: [] });
});

test('assertTurn fails when regex does not match, naming the assertion and why', () => {
  const result = assertTurn({ regex: 'order\\s+#?123' }, 'Your order #999 has shipped');
  assert.equal(result.passed, false);
  assert.deepEqual(result.failures, ['regex "order\\s+#?123": did not match response']);
});

test('assertTurn regex is case-sensitive', () => {
  const result = assertTurn({ regex: 'Hello' }, 'hello there');
  assert.equal(result.passed, false);
});

test('assertTurn contains is case-sensitive', () => {
  const result = assertTurn({ contains: ['Hello'] }, 'hello there');
  assert.equal(result.passed, false);
  assert.deepEqual(result.failures, ['contains "Hello": not found in response']);
});

test('assertTurn combines contains/not_contains/regex with AND semantics, collecting every failure', () => {
  const result = assertTurn(
    {
      contains: ['order', '123'],
      notContains: ['error'],
      regex: 'order\\s+#?123'
    },
    'An error occurred while checking order #999'
  );

  assert.equal(result.passed, false);
  assert.deepEqual(result.failures, [
    'contains "123": not found in response',
    'not_contains "error": found in response',
    'regex "order\\s+#?123": did not match response'
  ]);
});

test('assertTurn passes when all combined assertions are individually satisfied', () => {
  const result = assertTurn(
    {
      contains: ['order', '123'],
      notContains: ['error'],
      regex: 'order\\s+#?123'
    },
    'Your order #123 has shipped, no issues found'
  );
  assert.deepEqual(result, { passed: true, failures: [] });
});

test('assertTurn against an empty response: contains fails, not_contains passes, regex fails', () => {
  const result = assertTurn({ contains: ['order'], notContains: ['error'], regex: 'order' }, '');
  assert.equal(result.passed, false);
  assert.deepEqual(result.failures, [
    'contains "order": not found in response',
    'regex "order": did not match response'
  ]);
});

test('assertTurn against an empty response with only not_contains: passes trivially', () => {
  const result = assertTurn({ notContains: ['error'] }, '');
  assert.deepEqual(result, { passed: true, failures: [] });
});

test('assertTurn with an empty expect object passes (no assertions to fail)', () => {
  const result = assertTurn({}, 'anything at all');
  assert.deepEqual(result, { passed: true, failures: [] });
});

// --- resolveTimeoutMs: full precedence table ---

test('resolveTimeoutMs returns the default 60000ms when nothing is specified', () => {
  assert.equal(resolveTimeoutMs(undefined, undefined, undefined), DEFAULT_TIMEOUT_MS);
  assert.equal(resolveTimeoutMs(undefined, undefined, undefined), 60_000);
});

test('resolveTimeoutMs uses the CLI value (seconds -> ms) when only CLI is given', () => {
  assert.equal(resolveTimeoutMs(undefined, undefined, 45), 45_000);
});

test('resolveTimeoutMs uses the scenario value when scenario is given, ignoring CLI', () => {
  assert.equal(resolveTimeoutMs(undefined, 90, 45), 90_000);
});

test('resolveTimeoutMs uses the turn value when turn is given, ignoring scenario and CLI', () => {
  assert.equal(resolveTimeoutMs(120, 90, 45), 120_000);
});

test('resolveTimeoutMs uses the turn value when only turn is given', () => {
  assert.equal(resolveTimeoutMs(30, undefined, undefined), 30_000);
});

test('resolveTimeoutMs uses the scenario value when turn is absent but scenario is given, no CLI', () => {
  assert.equal(resolveTimeoutMs(undefined, 90, undefined), 90_000);
});

test('resolveTimeoutMs falls through turn and scenario to CLI when both are absent', () => {
  assert.equal(resolveTimeoutMs(undefined, undefined, 15), 15_000);
});
