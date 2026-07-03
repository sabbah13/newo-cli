/**
 * Test command - `newo test <scenario.yaml>`: drives one scripted, multi-turn
 * conversation against a live sandbox agent and asserts on each reply.
 *
 * All turns share a single conversation (one `createChatSession` call, then
 * `sendMessage`/`pollForResponse` looped per turn) - this is not a batch of
 * independent messages, it is one scripted dialog. On the first turn that
 * fails its assertions or times out, the run aborts (fail-fast): the shared
 * conversation state may already be off-script, so remaining turns are
 * reported as "skipped" rather than sent.
 *
 * Usage:
 *   newo test scenario.yaml
 *   newo test scenario.yaml --connector vibe_agent --timeout 90
 *   newo test scenario.yaml --json > result.json
 *   newo test scenario.yaml --customer <idn>
 */

import fs from 'fs-extra';
import path from 'node:path';
import type { MultiCustomerConfig, CliArgs } from '../../types.js';
import { makeClient } from '../../api.js';
import { getValidAccessToken } from '../../auth.js';
import { requireSingleCustomer } from '../customer-selection.js';
import {
  findSandboxConnector,
  createChatSession,
  sendMessage,
  pollForResponse,
  normalizeActEventId
} from '../../sandbox/chat.js';
import {
  parseScenario,
  assertTurn,
  resolveTimeoutMs,
  ScenarioValidationError
} from '../../testing/scenario.js';
import type { Scenario, TurnStatus } from '../../testing/scenario.js';

const DEFAULT_TIMEOUT_SECONDS = 60;
const ACTUAL_TRUNCATE_LENGTH = 500;
// Multi-bubble settle window: once the first agent act for a turn arrives, keep
// polling until no NEW agent act has appeared for this long (or the turn's overall
// timeout budget is reached), then join every agent act seen - see ADR 0001 decision 3.
const REPLY_SETTLE_MS = 1500;

/** One turn's entry in the `--json` result's `turns` array (design contract). */
interface TestJsonTurn {
  index: number;
  message: string;
  status: TurnStatus;
  elapsed_ms?: number;
  response?: string;
  failures?: string[];
  reason?: string;
  user_external_event_id?: string | null;
  agent_external_event_id?: string | null;
  flow_idn?: string | null;
  skill_idn?: string | null;
  session_id?: string | null;
}

/** The single JSON object `--json` prints on stdout. */
interface TestJsonResult {
  scenario: string;
  file: string;
  connector_idn: string;
  passed: boolean;
  summary: { total: number; passed: number; failed: number; skipped: number };
  elapsed_ms: number;
  turns: TestJsonTurn[];
}

/**
 * The single JSON object `--json` prints on stdout for ANY failure path - setup
 * (before any turn runs: bad args, malformed YAML, no connector, auth error) or run
 * (an unexpected error mid-scenario, e.g. a network failure between turns). This is
 * distinct from `TestJsonResult`, which reports a scenario that ran to completion
 * (possibly with failed/skipped turns) rather than a run that aborted unexpectedly.
 */
