/**
 * Create Persona Command Handler
 */
import { makeClient, createPersona } from '../../api.js';
import { getValidAccessToken } from '../../auth.js';
import { requireSingleCustomer } from '../customer-selection.js';
import type { MultiCustomerConfig, CliArgs, CreatePersonaRequest } from '../../types.js';

export async function handleCreatePersonaCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean = false
): Promise<void> {
  try {
    const selectedCustomer = requireSingleCustomer(customerConfig, args.customer as string | undefined);

    // Parse arguments
    const name = args._[1] as string;
    const title = args.title as string || name;
    const description = args.description as string || '';

    if (!name) {
      console.error('Error: Persona name is required');
      console.error('Usage: newo create-persona <name> [--title <title>] [--description <description>]');
      process.exit(1);
    }

    if (verbose) {
      console.log(`📝 Creating persona: ${name}`);
      console.log(`   Title: ${title}`);
      console.log(`   Description: ${description}`);
    }

    // Get access token and create client
    const accessToken = await getValidAccessToken(selectedCustomer);
    const client = await makeClient(verbose, accessToken);

    // Create persona on NEWO platform
    const createPersonaRequest: CreatePersonaRequest = {
      name,
      title,
      description
    };

    const createResponse = await createPersona(client, createPersonaRequest);
    console.log(`✅ Persona created: ${name} (ID: ${createResponse.id})`);
    console.log(`   Title: ${title}`);
    console.log(`   Use this persona ID when creating agents: --persona-id ${createResponse.id}`);

  } catch (error: unknown) {
    console.error('❌ Failed to create persona:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}