/**
 * Logs command - Fetch and display analytics logs from NEWO platform
 *
 * Usage:
 *   newo logs                              # Last 1 hour of logs
 *   newo logs --hours 24                   # Last 24 hours
 *   newo logs --from "2026-01-11T00:00:00Z" --to "2026-01-12T00:00:00Z"
 *   newo logs --level warning              # Only warnings
 *   newo logs --type call                  # Only skill calls
 *   newo logs --flow CACreatorFlow         # Filter by flow
 *   newo logs --skill CreateActor          # Filter by skill
 *   newo logs --agent-persona-id <uuid>    # Filter by agent persona
 *   newo logs --follow                     # Tail mode (poll for new logs)
 *   newo logs --json                       # Output as JSON
 */

import type { AxiosInstance } from 'axios';
import type { MultiCustomerConfig, LogEntry, LogLevel, LogType, LogsQueryParams, LogsResponse, CliArgs } from '../../types.js';
import { makeClient, getLogs } from '../../api.js';
import { getValidAccessToken } from '../../auth.js';
import { requireSingleCustomer } from '../customer-selection.js';

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  magenta: '\x1b[35m',
  white: '\x1b[37m',
  gray: '\x1b[90m'
};

type GetLogsFn = (client: AxiosInstance, params: LogsQueryParams) => Promise<LogsResponse>;

function getLevelColor(level: LogLevel): string {
  switch (level) {
    case 'error': return colors.red;
    case 'warning': return colors.yellow;
    case 'info': return colors.blue;
    default: return colors.white;
  }
}

function getTypeColor(type: LogType): string {
  switch (type) {
    case 'call': return colors.cyan;
    case 'operation': return colors.magenta;
    case 'system': return colors.green;
    default: return colors.white;
  }
}

function formatLogEntry(log: LogEntry, showColors: boolean = true): string {
  const c = showColors ? colors : { reset: '', dim: '', red: '', yellow: '', blue: '', cyan: '', green: '', magenta: '', white: '', gray: '' };

  // Format datetime
  const date = new Date(log.datetime);
  const timeStr = date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const msStr = String(date.getMilliseconds()).padStart(3, '0');
  const dateTimeFormatted = `${c.dim}${timeStr}.${msStr}${c.reset}`;

  // Format level with color
  const levelColor = showColors ? getLevelColor(log.level) : '';
  const levelStr = `${levelColor}${log.level.toUpperCase().padEnd(7)}${c.reset}`;

  // Format type with color
  const typeColor = showColors ? getTypeColor(log.log_type) : '';
  const typeStr = `${typeColor}${log.log_type.padEnd(9)}${c.reset}`;

  // Build context string from data
  const contextParts: string[] = [];
  if (log.data.flow_idn) contextParts.push(`${c.cyan}[${log.data.flow_idn}]${c.reset}`);
  if (log.data.skill_idn) contextParts.push(`${c.green}[${log.data.skill_idn}]${c.reset}`);
  if (log.data.line !== undefined) contextParts.push(`${c.dim}:${log.data.line}${c.reset}`);
  if (log.data.integration_idn && log.data.connector_idn) {
    contextParts.push(`${c.magenta}${log.data.integration_idn}/${log.data.connector_idn}${c.reset}`);
  }

  const contextStr = contextParts.length > 0 ? ` ${contextParts.join(' ')}` : '';

  // Format message
  const messageStr = log.message;

  return `${dateTimeFormatted} ${levelStr} ${typeStr}${contextStr} ${messageStr}`;
}

function formatLogEntryCompact(log: LogEntry, showColors: boolean = true): string {
  const c = showColors ? colors : { reset: '', dim: '', red: '', yellow: '', blue: '', cyan: '', green: '', magenta: '', white: '', gray: '' };

  // Shorter format for tail mode
  const date = new Date(log.datetime);
  const timeStr = date.toLocaleTimeString('en-US', { hour12: false });

  const levelColor = showColors ? getLevelColor(log.level) : '';
  const levelIcon = log.level === 'error' ? '✗' : log.level === 'warning' ? '⚠' : '•';

  return `${c.dim}${timeStr}${c.reset} ${levelColor}${levelIcon}${c.reset} ${log.message}`;
}