interface TestJsonError {
  error: string;
  phase: 'setup' | 'run';
  file: string | null;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}… (${text.length} chars)` : text;
}

/**
 * Handle the `test` command
 */
export async function handleTestCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean
): Promise<void> {
  const json: boolean = Boolean(args.json);
  // --json implies quiet logging: stdout must stay machine-readable
  const quiet: boolean = Boolean(args.quiet || args.q) || json;

  // Save original console functions
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;

  // In quiet mode, set environment variable to suppress auth logging AND suppress console
  if (quiet) {
    process.env.NEWO_QUIET_MODE = 'true';
    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};
  }

  // Tracked outside the try block so both `fail()` and the catch-all below can
  // report an accurate `file`/`phase` in the --json error contract even when the
  // failure happens before (or logically outside) the block that computes them.
  let filePathForError: string | null = null;
  let phase: 'setup' | 'run' = 'setup';

  // A setup failure (bad args, malformed YAML, no connector, auth error): print
  // (unless quiet; a JSON error object if --json) and exit before any turn runs.
  function fail(message: string): never {
    if (!quiet) {
      console.error(`❌ ${message}`);
    } else if (json) {
      const result: TestJsonError = { error: message, phase: 'setup', file: filePathForError };
      originalConsoleLog(JSON.stringify(result));
    }
    process.exit(1);
  }

  try {
    // Select customer (a scenario run is inherently single-customer)
    const customer = requireSingleCustomer(customerConfig, args.customer as string | undefined);

    const filePathArg = args._[1];
    const filePath = filePathArg === undefined ? null : String(filePathArg);
    filePathForError = filePath;
    if (!filePath) {
      fail('Scenario file is required: newo test <scenario-file.yaml>');
    }

    if (!(await fs.pathExists(filePath))) {
      fail(`Scenario file not found: ${filePath}`);
    }

    const content = await fs.readFile(filePath, 'utf8');

    // Parse + fully validate before any API call - a malformed scenario file
    // must never create a sandbox session/persona/actor.
    let scenario: Scenario;
    try {
      scenario = parseScenario(content, filePath);
    } catch (error) {
      if (error instanceof ScenarioValidationError) {
        fail(error.message);
      }
      throw error;
    }

    const cliTimeoutSeconds = args.timeout !== undefined ? parseFloat(String(args.timeout)) : undefined;
    if (args.timeout !== undefined && (!Number.isFinite(cliTimeoutSeconds) || (cliTimeoutSeconds as number) <= 0)) {
      fail(`Invalid --timeout value: ${args.timeout} (expected positive number of seconds)`);
    }

    // Only now do we touch the network - validation above never makes an API call.
    const token = await getValidAccessToken(customer);
    const client = await makeClient(quiet ? false : verbose, token);

    const integrationIdn = args.integration ? String(args.integration) : scenario.integrationIdn;
    const connectorIdn = args.connector ? String(args.connector) : scenario.connectorIdn;

    const selection: { integrationIdn?: string; connectorIdn?: string } = {};
    if (integrationIdn) selection.integrationIdn = integrationIdn;
    if (connectorIdn) selection.connectorIdn = connectorIdn;

    let connector: Awaited<ReturnType<typeof findSandboxConnector>>;
    try {
      connector = await findSandboxConnector(client, quiet ? false : verbose, selection);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
    if (!connector) {
      fail(
        'No running sandbox connector found. Please ensure you have a sandbox connector configured in your NEWO project.'
      );
    }

    const scenarioName = scenario.name || path.basename(filePath);

    if (!quiet) {
      console.log(`🧪 Running scenario: ${scenarioName}`);
      console.log(`   File: ${filePath}`);
      console.log(`   Connector: ${connector.connector_idn}\n`);
    }

    // One shared conversation for the whole scenario.
    const session = await createChatSession(client, connector, quiet ? false : verbose);

    const runStartedAt = Date.now();
    const totalTurns = scenario.turns.length;
    const jsonTurns: TestJsonTurn[] = [];
    let passedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let aborted = false;
    let abortedAtIndex = -1;

    // Any unexpected error from here on (send/poll failures, etc.) happened while
    // the scenario was actually running, not during setup.
    phase = 'run';

    for (let i = 0; i < totalTurns; i++) {
      const turn = scenario.turns[i];
      if (!turn) continue;
      const index = i + 1;

      if (aborted) {
        skippedCount++;
        const reason = `aborted after turn ${abortedAtIndex} failure`;
        jsonTurns.push({ index, message: turn.message, status: 'skipped', reason });
        if (!quiet) {
          console.log(`⊘ Turn ${index}/${totalTurns} SKIPPED (${reason})`);
        }
        continue;
      }

      const timeoutMs = resolveTimeoutMs(turn.timeoutSeconds, scenario.timeoutSeconds, cliTimeoutSeconds);
      const turnStartedAt = Date.now();
      const sentAt = await sendMessage(client, session, turn.message, quiet ? false : verbose);
      const { acts, agentPersonaId, userAct } = await pollForResponse(
        client,
        session,
        sentAt,
        quiet ? false : verbose,
        timeoutMs,
        REPLY_SETTLE_MS
      );
      session.agent_persona_id = agentPersonaId;
      const elapsedMs = Date.now() - turnStartedAt;

      const agentAct = acts.find(a => a.is_agent) || null;
      const userExternalEventId = normalizeActEventId(userAct);
      const agentExternalEventId = normalizeActEventId(agentAct);
      const flowIdn = agentAct && agentAct.flow_idn !== 'unknown' ? agentAct.flow_idn : null;
      const skillIdn = agentAct && agentAct.skill_idn !== 'unknown' ? agentAct.skill_idn : null;
      const sessionId = agentAct && agentAct.session_id !== 'unknown' ? agentAct.session_id : null;

      let status: TurnStatus;
      let failures: string[] | undefined;
      let response: string | undefined;

      if (acts.length === 0) {
        status = 'timeout';
        failures = [`timed out after ${timeoutMs}ms waiting for agent response`];
      } else {
        response = acts.map(act => act.source_text || act.original_text || '').join('\n');
        const assertion = assertTurn(turn.expect, response);
        status = assertion.passed ? 'pass' : 'fail';
        if (!assertion.passed) failures = assertion.failures;
      }

      const jsonTurn: TestJsonTurn = {
        index,
        message: turn.message,
        status,
        elapsed_ms: elapsedMs,
        user_external_event_id: userExternalEventId,
        agent_external_event_id: agentExternalEventId,
        flow_idn: flowIdn,
        skill_idn: skillIdn,
        session_id: sessionId
      };
      if (response !== undefined) jsonTurn.response = response;
      if (failures !== undefined) jsonTurn.failures = failures;
      jsonTurns.push(jsonTurn);

      if (status === 'pass') {
        passedCount++;
        if (!quiet) {
          console.log(`✓ Turn ${index}/${totalTurns} PASS (${(elapsedMs / 1000).toFixed(1)}s)`);
        }
      } else {
        failedCount++;
        aborted = true;
        abortedAtIndex = index;
        if (!quiet) {
          const label = status === 'timeout' ? 'TIMEOUT' : 'FAIL';
          console.log(`✗ Turn ${index}/${totalTurns} ${label} (${(elapsedMs / 1000).toFixed(1)}s)`);
          console.log(`   Message: ${turn.message}`);
          if (failures) {
            for (const f of failures) console.log(`   Expected: ${f}`);
          }
          if (response !== undefined) {
            console.log(`   Actual: ${truncate(response, ACTUAL_TRUNCATE_LENGTH)}`);
          }
          if (userExternalEventId) {
            console.log(`   Event ID (user turn): ${userExternalEventId}`);
            console.log(`   💡 newo logs --event-id ${userExternalEventId}`);
          }
        }
      }
    }

    const totalElapsedMs = Date.now() - runStartedAt;
    const allPassed = passedCount === totalTurns;

    if (json) {
      const result: TestJsonResult = {
        scenario: scenarioName,
        file: filePath,
        connector_idn: connector.connector_idn,
        passed: allPassed,
        summary: { total: totalTurns, passed: passedCount, failed: failedCount, skipped: skippedCount },
        elapsed_ms: totalElapsedMs,
        turns: jsonTurns
      };
      originalConsoleLog(JSON.stringify(result, null, 2));
    } else if (!quiet) {
      console.log('');
      console.log(
        `Summary: ${passedCount}/${totalTurns} passed, ${failedCount} failed, ${skippedCount} skipped (${(totalElapsedMs / 1000).toFixed(1)}s)`
      );
    }

    process.exit(allPassed ? 0 : 1);
  } catch (error: unknown) {
    // Restore console for error reporting
    if (quiet) {
      console.error = originalConsoleError;
      console.log = originalConsoleLog;
      console.warn = originalConsoleWarn;
    }

    const message = error instanceof Error ? error.message : String(error);
    if (json) {
      // Complete the --json error contract: every failure path, including this
      // catch-all for unexpected errors (auth/API/session/send), emits exactly one
      // machine-readable JSON object to stdout rather than only human stderr text.
      const result: TestJsonError = { error: message, phase, file: filePathForError };
      console.log(JSON.stringify(result));
    } else {
      console.error(`❌ Test error: ${message}`);
    }
    process.exit(1);
  } finally {
    // Always restore console functions and clear quiet mode flag
    if (quiet) {
      console.log = originalConsoleLog;
      console.error = originalConsoleError;
      console.warn = originalConsoleWarn;
      delete process.env.NEWO_QUIET_MODE;
    }
  }
}

/**
 * Print detailed `test --help` output (the `printLogsHelp` pattern).
 */
export function printTestHelp(): void {
  console.log(`
