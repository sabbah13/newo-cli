/**
 * Update Customer Attribute Command Handler
 */
import { makeClient, getCustomerAttributes, updateCustomerAttribute } from '../../api.js';
import { getValidAccessToken } from '../../auth.js';
import { requireSingleCustomer } from '../customer-selection.js';
import type { MultiCustomerConfig, CliArgs, CustomerAttribute } from '../../types.js';

export async function handleUpdateAttributeCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean = false
): Promise<void> {
  try {
    const selectedCustomer = requireSingleCustomer(customerConfig, args.customer as string | undefined);

    // Parse arguments
    const idn = args._[1] as string;

    if (!idn) {
      console.error('Error: Attribute IDN is required');
      console.error('Usage: newo update-attribute <idn> [--value <value>] [--title <title>] [--description <desc>] [--group <group>] [--hidden] [--value-type <type>] [--possible-values <val1,val2>]');
      process.exit(1);
    }

    // Get access token and create client
    const accessToken = await getValidAccessToken(selectedCustomer);
    const client = await makeClient(verbose, accessToken);

    // Fetch existing attributes to find the one to update
    const response = await getCustomerAttributes(client, true);
    const existing = response.attributes.find((a: CustomerAttribute) => a.idn === idn);

    if (!existing) {
      console.error(`❌ Attribute '${idn}' not found. Use 'newo create-attribute' to create it.`);
      process.exit(1);
    }

    if (!existing.id) {
      console.error(`❌ Attribute '${idn}' has no ID. Cannot update.`);
      process.exit(1);
    }

    // Build updated attribute - only override fields that were explicitly provided
    const updated: CustomerAttribute = {
      id: existing.id,
      idn: existing.idn,
      value: args.value !== undefined ? String(args.value) : existing.value,
      title: (args.title as string) || existing.title,
      description: (args.description as string) || existing.description,
      group: (args.group as string) || existing.group,
      is_hidden: args.hidden !== undefined ? Boolean(args.hidden) : existing.is_hidden,
      possible_values: args['possible-values']
        ? (args['possible-values'] as string).split(',').map(v => v.trim())
        : existing.possible_values,
      value_type: (args['value-type'] as string) || existing.value_type
    };

    if (verbose) {
      console.log(`📝 Updating customer attribute: ${idn} (ID: ${existing.id})`);
      if (args.value !== undefined) console.log(`   Value: ${existing.value} -> ${updated.value}`);
      if (args.title) console.log(`   Title: ${existing.title} -> ${updated.title}`);
      if (args.description) console.log(`   Description: updated`);
      if (args.group) console.log(`   Group: ${existing.group} -> ${updated.group}`);
      if (args['value-type']) console.log(`   Type: ${existing.value_type} -> ${updated.value_type}`);
      if (args.hidden !== undefined) console.log(`   Hidden: ${existing.is_hidden} -> ${updated.is_hidden}`);
    }

    await updateCustomerAttribute(client, updated);

    console.log(`✅ Customer attribute updated: ${idn}`);
    if (args.value !== undefined) console.log(`   Value: ${updated.value}`);
    if (args['value-type']) console.log(`   Type: ${updated.value_type}`);
    if (args.title) console.log(`   Title: ${updated.title}`);
    if (args.description) console.log(`   Description: updated`);
    if (args.group) console.log(`   Group: ${updated.group}`);

  } catch (error: unknown) {
    console.error('❌ Failed to update customer attribute:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