export async function handleLogsCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean
): Promise<void> {
  // Select customer
  const selectedCustomer = requireSingleCustomer(customerConfig, args.customer as string | undefined);

  // Keep stdout machine-readable when JSON output is requested (for piping to jq etc.)
  const machineOutput = Boolean(args.json || args.raw);
  if (machineOutput) {
    process.env.NEWO_QUIET_MODE = 'true'; // suppress auth logging on stdout
  } else {
    console.log(`📊 Fetching logs for ${selectedCustomer.idn}...`);
  }

  // Get access token and create client
  const token = await getValidAccessToken(selectedCustomer);
  const client = await makeClient(verbose, token);

  // Build query params
  const params: LogsQueryParams = {
    page: args.page ? parseInt(String(args.page), 10) : 1,
    per: args.per ? parseInt(String(args.per), 10) : 50
  };

  // Time range
  if (args.from) {
    params.from_datetime = String(args.from);
  } else {
    // Default to last N hours (default 1 hour)
    const hoursAgo = args.hours ? parseInt(String(args.hours), 10) : 1;
    params.from_datetime = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
  }

  if (args.to) {
    params.to_datetime = String(args.to);
  }

  // Filters
  if (args.level) {
    const levelStr = String(args.level);
    const levels = levelStr.split(',') as LogLevel[];
    if (levels.length === 1 && levels[0]) {
      params.levels = levels[0];
    } else if (levels.length > 1) {
      params.levels = levels;
    }
  }

  if (args.type) {
    const typeStr = String(args.type);
    const types = typeStr.split(',') as LogType[];
    if (types.length === 1 && types[0]) {
      params.log_types = types[0];
    } else if (types.length > 1) {
      params.log_types = types;
    }
  }

  if (args.project) params.project_idn = String(args.project);
  if (args.flow) params.flow_idn = String(args.flow);
  if (args.skill) params.skill_idn = String(args.skill);
  if (args.message) params.message = String(args.message);
  if (args['event-id']) params.external_event_id = String(args['event-id']);
  if (args['runtime-id']) params.runtime_context_id = String(args['runtime-id']);
  if (args['actor-id']) params.user_actor_ids = String(args['actor-id']);
  if (args['persona-id']) params.user_persona_ids = String(args['persona-id']);
  if (args['agent-persona-id']) params.agent_persona_ids = String(args['agent-persona-id']);

  const follow = Boolean(args.follow || args.f);
  const asJson = Boolean(args.json);
  const raw = Boolean(args.raw);
  // --name filters by data.name (e.g. action name like Gen or GetMemory).
  // The API has no such query param, so it is applied client-side.
  const nameFilter = args.name ? String(args.name) : null;
  // --max caps total entries fetched across pages. --for / --max-events
  // bound --follow so an autonomous run terminates on its own.
  const maxItems = args.max ? parseInt(String(args.max), 10) : undefined;
  const forSec = args.for ? parseInt(String(args.for), 10) : undefined;
  const maxEvents = args['max-events'] ? parseInt(String(args['max-events']), 10) : undefined;

  if (follow) {
    await tailLogs(client, params, asJson, nameFilter, {
      ...(forSec && forSec > 0 ? { forMs: forSec * 1000 } : {}),
      ...(maxEvents && maxEvents > 0 ? { maxEvents } : {})
    });
  } else {
    await fetchAndDisplayLogs(client, params, asJson, raw, nameFilter, getLogs, maxItems);
  }
}

function filterByName(logs: readonly LogEntry[], nameFilter: string | null): LogEntry[] {
  if (!nameFilter) return [...logs];
  return logs.filter(log => log.data['name'] === nameFilter);
}

// Default total-entry budget when --max is not given. Before this, a query
// without --name fetched exactly one page, so --per/--hours silently
// dropped everything past the first page. We now paginate by default but cap
// the pull so a broad query on a busy customer can't run away.
const DEFAULT_MAX_ENTRIES = 1000;

export async function collectLogsForDisplay(
  client: AxiosInstance,
  params: LogsQueryParams,
  nameFilter: string | null = null,
  getLogsFn: GetLogsFn = getLogs,
  maxItems?: number
): Promise<LogEntry[]> {
  const pageSize = Number.isFinite(params.per) && params.per && params.per > 0 ? params.per : 50;
  let page = Number.isFinite(params.page) && params.page && params.page > 0 ? params.page : 1;
  const budget = maxItems && maxItems > 0 ? maxItems : DEFAULT_MAX_ENTRIES;
  const logs: LogEntry[] = [];

  // Always paginate. The name filter is applied per page and is a no-op when
  // null, so this path now serves both filtered and unfiltered queries. Stop at
  // a short page (end of data) or once the budget is reached.
  while (true) {
    const response = await getLogsFn(client, {
      ...params,
      page,
      per: pageSize
    });

    logs.push(...filterByName(response.items, nameFilter));

    if (logs.length >= budget) {
      return logs.slice(0, budget);
    }
    if (response.items.length < pageSize) {
      break;
    }

    page++;
  }

  return logs;
}

