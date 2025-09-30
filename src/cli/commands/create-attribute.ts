/**
 * Create Customer Attribute Command Handler
 */
import { makeClient, createCustomerAttribute } from '../../api.js';
import { getValidAccessToken } from '../../auth.js';
import { requireSingleCustomer } from '../customer-selection.js';
import type { MultiCustomerConfig, CliArgs, CreateCustomerAttributeRequest } from '../../types.js';

export async function handleCreateAttributeCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean = false
): Promise<void> {
  try {
    const selectedCustomer = requireSingleCustomer(customerConfig, args.customer as string | undefined);

    // Parse arguments
    const idn = args._[1] as string;
    const value = args.value as string || '';
    const title = args.title as string || idn;
    const description = args.description as string || '';
    const group = args.group as string || 'General';
    const isHidden = Boolean(args.hidden);
    const valueType = args['value-type'] as string || 'string';
    const possibleValues = args['possible-values'] ?
      (args['possible-values'] as string).split(',').map(v => v.trim()) : [];

    if (!idn) {
      console.error('Error: Attribute IDN is required');
      console.error('Usage: newo create-attribute <idn> --value <value> [--title <title>] [--description <desc>] [--group <group>] [--hidden] [--value-type <type>] [--possible-values <val1,val2>]');
      process.exit(1);
    }

    if (!value) {
      console.error('Error: Attribute value is required');
      console.error('Usage: newo create-attribute <idn> --value <value> [options]');
      process.exit(1);
    }

    if (verbose) {
      console.log(`📝 Creating customer attribute: ${idn}`);
      console.log(`   Title: ${title}`);
      console.log(`   Value: ${value}`);
      console.log(`   Group: ${group}`);
      console.log(`   Type: ${valueType}`);
      console.log(`   Hidden: ${isHidden}`);
    }

    // Get access token and create client
    const accessToken = await getValidAccessToken(selectedCustomer);
    const client = await makeClient(verbose, accessToken);

    // Create attribute on NEWO platform
    const createAttributeRequest: CreateCustomerAttributeRequest = {
      idn,
      value,
      title,
      description,
      group,
      is_hidden: isHidden,
      possible_values: possibleValues,
      value_type: valueType
    };

    const createResponse = await createCustomerAttribute(client, createAttributeRequest);
    console.log(`✅ Customer attribute created: ${idn} (ID: ${createResponse.id})`);
    console.log(`   Title: ${title}`);
    console.log(`   Value: ${value}`);
    console.log(`   Group: ${group}`);

  } catch (error: unknown) {
    console.error('❌ Failed to create customer attribute:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}