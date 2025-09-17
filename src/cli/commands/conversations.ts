/**
 * Conversations command handler
 */
import { makeClient } from '../../api.js';
import { pullConversations } from '../../sync/index.js';
import { getValidAccessToken } from '../../auth.js';
import { selectSingleCustomer } from '../customer-selection.js';
import type { MultiCustomerConfig, CliArgs } from '../../types.js';

export async function handleConversationsCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean
): Promise<void> {
  const { selectedCustomer, allCustomers, isMultiCustomer } = selectSingleCustomer(
    customerConfig,
    args.customer as string | undefined
  );

  // Parse conversation-specific options - load all data by default
  const conversationOptions = {
    includeAll: true, // Always include all data for conversations
    maxPersonas: undefined, // No limit on personas
    maxActsPerPersona: undefined // No limit on acts per persona
  };

  if (selectedCustomer) {
    // Single customer conversations
    const accessToken = await getValidAccessToken(selectedCustomer);
    const client = await makeClient(verbose, accessToken);
    console.log(`💬 Pulling conversations for customer: ${selectedCustomer.idn} (all data)`);
    await pullConversations(client, selectedCustomer, conversationOptions, verbose);
    console.log(`✅ Conversations saved to newo_customers/${selectedCustomer.idn}/conversations.yaml`);
  } else if (isMultiCustomer) {
    // Multi-customer conversations
    if (verbose) console.log(`💬 No default customer specified, pulling conversations from all ${allCustomers.length} customers`);
    console.log(`💬 Pulling conversations from ${allCustomers.length} customers (all data)...`);

    for (const customer of allCustomers) {
      console.log(`\n💬 Pulling conversations for customer: ${customer.idn}`);
      const accessToken = await getValidAccessToken(customer);
      const client = await makeClient(verbose, accessToken);
      await pullConversations(client, customer, conversationOptions, verbose);
    }
    console.log(`\n✅ Conversations pull completed for all ${allCustomers.length} customers`);
  }
}