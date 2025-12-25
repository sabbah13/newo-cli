/**
 * List Registries Command Handler - Lists available project registries
 */
import { makeClient, listRegistries } from '../../api.js';
import { getValidAccessToken } from '../../auth.js';
import { requireSingleCustomer } from '../customer-selection.js';
import type { MultiCustomerConfig, CliArgs } from '../../types.js';

export async function handleListRegistriesCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean = false
): Promise<void> {
  try {
    const selectedCustomer = requireSingleCustomer(customerConfig, args.customer as string | undefined);

    if (verbose) {
      console.log(`📋 Fetching registries for customer: ${selectedCustomer.idn}`);
    }

    // Get access token and create client
    const accessToken = await getValidAccessToken(selectedCustomer);
    const client = await makeClient(verbose, accessToken);

    console.log('🔍 Fetching available project registries...\n');

    const registries = await listRegistries(client);

    if (registries.length === 0) {
      console.log('No registries found.');
      return;
    }

    console.log(`✅ Found ${registries.length} registries:\n`);

    // Display registries in a table-like format
    console.log('  IDN                     │ Public │ ID');
    console.log('  ────────────────────────┼────────┼────────────────────────────────────');

    for (const registry of registries) {
      const publicStatus = registry.is_public ? 'Yes' : 'No';
      const idnPadded = registry.idn.padEnd(22);
      const publicPadded = publicStatus.padEnd(6);
      console.log(`  ${idnPadded} │ ${publicPadded} │ ${registry.id}`);
    }

    console.log('\n💡 Use "newo list-registry-items <registry-idn>" to see available projects in a registry');

  } catch (error: unknown) {
    console.error('❌ Failed to list registries:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
