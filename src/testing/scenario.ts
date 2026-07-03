/**
 * Scenario module for `newo test` - pure logic only.
 *
 * No I/O, no axios: parsing/validating a scenario YAML file's already-read text,
 * asserting a turn's expectations against the agent's reply text, and resolving the
 * per-turn timeout precedence are all pure functions so the whole contract is
 * unit-testable without spawning a sandbox session.
 */
import yaml from 'js-yaml';

/** Default timeout (ms) when no turn/scenario/CLI value is given - matches `newo sandbox`. */
export const DEFAULT_TIMEOUT_MS = 60_000;

const KNOWN_EXPECT_KEYS = ['contains', 'not_contains', 'regex'] as const;
const KNOWN_TURN_KEYS = ['message', 'timeout', 'expect'] as const;
const KNOWN_TOP_LEVEL_KEYS = ['name', 'connector', 'integration', 'timeout', 'turns'] as const;

/** One turn's assertion set, normalized: string-or-list inputs become string arrays. */
export interface TurnExpectation {
  contains?: string[];
  notContains?: string[];
  regex?: string;
}

/** One scripted user turn in a scenario's shared conversation. */
export interface ScenarioTurn {
  message: string;
  timeoutSeconds?: number;
  expect: TurnExpectation;
}

/** A parsed, fully-validated scenario file. */
export interface Scenario {
  name?: string;
  connectorIdn?: string;
  integrationIdn?: string;
  timeoutSeconds?: number;
  turns: ScenarioTurn[];
}

/** Turn outcome status, mirrored in `--json` output. */
export type TurnStatus = 'pass' | 'fail' | 'timeout' | 'skipped';

/** Per-turn result, produced by the runner (st-02) - the shape lives here since it's a feature type. */
export interface TurnResult {
  index: number;
  status: TurnStatus;
  failures?: string[];
  response?: string;
  elapsedMs?: number;
  reason?: string;
}

/** The result of running one assertion set against a turn's reply text. */
export interface AssertionResult {
  passed: boolean;
  failures: string[];
}

/** Error thrown by `parseScenario` - message already carries the file path and offending field. */
export class ScenarioValidationError extends Error {}

