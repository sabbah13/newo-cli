/**
 * MCP tool: newo_list_actions
 *
 * Returns the full NSL/Jinja action catalog from the platform - what actions
 * exist, what parameters they take. Used by the model when authoring or
 * reviewing NSL/Jinja skills to confirm an action exists with the expected
 * shape.
 */
import { z } from 'zod';
import { clientFor, toolResult, toolError } from '../context.js';

export const listActionsTool = {
  name: 'newo_list_actions',
  description:
    'List the full NEWO NSL/Jinja action catalog (Send, LLM, Set, Persona, Tool, etc.) with their parameters. Read-only. Use this when authoring or reviewing NSL skills to confirm an action exists with the expected parameter shape - never guess action names.',
  inputSchema: z.object({
    customer_idn: z
      .string()
      .optional()
      .describe('Customer IDN to query. Action catalog is per-customer (varies with installed integrations).'),
  }),
  handler: async (args: { customer_idn?: string }) => {
    try {
      const { customer, client } = await clientFor(args.customer_idn);
      const response = await client.get('/api/v1/script/actions');
      const actions = response.data;

      const count = Array.isArray(actions) ? actions.length : 0;
      const summary = `${count} action(s) available for customer ${customer.idn}`;

      return toolResult(summary, { customer_idn: customer.idn, actions });
    } catch (err) {
      return toolError(
        `Failed to list actions: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  },
};
