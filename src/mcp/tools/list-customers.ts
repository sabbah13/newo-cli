/**
 * MCP tool: newo_list_customers
 *
 * Returns all NEWO customers configured in the user's environment. No API
 * call - reads from the local customer config (env vars / .env). Useful as a
 * first step in any MCP session so the model knows what customer scopes are
 * available before calling other tools.
 */
import { z } from 'zod';
import { getCustomerConfig, toolResult, toolError } from '../context.js';

export const listCustomersTool = {
  name: 'newo_list_customers',
  description:
    'List all NEWO customers configured in the local environment. Returns each customer\'s idn, base URL, and whether it has an API key. Read-only; no platform call. Use this as a first step to discover what customer scopes are available before calling other tools.',
  inputSchema: z.object({}),
  handler: async (_args: Record<string, never>) => {
    try {
      const config = await getCustomerConfig();
      const customers = Object.entries(config.customers).map(([idn, cust]) => ({
        idn,
        has_api_key: Boolean(cust.apiKey),
        project_id: cust.projectId ?? null,
        is_default: idn === config.defaultCustomer,
      }));

      const summary =
        customers.length === 0
          ? 'No customers configured. Set NEWO_CUSTOMER_IDN or NEWO_CUSTOMERS in your .env file.'
          : `${customers.length} customer(s) configured: ${customers.map((c) => c.idn + (c.is_default ? ' (default)' : '')).join(', ')}`;

      return toolResult(summary, { customers });
    } catch (err) {
      return toolError(`Failed to list customers: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};