function fail(path: string, message: string): never {
  throw new ScenarioValidationError(`scenario file: ${path} - ${message}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeKnownKeys(keys: readonly string[]): string {
  return keys.join(', ');
}

function checkUnknownKeys(
  obj: Record<string, unknown>,
  known: readonly string[],
  path: string,
  scenarioPath: string
): void {
  for (const key of Object.keys(obj)) {
    if (!(known as readonly string[]).includes(key)) {
      fail(
        scenarioPath,
        `${path}: unknown key "${key}" (known: ${describeKnownKeys(known)})`
      );
    }
  }
}

/**
 * Normalize a YAML `contains`/`not_contains` value (string or list of strings) into a
 * string array. Throws a descriptive, path-bearing error for anything else.
 */
function normalizeStringOrList(value: unknown, fieldPath: string, scenarioPath: string): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      fail(scenarioPath, `${fieldPath}: must not be an empty list`);
    }
    return value.map((entry, entryIndex) => {
      if (typeof entry !== 'string') {
        fail(scenarioPath, `${fieldPath}[${entryIndex}]: must be a string, got ${typeof entry}`);
      }
      return entry;
    });
  }
  fail(scenarioPath, `${fieldPath}: must be a string or list of strings, got ${typeof value}`);
}

function validateTimeout(value: unknown, fieldPath: string, scenarioPath: string): number {
  const numeric = typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) {
    fail(
      scenarioPath,
      `${fieldPath}: must be a finite positive number of seconds, got ${JSON.stringify(value)}`
    );
  }
  return numeric;
}

function validateExpect(value: unknown, turnPath: string, scenarioPath: string): TurnExpectation {
  const fieldPath = `${turnPath}.expect`;
  if (!isPlainObject(value)) {
    fail(scenarioPath, `${fieldPath}: required object with at least one of ${describeKnownKeys(KNOWN_EXPECT_KEYS)}`);
  }

  checkUnknownKeys(value, KNOWN_EXPECT_KEYS, fieldPath, scenarioPath);

  const keysPresent = KNOWN_EXPECT_KEYS.filter(key => key in value);
  if (keysPresent.length === 0) {
    fail(scenarioPath, `${fieldPath}: must specify at least one of ${describeKnownKeys(KNOWN_EXPECT_KEYS)}`);
  }

  const expect: TurnExpectation = {};

  if ('contains' in value) {
    expect.contains = normalizeStringOrList(value.contains, `${fieldPath}.contains`, scenarioPath);
  }
  if ('not_contains' in value) {
    expect.notContains = normalizeStringOrList(value.not_contains, `${fieldPath}.not_contains`, scenarioPath);
  }
  if ('regex' in value) {
    const regexField = `${fieldPath}.regex`;
    if (typeof value.regex !== 'string') {
      fail(scenarioPath, `${regexField}: must be a string, got ${typeof value.regex}`);
    }
    try {
      new RegExp(value.regex);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      fail(scenarioPath, `${regexField}: does not compile as a RegExp ("${value.regex}"): ${reason}`);
    }
    expect.regex = value.regex;
  }

  return expect;
}

function validateTurn(value: unknown, index: number, scenarioPath: string): ScenarioTurn {
  const turnPath = `turns[${index}]`;
  if (!isPlainObject(value)) {
    fail(scenarioPath, `${turnPath}: must be an object with "message" and "expect"`);
  }

  checkUnknownKeys(value, KNOWN_TURN_KEYS, turnPath, scenarioPath);

  if (!('message' in value)) {
    fail(scenarioPath, `${turnPath}: missing required key "message"`);
  }
  if (typeof value.message !== 'string' || value.message.length === 0) {
    fail(scenarioPath, `${turnPath}.message: must be a non-empty string`);
  }

  if (!('expect' in value)) {
    fail(scenarioPath, `${turnPath}: missing required key "expect"`);
  }
  const expect = validateExpect(value.expect, turnPath, scenarioPath);

  const turn: ScenarioTurn = { message: value.message, expect };
  if ('timeout' in value) {
    turn.timeoutSeconds = validateTimeout(value.timeout, `${turnPath}.timeout`, scenarioPath);
  }

  return turn;
}

/**
 * Parse and fully validate a scenario YAML file's content. Pure - takes the already-read
 * file text and its path (for error messages only, never read from disk here).
 *
 * Throws `ScenarioValidationError` with a descriptive, path-bearing message on any
 * malformed YAML or schema violation (unknown keys, missing/empty turns, missing
 * message/expect, non-compiling regex, non-finite/non-positive timeouts).
 */
export function parseScenario(content: string, scenarioPath: string): Scenario {
  let parsed: unknown;
  try {
    parsed = yaml.load(content);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    fail(scenarioPath, `invalid YAML: ${reason}`);
  }

  if (!isPlainObject(parsed)) {
    fail(scenarioPath, 'root: must be a YAML mapping (object)');
  }

  checkUnknownKeys(parsed, KNOWN_TOP_LEVEL_KEYS, 'root', scenarioPath);

  const scenario: Scenario = { turns: [] };

  if ('name' in parsed) {
    if (typeof parsed.name !== 'string' || parsed.name.length === 0) {
      fail(scenarioPath, 'name: must be a non-empty string');
    }
    scenario.name = parsed.name;
  }

  if ('connector' in parsed) {
    if (typeof parsed.connector !== 'string' || parsed.connector.length === 0) {
      fail(scenarioPath, 'connector: must be a non-empty string');
    }
    scenario.connectorIdn = parsed.connector;
  }

  if ('integration' in parsed) {
    if (typeof parsed.integration !== 'string' || parsed.integration.length === 0) {
      fail(scenarioPath, 'integration: must be a non-empty string');
    }
    scenario.integrationIdn = parsed.integration;
  }

  if ('timeout' in parsed) {
    scenario.timeoutSeconds = validateTimeout(parsed.timeout, 'timeout', scenarioPath);
  }

  if (!('turns' in parsed)) {
    fail(scenarioPath, 'turns: missing required key (non-empty array)');
  }
  if (!Array.isArray(parsed.turns) || parsed.turns.length === 0) {
    fail(scenarioPath, 'turns: must be a non-empty array');
  }

  scenario.turns = parsed.turns.map((turn, index) => validateTurn(turn, index, scenarioPath));

  return scenario;
}

/**
 * Assert one turn's expectation set against the agent's reply text (all agent acts'
 * `source_text` joined with `\n`, per the design's reply-text contract). AND semantics
 * across `contains` / `not_contains` / `regex`; matching is case-sensitive.
 */
export function assertTurn(expect: TurnExpectation, response: string): AssertionResult {
  const failures: string[] = [];

  if (expect.contains) {
    for (const needle of expect.contains) {
      if (!response.includes(needle)) {
        failures.push(`contains "${needle}": not found in response`);
      }
    }
  }

  if (expect.notContains) {
    for (const needle of expect.notContains) {
      if (response.includes(needle)) {
        failures.push(`not_contains "${needle}": found in response`);
      }
    }
  }

  if (expect.regex) {
    const pattern = new RegExp(expect.regex);
    if (!pattern.test(response)) {
      failures.push(`regex "${expect.regex}": did not match response`);
    }
  }

  return { passed: failures.length === 0, failures };
}

/**
 * Resolve the effective per-turn timeout in milliseconds. Precedence (highest first):
 * turn-level YAML `timeout` > scenario-level YAML `timeout` > CLI `--timeout` > 60s default.
 * All seconds inputs are converted to ms; `undefined` at any level falls through to the next.
 */
export function resolveTimeoutMs(
  turnTimeoutSeconds: number | undefined,
  scenarioTimeoutSeconds: number | undefined,
  cliTimeoutSeconds: number | undefined
): number {
  if (turnTimeoutSeconds !== undefined) return turnTimeoutSeconds * 1000;
  if (scenarioTimeoutSeconds !== undefined) return scenarioTimeoutSeconds * 1000;
  if (cliTimeoutSeconds !== undefined) return cliTimeoutSeconds * 1000;
  return DEFAULT_TIMEOUT_MS;
}
