/**
 * MCP tool: newo_logs
 *
 * Direct wrapper over `getLogs` (src/api.ts). Same filters as `newo logs` CLI,
 * but returns structured JSON for the model. The model uses this constantly
 * during troubleshoot - especially after `newo_test` returns a
 * `runtime_context_id`.
 *
 * No `--follow` here - tail mode would block the MCP request. For tailing,
 * use repeated calls with the same filters.
 */
import { z } from 'zod';
import { clientFor, toolResult, toolError } from '../context.js';
import { getLogs } from '../../api.js';
import type { LogsQueryParams, LogLevel, LogType } from '../../types.js';

const LogLevelSchema = z.enum(['info', 'warning', 'error']);
const LogTypeSchema = z.enum(['system', 'operation', 'call']);

export const logsTool = {
  name: 'newo_logs',
  description:
    "Fetch NEWO platform analytics logs with rich filters. The killer correlation pattern: pass runtime_context_id (returned by newo_test) to see every action that ran during one specific call. Other filters: hours/from/to (time window), levels, log_types, project_idn, flow_idn, skill_idn, message (substring search), external_event_id, user_actor_ids, user_persona_ids. Returns structured LogEntry array with each entry's level, type, datetime, message, and data { flow_idn, skill_idn, runtime_context_id, line, arguments, ... }. Read-only. Use after a failed test or production incident to walk the call chain.",
  inputSchema: z.object({
    customer_idn: z.string().optional().describe('Customer IDN. Defaults to the only configured customer or NEWO_DEFAULT_CUSTOMER.'),
    runtime_context_id: z.string().optional().describe('Filter to one specific runtime (one call). The most precise filter; use whenever available.'),
    hours: z.number().int().positive().optional().describe('Time window in hours from now. Defaults to 1 if no from/to/runtime_context_id given.'),
    from_datetime: z.string().optional().describe('ISO 8601 start time. Overrides `hours`.'),
    to_datetime: z.string().optional().describe('ISO 8601 end time. Defaults to now.'),
    levels: z.array(LogLevelSchema).optional().describe('Filter by levels (info, warning, error). Multiple = OR.'),
    log_types: z.array(LogTypeSchema).optional().describe('Filter by log types (system, operation, call).'),
    project_idn: z.string().optional(),
    flow_idn: z.string().optional(),
    skill_idn: z.string().optional(),
    external_event_id: z.string().optional().describe('Filter by source event (e.g. webhook delivery).'),
    user_actor_id: z.string().optional().describe('One chat session.'),
    user_persona_id: z.string().optional().describe('One user persona (across multiple chats).'),
    message: z.string().optional().describe('Substring search in log messages.'),
    page: z.number().int().positive().optional().describe('1-based page number. Defaults to 1.'),
    per: z.number().int().positive().max(200).optional().describe('Logs per page (max 200). Defaults to 50.'),
  }),
  handler: async (args: {
    customer_idn?: string;
    runtime_context_id?: string;
    hours?: number;
    from_datetime?: string;
    to_datetime?: string;
    levels?: LogLevel[];
    log_types?: LogType[];
    project_idn?: string;
    flow_idn?: string;
    skill_idn?: string;
    external_event_id?: string;
    user_actor_id?: string;
    user_persona_id?: string;
    message?: string;
    page?: number;
    per?: number;
  }) => {
    try {
      const { customer, client } = await clientFor(args.customer_idn);

      // Apply default 1-hour window only if no time bound + no runtime filter is given.
      // runtime_context_id is naturally bounded so a wide-open query is fine there.
      const now = new Date();
      let from = args.from_datetime;
      let to = args.to_datetime;
      if (!from && !to && !args.runtime_context_id) {
        const hours = args.hours ?? 1;
        from = new Date(now.getTime() - hours * 3600_000).toISOString();
        to = now.toISOString();
      } else if (args.hours && !from) {
        from = new Date(now.getTime() - args.hours * 3600_000).toISOString();
      }

      const params: LogsQueryParams = {
        page: args.page ?? 1,
        per: args.per ?? 50,
      };
      if (from) params.from_datetime = from;
      if (to) params.to_datetime = to;
      if (args.levels?.length) params.levels = args.levels;
      if (args.log_types?.length) params.log_types = args.log_types;
      if (args.project_idn) params.project_idn = args.project_idn;
      if (args.flow_idn) params.flow_idn = args.flow_idn;
      if (args.skill_idn) params.skill_idn = args.skill_idn;
      if (args.external_event_id) params.external_event_id = args.external_event_id;
      if (args.runtime_context_id) params.runtime_context_id = args.runtime_context_id;
      if (args.user_actor_id) params.user_actor_ids = args.user_actor_id;
      if (args.user_persona_id) params.user_persona_ids = args.user_persona_id;
      if (args.message) params.message = args.message;

      const response = await getLogs(client, params);
      const items = response.items;

      // Build a one-line summary by level.
      const byLevel = items.reduce(
        (acc, e) => {
          acc[e.level] = (acc[e.level] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );
      const breakdown = Object.entries(byLevel)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ');

      const summary =
        items.length === 0
          ? `No log entries matched filters for ${customer.idn}.`
          : `${items.length} log entries for ${customer.idn}: ${breakdown || '(no level breakdown)'}.`;

      return toolResult(summary, {
        customer_idn: customer.idn,
        params,
        count: items.length,
        items,
      });
    } catch (err) {
      return toolError(`Failed to fetch logs: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};
