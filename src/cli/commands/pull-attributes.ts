/**
 * Pull attributes command handler
 */
import { makeClient } from '../../api.js';
import { saveCustomerAttributes } from '../../sync/index.js';
import { getValidAccessToken } from '../../auth.js';
import { requireSingleCustomer } from '../customer-selection.js';
import type { MultiCustomerConfig, CliArgs } from '../../types.js';

export async function handlePullAttributesCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean
): Promise<void> {
  const selectedCustomer = requireSingleCustomer(customerConfig, args.customer as string | undefined);

  const accessToken = await getValidAccessToken(selectedCustomer);
  const client = await makeClient(verbose, accessToken);

  console.log(`🔍 Fetching customer attributes for ${selectedCustomer.idn}...`);
  await saveCustomerAttributes(client, selectedCustomer, verbose);
  console.log(`✅ Customer attributes saved to newo_customers/${selectedCustomer.idn}/attributes.yaml`);
}