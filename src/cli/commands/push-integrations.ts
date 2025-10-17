/**
 * Push integrations command handler
 * Uploads integration and connector changes to NEWO platform
 */
import path from 'path';
import { makeClient } from '../../api.js';
import { pushIntegrations } from '../../sync/integrations.js';
import { getValidAccessToken } from '../../auth.js';
import { requireSingleCustomer } from '../customer-selection.js';
import type { MultiCustomerConfig, CliArgs } from '../../types.js';

export async function handlePushIntegrationsCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean
): Promise<void> {
  const selectedCustomer = requireSingleCustomer(customerConfig, args.customer as string | undefined);

  const accessToken = await getValidAccessToken(selectedCustomer);
  const client = await makeClient(verbose, accessToken);

  const customerDir = path.join(process.cwd(), 'newo_customers', selectedCustomer.idn);

  console.log(`📤 Pushing integration changes for ${selectedCustomer.idn}...`);
  await pushIntegrations(client, customerDir, verbose);
  console.log(`✅ Integration changes pushed successfully`);
}
