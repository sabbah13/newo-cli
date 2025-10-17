/**
 * Push AKB command handler
 * Uploads AKB (knowledge base) articles to NEWO platform
 */
import path from 'path';
import { makeClient } from '../../api.js';
import { pushAkb } from '../../sync/akb.js';
import { getValidAccessToken } from '../../auth.js';
import { requireSingleCustomer } from '../customer-selection.js';
import type { MultiCustomerConfig, CliArgs } from '../../types.js';

export async function handlePushAkbCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean
): Promise<void> {
  const selectedCustomer = requireSingleCustomer(customerConfig, args.customer as string | undefined);

  const accessToken = await getValidAccessToken(selectedCustomer);
  const client = await makeClient(verbose, accessToken);

  const customerDir = path.join(process.cwd(), 'newo_customers', selectedCustomer.idn);

  console.log(`📤 Pushing AKB articles for ${selectedCustomer.idn}...`);
  await pushAkb(client, customerDir, verbose);
  console.log(`✅ AKB articles pushed successfully`);
}