Usage: newo test <scenario-file.yaml> [options]

Drive a scripted, multi-turn conversation against a live sandbox agent and
assert on each turn's reply. All turns share one conversation (a single
createChatSession call), the same connector/session model as newo sandbox.

Options:
  --connector <idn>     Select connector by connector_idn (default: the
                         scenario's connector, or the first running sandbox
                         connector)
  --integration <idn>   Integration to search connectors in (default:
                         sandbox, or the scenario's integration)
  --timeout <seconds>   Default per-turn timeout in seconds (default: ${DEFAULT_TIMEOUT_SECONDS}).
                         Precedence: turn timeout > scenario timeout > this
                         flag > ${DEFAULT_TIMEOUT_SECONDS}s
  --json                Output a single JSON result object (implies --quiet)
  --customer <idn>      Customer to run against (default customer if not set)
  --quiet, -q           Minimal output for automation

Scenario file (YAML):
  name: <string>                # optional, defaults to the file basename
  connector: <idn>               # optional; --connector overrides
  integration: <idn>             # optional; --integration overrides
  timeout: <seconds>             # optional scenario-level default
  turns:
    - message: "<user text>"
      timeout: <seconds>         # optional per-turn override
      expect:
        contains: "<text>" | ["<text>", ...]       # AND semantics
        not_contains: "<text>" | ["<text>", ...]
        regex: "<pattern>"                         # JS RegExp, case-sensitive

Behavior:
  On any turn's assertion failure or timeout, the run aborts (fail-fast):
  remaining turns are reported with status "skipped" and are never sent -
  the shared conversation is not trusted to still match the script once it
  has diverged.

Exit codes: 0 every turn passed; 1 any assertion failure, timeout, or setup
error (malformed scenario file, no running connector, auth failure). Setup
errors exit before any turn runs.

Examples:
  newo test scenarios/order-status.yaml
  newo test scenarios/order-status.yaml --connector vibe_agent --timeout 90
  newo test scenarios/order-status.yaml --json > result.json
  # Correlate a failing turn with its logs:
  newo logs --event-id <user_external_event_id>
`);
}
