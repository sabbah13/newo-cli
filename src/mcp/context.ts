/**
 * Shared context for MCP tools.
 *
 * Tools need three things consistently:
 *   1. The customer configuration (single or multi)
 *   2. A way to resolve "which customer does this call target?"
 *   3. An authenticated Axios client for that customer
 *
 * This module centralizes those concerns so each tool stays focused on its
 * own logic.
 *
 * IMPORTANT: All log output here goes to stderr (`console.error`). The MCP
 * stdio transport reserves stdout for JSON-RPC frames; anything written to
 * stdout corrupts the protocol. Treat `console.log` as forbidden in the MCP
 * server runtime.
 */
import type { AxiosInstance } from 'axios';
import { ENV, initializeEnvironment } from '../env.js';
import { parseAndValidateCustomerConfig } from '../cli/customer-selection.js';
import { getValidAccessToken } from '../auth.js';
import { makeClient } from '../api.js';
import type { MultiCustomerConfig, CustomerConfig } from '../types.js';

let cachedCustomerConfig: MultiCustomerConfig | null = null;

/**
 * Load and cache the customer config. Initialized lazily on the first tool
 * invocation so the server can boot even if env validation would fail (e.g.
 * during `newo mcp serve --check`).
 */
export async function getCustomerConfig(): Promise<MultiCustomerConfig> {
  if (cachedCustomerConfig) return cachedCustomerConfig;

  // Force quiet mode so the env layer doesn't print to stdout.
  process.env.NEWO_QUIET_MODE = 'true';

  initializeEnvironment();
  cachedCustomerConfig = await parseAndValidateCustomerConfig(ENV as any, false);
  return cachedCustomerConfig;
}

/**
 * Resolve which customer this tool call targets.
 *
 * Resolution rules:
 *   1. If `customer_idn` arg passed -> use it (error if not configured)
 *   2. Else if there's exactly one configured customer -> use it
 *   3. Else if there's a default customer (NEWO_DEFAULT_CUSTOMER) -> use it
 *   4. Else error - the tool must require an explicit customer arg
 */
export async function resolveCustomer(customerIdn?: string): Promise<CustomerConfig> {
  const config = await getCustomerConfig();
  const idns = Object.keys(config.customers);

  if (customerIdn) {
    const customer = config.customers[customerIdn];
    if (!customer) {
      throw new Error(
        `Customer "${customerIdn}" not configured. Available: ${idns.join(', ') || '(none)'}`
      );
    }
    return customer;
  }

  if (idns.length === 0) {
    throw new Error(
      'No customers configured. Set NEWO_CUSTOMER_IDN or NEWO_CUSTOMERS in your .env.'
    );
  }

  if (idns.length === 1) {
    return config.customers[idns[0]!]!;
  }

  if (config.defaultCustomer && config.customers[config.defaultCustomer]) {
    return config.customers[config.defaultCustomer]!;
  }

  throw new Error(
    `Multiple customers configured (${idns.join(', ')}). Pass customer_idn explicitly or set NEWO_DEFAULT_CUSTOMER.`
  );
}

/**
 * Build an authenticated Axios client for the given customer.
 *
 * Token refresh is handled inside `getValidAccessToken` via the existing CLI
 * auth flow. The client returned has the access token set as a Bearer header.
 */
export async function authClient(customer: CustomerConfig): Promise<AxiosInstance> {
  const token = await getValidAccessToken(customer);
  return makeClient(false, token);
}

/**
 * Convenience: resolve customer + build client in one call.
 */
export async function clientFor(customerIdn?: string): Promise<{
  customer: CustomerConfig;
  client: AxiosInstance;
}> {
  const customer = await resolveCustomer(customerIdn);
  const client = await authClient(customer);
  return { customer, client };
}

/**
 * Format a tool error in the conventional MCP shape.
 *
 * The SDK lets us either throw (treated as protocol error) or return
 * `{ isError: true, content: [...] }` (treated as tool-level error visible to
 * the model). We use the latter so the model can see the failure message and
 * react.
 */
export function toolError(message: string): {
  isError: true;
  content: Array<{ type: 'text'; text: string }>;
} {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

/**
 * Format a successful tool result with structured data + a one-line summary.
 *
 * Returning structured data via `structuredContent` lets MCP clients reason
 * about the data programmatically. The text summary is the human-readable
 * version surfaced to the model.
 */
export function toolResult(summary: string, structured?: unknown): {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: unknown;
} {
  const result: ReturnType<typeof toolResult> = {
    content: [{ type: 'text', text: summary }],
  };
  if (structured !== undefined) {
    result.structuredContent = structured as Record<string, unknown>;
  }
  return result;
}
