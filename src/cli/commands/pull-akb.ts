/**
 * Pull AKB command handler
 * Downloads AKB (knowledge base) articles for all personas linked to agents
 */
import path from 'path';
import { makeClient } from '../../api.js';
import { pullAkb } from '../../sync/akb.js';
import { getValidAccessToken } from '../../auth.js';
import { requireSingleCustomer } from '../customer-selection.js';
import type { MultiCustomerConfig, CliArgs } from '../../types.js';

export async function handlePullAkbCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean
): Promise<void> {
  const selectedCustomer = requireSingleCustomer(customerConfig, args.customer as string | undefined);

  const accessToken = await getValidAccessToken(selectedCustomer);
  const client = await makeClient(verbose, accessToken);

  const customerDir = path.join(process.cwd(), 'newo_customers', selectedCustomer.idn);

  console.log(`📚 Fetching AKB articles for ${selectedCustomer.idn}...`);
  await pullAkb(client, customerDir, verbose);
  console.log(`✅ AKB articles saved to newo_customers/${selectedCustomer.idn}/akb/`);
}