export async function fetchAndDisplayLogs(
  client: AxiosInstance,
  params: LogsQueryParams,
  asJson: boolean,
  raw: boolean,
  nameFilter: string | null = null,
  getLogsFn: GetLogsFn = getLogs,
  maxItems?: number
): Promise<void> {
  try {
    const logs = await collectLogsForDisplay(client, params, nameFilter, getLogsFn, maxItems);

    // The API returns pages within the requested window in an order this CLI does not
    // control; on a busy window that order can bias toward one end (proven live: a
    // --hours 1 pull on an account whose only activity was one ~6-minute call returned
    // exactly the budget's worth of entries, and every one of them was from the call's
    // last ~2 minutes — the earlier, equally real majority of the call was silently
    // absent, with no error and a plausible-looking non-empty result). Hitting the budget
    // exactly is the only client-visible signal that this happened; surface it on stderr
    // so --raw/--json's stdout contract stays untouched.
    const budget = maxItems && maxItems > 0 ? maxItems : DEFAULT_MAX_ENTRIES;
    if (logs.length >= budget) {
      console.error(
        `⚠️  Hit the ${budget}-entry fetch budget — this window may be truncated and is not ` +
        `guaranteed to cover the full requested range. Narrow --hours/--from/--to, raise --max, ` +
        `or if you have a session id, prefer \`newo session <id> --full\` (session-scoped, and its ` +
        `own \`partial\`/\`total_log_entries\` fields make truncation visible).`
      );
    }

    if (asJson) {
      console.log(JSON.stringify(logs, null, 2));
      return;
    }

    // --raw is a machine-readable JSONL contract: stdout must contain only
    // one JSON object per log line, with no banners or empty-result text.
    if (raw) {
      const sortedLogs = [...logs].sort((a, b) =>
        new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
      );
      for (const log of sortedLogs) {
        console.log(JSON.stringify(log));
      }
      return;
    }

    if (logs.length === 0) {
      console.log('\nNo logs found for the specified criteria.');
      return;
    }

    console.log(`\n📝 Found ${logs.length} log entries:\n`);

    // Sort by datetime ascending (oldest first)
    const sortedLogs = [...logs].sort((a, b) =>
      new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
    );

    // Detect if stdout is a TTY (supports colors)
    const useColors = process.stdout.isTTY !== false;

    for (const log of sortedLogs) {
      console.log(formatLogEntry(log, useColors));
    }

    console.log(`\n✅ Displayed ${logs.length} log entries`);
  } catch (error: unknown) {
    const err = error as { response?: { status?: number; data?: unknown }; message?: string };
    console.error('Failed to fetch logs:', err.response?.status, err.response?.data || err.message);
  }
}

export interface TailOptions {
  /** Stop after this many milliseconds (bound --follow). */
  forMs?: number;
  /** Stop after emitting this many new events. */
  maxEvents?: number;
  /** Poll cadence; defaults to 2000ms. Lowered in tests. */
  pollIntervalMs?: number;
  /** Injected for tests. */
  getLogsFn?: GetLogsFn;
}

