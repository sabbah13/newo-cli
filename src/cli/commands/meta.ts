/**
 * Meta command handler - get project metadata
 */
import { makeClient, getProjectMeta } from '../../api.js';
import { getValidAccessToken } from '../../auth.js';
import { requireSingleCustomer } from '../customer-selection.js';
import type { MultiCustomerConfig, CliArgs } from '../../types.js';

export async function handleMetaCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean
): Promise<void> {
  const selectedCustomer = requireSingleCustomer(customerConfig, args.customer as string | undefined);

  if (!selectedCustomer.projectId) {
    console.error(`No project ID configured for customer ${selectedCustomer.idn}`);
    console.error(`Set NEWO_CUSTOMER_${selectedCustomer.idn.toUpperCase()}_PROJECT_ID in your .env file`);
    process.exit(1);
  }

  const accessToken = await getValidAccessToken(selectedCustomer);
  const client = await makeClient(verbose, accessToken);
  const meta = await getProjectMeta(client, selectedCustomer.projectId);
  console.log(JSON.stringify(meta, null, 2));
}