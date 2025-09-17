/**
 * Pull command handler
 */
import { makeClient } from '../../api.js';
import { pullAll } from '../../sync/index.js';
import { getValidAccessToken } from '../../auth.js';
import { selectSingleCustomer } from '../customer-selection.js';
import type { MultiCustomerConfig, CliArgs } from '../../types.js';

export async function handlePullCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean
): Promise<void> {
  const { selectedCustomer, allCustomers, isMultiCustomer } = selectSingleCustomer(
    customerConfig,
    args.customer as string | undefined
  );

  if (selectedCustomer) {
    // Single customer pull
    const accessToken = await getValidAccessToken(selectedCustomer);
    const client = await makeClient(verbose, accessToken);
    const projectId = selectedCustomer.projectId || null;
    await pullAll(client, selectedCustomer, projectId, verbose);
  } else if (isMultiCustomer) {
    // Multi-customer pull
    if (verbose) console.log(`📥 No default customer specified, pulling from all ${allCustomers.length} customers`);
    console.log(`🔄 Pulling from ${allCustomers.length} customers...`);

    for (const customer of allCustomers) {
      console.log(`\n📥 Pulling from customer: ${customer.idn}`);
      const accessToken = await getValidAccessToken(customer);
      const client = await makeClient(verbose, accessToken);
      const projectId = customer.projectId || null;
      await pullAll(client, customer, projectId, verbose);
    }
    console.log(`\n✅ Pull completed for all ${allCustomers.length} customers`);
  }
}