export async function tailLogs(
  client: AxiosInstance,
  params: LogsQueryParams,
  asJson: boolean,
  nameFilter: string | null = null,
  opts: TailOptions = {}
): Promise<void> {
  const getLogsFn = opts.getLogsFn ?? getLogs;
  const pollInterval = opts.pollIntervalMs ?? 2000;

  console.log('🔄 Watching for new logs (Ctrl+C to stop)...\n');

  const seenLogIds = new Set<string>();
  let lastCheckTime = params.from_datetime || new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const useColors = process.stdout.isTTY !== false;
  let emitted = 0;

  // Resolve on: --for elapsed, --max-events reached, or SIGINT. Without any
  // bound this still tails forever (interactive UX), but autonomous callers can
  // now pass --for/--max-events so the process exits on its own.
  await new Promise<void>((resolve) => {
    let finished = false;
    let intervalId: ReturnType<typeof setInterval> | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const finish = () => {
      if (finished) return;
      finished = true;
      if (intervalId) clearInterval(intervalId);
      if (timeoutId) clearTimeout(timeoutId);
      process.removeListener('SIGINT', onSigint);
      resolve();
    };

    const poll = async () => {
      try {
        const pollParams: LogsQueryParams = {
          ...params,
          from_datetime: lastCheckTime,
          page: 1,
          per: 100
        };

        const response = await getLogsFn(client, pollParams);
        const logs = filterByName(response.items, nameFilter);

        const newLogs = logs
          .filter(log => !seenLogIds.has(log.log_id))
          .sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());

        for (const log of newLogs) {
          if (finished) break;
          seenLogIds.add(log.log_id);

          if (asJson) {
            console.log(JSON.stringify(log));
          } else {
            console.log(formatLogEntryCompact(log, useColors));
          }

          const logTime = new Date(log.datetime);
          const lastTime = new Date(lastCheckTime);
          if (logTime > lastTime) {
            lastCheckTime = log.datetime;
          }

          emitted++;
          if (opts.maxEvents && emitted >= opts.maxEvents) {
            finish();
            return;
          }
        }
      } catch {
        // Silently ignore poll errors to avoid spamming the console.
      }
    };

    const onSigint = () => {
      console.log('\n\n👋 Stopped watching logs');
      finish();
    };
    process.on('SIGINT', onSigint);

    if (opts.forMs && opts.forMs > 0) {
      timeoutId = setTimeout(finish, opts.forMs);
    }

    void poll().then(() => {
      if (!finished) intervalId = setInterval(poll, pollInterval);
    });
  });
}

export function printLogsHelp(): void {
  console.log(`
Usage: newo logs [options]

Fetch and display analytics logs from the NEWO platform.

Time Range Options:
  --hours <n>           Show logs from last N hours (default: 1)
  --from <datetime>     Start datetime (ISO format, e.g., 2026-01-11T00:00:00Z)
  --to <datetime>       End datetime (ISO format)

Filter Options:
  --level <levels>      Filter by log level: info, warning, error (comma-separated)
  --type <types>        Filter by log type: system, operation, call (comma-separated)
  --project <idn>       Filter by project IDN
  --flow <idn>          Filter by flow IDN
  --skill <idn>         Filter by skill IDN
  --message <text>      Search in log messages
  --name <ActionName>   Filter by action name in data.name, e.g. Gen, GetMemory (client-side)
  --event-id <uuid>           Filter by external event ID
  --runtime-id <uuid>         Filter by runtime context ID
  --actor-id <uuid>           Filter by user actor ID
  --persona-id <uuid>         Filter by user persona ID
  --agent-persona-id <uuid>   Filter by agent persona ID

Output Options:
  --json                Output logs as JSON
  --raw                 Output each log as a single JSON line
  --per <n>             Number of logs per page (default: 50)
  --page <n>            Page number (default: 1)
  --max <n>             Max total entries to fetch across pages (default: 1000).
                        Without this, results paginate to the end of data or the
                        default budget — older queries stopped after one page.
                        Hitting the budget prints a stderr warning: the returned
                        window may be truncated (the API's page order within a
                        busy window is not controlled by this CLI). Prefer
                        \`newo session <id> --full\` when a session id is known.

Live Tailing:
  --follow, -f          Continuously poll for new logs (like tail -f)
  --for <seconds>       With --follow: stop after N seconds (for scripts/CI)
  --max-events <n>      With --follow: stop after N new events seen

Examples:
  newo logs                                    # Last 1 hour of logs
  newo logs --hours 24                         # Last 24 hours
  newo logs --level warning,error              # Warnings and errors only
  newo logs --type call --skill CreateActor    # Skill calls for CreateActor
  newo logs --flow CACreatorFlow --follow      # Tail logs for specific flow
  newo logs --json --per 100                   # Get 100 logs as JSON
  newo logs --type call --name Gen --json      # Only Gen action calls
  newo logs --agent-persona-id <uuid>          # Logs for one agent persona

Notes:
  The model used for a turn is in data.source.model of the --json output —
  do NOT infer it from actor/agent names.
  external_event_id (newo sandbox --json) correlates a chat turn with its
  logs: newo logs --event-id <id>
`);
}
