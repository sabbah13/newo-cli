/**
 * Create Flow Event Command Handler
 */
import { makeClient, createFlowEvent } from '../../api.js';
import { getValidAccessToken } from '../../auth.js';
import { requireSingleCustomer } from '../customer-selection.js';
import type { MultiCustomerConfig, CliArgs, CreateFlowEventRequest } from '../../types.js';

export async function handleCreateEventCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean = false
): Promise<void> {
  try {
    const selectedCustomer = requireSingleCustomer(customerConfig, args.customer as string | undefined);

    // Parse arguments
    const idn = args._[1] as string;
    const flowId = args.flow as string;
    const skillIdn = args.skill as string;
    const description = args.description as string || '';
    const skillSelector = args['skill-selector'] as string || 'skill_idn';
    const interruptMode = args['interrupt-mode'] as string || 'queue';
    const integrationIdn = args.integration as string || 'api';
    const connectorIdn = args.connector as string || 'webhook';
    const stateIdn = args.state as string;

    if (!idn) {
      console.error('Error: Event IDN is required');
      console.error('Usage: newo create-event <idn> --flow <flow-id> --skill <skill-idn> [--description <desc>] [--skill-selector <selector>] [--interrupt-mode <mode>] [--integration <integration>] [--connector <connector>] [--state <state-idn>]');
      process.exit(1);
    }

    if (!flowId) {
      console.error('Error: Flow ID is required');
      console.error('Usage: newo create-event <idn> --flow <flow-id> --skill <skill-idn> [options]');
      process.exit(1);
    }

    if (!skillIdn) {
      console.error('Error: Skill IDN is required');
      console.error('Usage: newo create-event <idn> --flow <flow-id> --skill <skill-idn> [options]');
      process.exit(1);
    }

    if (verbose) {
      console.log(`📝 Creating event: ${idn}`);
      console.log(`   Flow ID: ${flowId}`);
      console.log(`   Skill IDN: ${skillIdn}`);
      console.log(`   Integration: ${integrationIdn}`);
      console.log(`   Connector: ${connectorIdn}`);
    }

    // Get access token and create client
    const accessToken = await getValidAccessToken(selectedCustomer);
    const client = await makeClient(verbose, accessToken);

    // Create event on NEWO platform
    const createEventRequest: CreateFlowEventRequest = {
      idn,
      description,
      skill_selector: skillSelector,
      skill_idn: skillIdn,
      state_idn: stateIdn || null,
      interrupt_mode: interruptMode,
      integration_idn: integrationIdn,
      connector_idn: connectorIdn
    };

    const createResponse = await createFlowEvent(client, flowId, createEventRequest);
    console.log(`✅ Event created: ${idn} (ID: ${createResponse.id})`);
    console.log(`   Flow: ${flowId}`);
    console.log(`   Triggers skill: ${skillIdn}`);

  } catch (error: unknown) {
    console.error('❌ Failed to create event:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}