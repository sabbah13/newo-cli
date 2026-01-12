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
 *   newo logs --follow                     # Tail mode (poll for new logs)
 *   newo logs --json                       # Output as JSON
 */

import type { AxiosInstance } from 'axios';
import type { MultiCustomerConfig, LogEntry, LogLevel, LogType, LogsQueryParams, CliArgs } from '../../types.js';
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

  console.log(`📊 Fetching logs for ${selectedCustomer.idn}...`);

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

  const follow = Boolean(args.follow || args.f);
  const asJson = Boolean(args.json);
  const raw = Boolean(args.raw);

  if (follow) {
    await tailLogs(client, params, asJson);
  } else {
    await fetchAndDisplayLogs(client, params, asJson, raw);
  }
}

async function fetchAndDisplayLogs(
  client: AxiosInstance,
  params: LogsQueryParams,
  asJson: boolean,
  raw: boolean
): Promise<void> {
  try {
    const response = await getLogs(client, params);
    const logs = response.items;

    if (asJson) {
      console.log(JSON.stringify(logs, null, 2));
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
      if (raw) {
        console.log(JSON.stringify(log));
      } else {
        console.log(formatLogEntry(log, useColors));
      }
    }

    console.log(`\n✅ Displayed ${logs.length} log entries`);
  } catch (error: unknown) {
    const err = error as { response?: { status?: number; data?: unknown }; message?: string };
    console.error('Failed to fetch logs:', err.response?.status, err.response?.data || err.message);
  }
}

async function tailLogs(
  client: AxiosInstance,
  params: LogsQueryParams,
  asJson: boolean
): Promise<void> {
  console.log('🔄 Watching for new logs (Ctrl+C to stop)...\n');

  const seenLogIds = new Set<string>();
  let lastCheckTime = params.from_datetime || new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const useColors = process.stdout.isTTY !== false;

  // Poll interval (2 seconds)
  const pollInterval = 2000;

  const poll = async () => {
    try {
      const pollParams: LogsQueryParams = {
        ...params,
        from_datetime: lastCheckTime,
        page: 1,
        per: 100
      };

      const response = await getLogs(client, pollParams);
      const logs = response.items;

      // Filter out already seen logs and sort by time
      const newLogs = logs
        .filter(log => !seenLogIds.has(log.log_id))
        .sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());

      for (const log of newLogs) {
        seenLogIds.add(log.log_id);

        if (asJson) {
          console.log(JSON.stringify(log));
        } else {
          console.log(formatLogEntryCompact(log, useColors));
        }

        // Update last check time to the newest log we've seen
        const logTime = new Date(log.datetime);
        const lastTime = new Date(lastCheckTime);
        if (logTime > lastTime) {
          lastCheckTime = log.datetime;
        }
      }
    } catch (error: unknown) {
      // Silently ignore poll errors to avoid spamming the console
    }
  };

  // Initial poll
  await poll();

  // Set up interval for continuous polling
  const intervalId = setInterval(poll, pollInterval);

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    clearInterval(intervalId);
    console.log('\n\n👋 Stopped watching logs');
    process.exit(0);
  });

  // Keep the process running
  await new Promise(() => {});
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
  --event-id <uuid>     Filter by external event ID
  --runtime-id <uuid>   Filter by runtime context ID
  --actor-id <uuid>     Filter by user actor ID
  --persona-id <uuid>   Filter by user persona ID

Output Options:
  --json                Output logs as JSON
  --raw                 Output each log as a single JSON line
  --per <n>             Number of logs per page (default: 50)
  --page <n>            Page number (default: 1)

Live Tailing:
  --follow, -f          Continuously poll for new logs (like tail -f)

Examples:
  newo logs                                    # Last 1 hour of logs
  newo logs --hours 24                         # Last 24 hours
  newo logs --level warning,error              # Warnings and errors only
  newo logs --type call --skill CreateActor    # Skill calls for CreateActor
  newo logs --flow CACreatorFlow --follow      # Tail logs for specific flow
  newo logs --json --per 100                   # Get 100 logs as JSON
`);
}
