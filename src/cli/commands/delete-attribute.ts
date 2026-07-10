/**
 * Delete Customer Attribute Command Handler
 */
import { makeClient, getCustomerAttributes, deleteCustomerAttribute } from '../../api.js';
import { getValidAccessToken } from '../../auth.js';
import { requireSingleCustomer } from '../customer-selection.js';
import type { MultiCustomerConfig, CliArgs, CustomerAttribute } from '../../types.js';

export async function handleDeleteAttributeCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean = false
): Promise<void> {
  try {
    const selectedCustomer = requireSingleCustomer(customerConfig, args.customer as string | undefined);

    const idn = args._[1] as string;
    const confirm = args.confirm || args.y;

    if (!idn) {
      console.error('Error: Attribute IDN is required');
      console.error('Usage: newo delete-attribute <idn> [--confirm]');
      process.exit(1);
    }

    const accessToken = await getValidAccessToken(selectedCustomer);
    const client = await makeClient(verbose, accessToken);

    const response = await getCustomerAttributes(client, true);
    const existing = response.attributes.find((a: CustomerAttribute) => a.idn === idn);

    if (!existing) {
      console.error(`❌ Attribute '${idn}' not found.`);
      process.exit(1);
    }

    if (!existing.id) {
      console.error(`❌ Attribute '${idn}' has no ID. Cannot delete.`);
      process.exit(1);
    }

    if (!confirm) {
      console.log(`⚠️  This will permanently delete customer attribute '${idn}' from the NEWO platform.`);
      console.log('⚠️  Use --confirm flag to proceed with deletion.');
      process.exit(1);
    }

    await deleteCustomerAttribute(client, existing.id);

    console.log(`✅ Customer attribute deleted from platform: ${idn}`);
  } catch (error: unknown) {
    console.error('❌ Failed to delete customer attribute:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
