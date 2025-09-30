/**
 * Create Skill Parameter Command Handler
 */
import { makeClient, createSkillParameter } from '../../api.js';
import { getValidAccessToken } from '../../auth.js';
import { requireSingleCustomer } from '../customer-selection.js';
import type { MultiCustomerConfig, CliArgs, CreateSkillParameterRequest } from '../../types.js';

export async function handleCreateParameterCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean = false
): Promise<void> {
  try {
    const selectedCustomer = requireSingleCustomer(customerConfig, args.customer as string | undefined);

    // Parse arguments
    const name = args._[1] as string;
    const skillId = args.skill as string;
    const defaultValue = args['default-value'] as string || '';

    if (!name) {
      console.error('Error: Parameter name is required');
      console.error('Usage: newo create-parameter <name> --skill <skill-id> [--default-value <value>]');
      process.exit(1);
    }

    if (!skillId) {
      console.error('Error: Skill ID is required');
      console.error('Usage: newo create-parameter <name> --skill <skill-id> [--default-value <value>]');
      process.exit(1);
    }

    if (verbose) {
      console.log(`📝 Creating parameter: ${name}`);
      console.log(`   Skill ID: ${skillId}`);
      console.log(`   Default Value: ${defaultValue}`);
    }

    // Get access token and create client
    const accessToken = await getValidAccessToken(selectedCustomer);
    const client = await makeClient(verbose, accessToken);

    // Create parameter on NEWO platform
    const createParameterRequest: CreateSkillParameterRequest = {
      name,
      default_value: String(defaultValue)  // Ensure default_value is always a string
    };

    const createResponse = await createSkillParameter(client, skillId, createParameterRequest);
    console.log(`✅ Parameter created: ${name} (ID: ${createResponse.id})`);
    console.log(`   Skill: ${skillId}`);
    console.log(`   Default: ${defaultValue || 'none'}`);

  } catch (error: unknown) {
    console.error('❌ Failed to create parameter:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}