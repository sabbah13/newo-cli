/**
 * Create Project Command Handler - Creates new project on NEWO platform
 */
import { makeClient, createProject } from '../../api.js';
import { getValidAccessToken } from '../../auth.js';
import { requireSingleCustomer } from '../customer-selection.js';
import type { MultiCustomerConfig, CliArgs, CreateProjectRequest } from '../../types.js';

export async function handleCreateProjectCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean = false
): Promise<void> {
  try {
    const selectedCustomer = requireSingleCustomer(customerConfig, args.customer as string | undefined);

    // Parse arguments
    const idn = args._[1] as string;
    const title = args.title as string || idn;
    const description = args.description as string || '';
    const version = args.version as string || '';
    const isAutoUpdateEnabled = Boolean(args['auto-update']);
    const registryIdn = args.registry as string || 'production';

    if (!idn) {
      console.error('Error: Project IDN is required');
      console.error('Usage: newo create-project <idn> [--title <title>] [--description <description>] [--version <version>] [--auto-update] [--registry <registry>]');
      process.exit(1);
    }

    if (verbose) {
      console.log(`📝 Creating project: ${idn}`);
      console.log(`   Title: ${title}`);
      console.log(`   Description: ${description}`);
      console.log(`   Version: ${version || 'none'}`);
      console.log(`   Auto-update: ${isAutoUpdateEnabled}`);
      console.log(`   Registry: ${registryIdn}`);
    }

    // Get access token and create client
    const accessToken = await getValidAccessToken(selectedCustomer);
    const client = await makeClient(verbose, accessToken);

    // Create project on NEWO platform
    const createProjectRequest: CreateProjectRequest = {
      idn,
      title,
      version,
      description,
      is_auto_update_enabled: isAutoUpdateEnabled,
      registry_idn: registryIdn,
      registry_item_idn: null,
      registry_item_version: null
    };

    const createResponse = await createProject(client, createProjectRequest);
    console.log(`✅ Project created: ${idn} (ID: ${createResponse.id})`);
    console.log(`   Title: ${title}`);
    console.log(`   Description: ${description}`);
    console.log(`   Run 'newo pull' to sync project locally`);

  } catch (error: unknown) {
    console.error('❌ Failed to create project:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}