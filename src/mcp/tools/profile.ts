/**
 * MCP tool: newo_profile
 *
 * Returns the customer profile from the platform - confirms auth works and
 * shows the customer's identity. Useful as a connectivity smoke test.
 */
import { z } from 'zod';
import { clientFor, toolResult, toolError } from '../context.js';
import { getCustomerProfile } from '../../api.js';

export const profileTool = {
  name: 'newo_profile',
  description:
    'Fetch the NEWO customer profile (id, name, organization). Confirms authentication is working and surfaces the customer\'s platform identity. Useful as a connectivity smoke test before running heavier operations. Read-only.',
  inputSchema: z.object({
    customer_idn: z
      .string()
      .optional()
      .describe('Customer IDN to query. Omit to use the only configured customer or NEWO_DEFAULT_CUSTOMER.'),
  }),
  handler: async (args: { customer_idn?: string }) => {
    try {
      const { customer, client } = await clientFor(args.customer_idn);
      const profile = await getCustomerProfile(client);
      return toolResult(
        `Profile for ${customer.idn}: ${(profile as any).name ?? '(unnamed)'} (id: ${(profile as any).id ?? '?'})`,
        { customer_idn: customer.idn, profile }
      );
    } catch (err) {
      return toolError(
        `Failed to fetch profile: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  },
};
