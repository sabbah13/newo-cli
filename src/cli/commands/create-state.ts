/**
 * Create Flow State Command Handler
 */
import { makeClient, createFlowState } from '../../api.js';
import { getValidAccessToken } from '../../auth.js';
import { requireSingleCustomer } from '../customer-selection.js';
import type { MultiCustomerConfig, CliArgs, CreateFlowStateRequest } from '../../types.js';

export async function handleCreateStateCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean = false
): Promise<void> {
  try {
    const selectedCustomer = requireSingleCustomer(customerConfig, args.customer as string | undefined);

    // Parse arguments
    const idn = args._[1] as string;
    const flowId = args.flow as string;
    const title = args.title as string || idn;
    const defaultValue = args['default-value'] as string || '';
    const scope = args.scope as string || 'user';

    if (!idn) {
      console.error('Error: State IDN is required');
      console.error('Usage: newo create-state <idn> --flow <flow-id> [--title <title>] [--default-value <value>] [--scope <user|flow|global>]');
      process.exit(1);
    }

    if (!flowId) {
      console.error('Error: Flow ID is required');
      console.error('Usage: newo create-state <idn> --flow <flow-id> [options]');
      process.exit(1);
    }

    if (!['user', 'flow', 'global'].includes(scope)) {
      console.error('Error: Scope must be one of: user, flow, global');
      process.exit(1);
    }

    if (verbose) {
      console.log(`📝 Creating state: ${idn}`);
      console.log(`   Flow ID: ${flowId}`);
      console.log(`   Title: ${title}`);
      console.log(`   Default Value: ${defaultValue}`);
      console.log(`   Scope: ${scope}`);
    }

    // Get access token and create client
    const accessToken = await getValidAccessToken(selectedCustomer);
    const client = await makeClient(verbose, accessToken);

    // Create state on NEWO platform
    const createStateRequest: CreateFlowStateRequest = {
      idn,
      title,
      default_value: defaultValue,
      scope
    };

    const createResponse = await createFlowState(client, flowId, createStateRequest);
    console.log(`✅ State created: ${idn} (ID: ${createResponse.id})`);
    console.log(`   Flow: ${flowId}`);
    console.log(`   Scope: ${scope}`);
    console.log(`   Default: ${defaultValue || 'none'}`);

  } catch (error: unknown) {
    console.error('❌ Failed to create state:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}