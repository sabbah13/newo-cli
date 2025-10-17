/**
 * Pull integrations command handler
 * Downloads all integrations and connectors from NEWO platform
 */
import path from 'path';
import { makeClient } from '../../api.js';
import { pullIntegrations } from '../../sync/integrations.js';
import { getValidAccessToken } from '../../auth.js';
import { requireSingleCustomer } from '../customer-selection.js';
import type { MultiCustomerConfig, CliArgs } from '../../types.js';

export async function handlePullIntegrationsCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean
): Promise<void> {
  const selectedCustomer = requireSingleCustomer(customerConfig, args.customer as string | undefined);

  const accessToken = await getValidAccessToken(selectedCustomer);
  const client = await makeClient(verbose, accessToken);

  const customerDir = path.join(process.cwd(), 'newo_customers', selectedCustomer.idn);

  console.log(`📦 Fetching integrations for ${selectedCustomer.idn}...`);
  await pullIntegrations(client, customerDir, verbose);
  console.log(`✅ Integrations saved to newo_customers/${selectedCustomer.idn}/integrations/`);
}
