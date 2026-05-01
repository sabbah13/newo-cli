/**
 * Aggregate every MCP tool exposed by the NEWO server.
 *
 * Add a tool here once and the server picks it up automatically.
 */
import { listCustomersTool } from './list-customers.js';
import { profileTool } from './profile.js';
import { listActionsTool } from './list-actions.js';
import { logsTool } from './logs.js';
import { testTool } from './test.js';
import { statusTool } from './status.js';

export const ALL_TOOLS = [
  listCustomersTool,
  profileTool,
  listActionsTool,
  logsTool,
  testTool,
  statusTool,
] as const;

export type Tool = (typeof ALL_TOOLS)[number];
