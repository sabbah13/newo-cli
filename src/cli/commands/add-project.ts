/**
 * Add Project from Registry Command Handler - Installs a project template from registry
 */
import { makeClient, listRegistries, listRegistryItems, addProjectFromRegistry } from '../../api.js';
import { getValidAccessToken } from '../../auth.js';
import { requireSingleCustomer } from '../customer-selection.js';
import type { MultiCustomerConfig, CliArgs, Registry, RegistryItem, AddProjectFromRegistryRequest } from '../../types.js';

export async function handleAddProjectCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean = false
): Promise<void> {
  try {
    const selectedCustomer = requireSingleCustomer(customerConfig, args.customer as string | undefined);

    // Parse arguments
    const projectIdn = args._[1] as string;
    const registryIdn = args.registry as string || 'production';
    const registryItemIdn = args.item as string;
    const registryItemVersion = args.version as string | null || null;
    const title = args.title as string || projectIdn || registryItemIdn;
    const description = args.description as string || '';
    const isAutoUpdateEnabled = Boolean(args['auto-update']);

    // Validate required arguments
    if (!registryItemIdn) {
      console.error('Error: Registry item IDN is required');
      console.error('');
      console.error('Usage: newo add-project <project-idn> --item <registry-item-idn> [options]');
      console.error('');
      console.error('Options:');
      console.error('  --item <idn>           Registry item/template IDN (required)');
      console.error('  --registry <idn>       Registry to use (default: production)');
      console.error('  --version <version>    Specific version to install (default: latest)');
      console.error('  --title <title>        Project title (default: project IDN)');
      console.error('  --description <desc>   Project description');
      console.error('  --auto-update          Enable automatic updates from registry');
      console.error('');
      console.error('Examples:');
      console.error('  newo add-project my_weather --item weather_integration');
      console.error('  newo add-project my_calcom --item cal_com_integration --registry production');
      console.error('  newo add-project my_zoho --item zoho_integration --version 1.0.2 --auto-update');
      console.error('');
      console.error('Run "newo list-registries" to see available registries');
      console.error('Run "newo list-registry-items <registry-idn>" to see available project templates');
      process.exit(1);
    }

    // Use registry item IDN as project IDN if not specified
    const finalProjectIdn = projectIdn || registryItemIdn;

    if (verbose) {
      console.log(`📦 Adding project from registry`);
      console.log(`   Project IDN: ${finalProjectIdn}`);
      console.log(`   Title: ${title}`);
      console.log(`   Registry: ${registryIdn}`);
      console.log(`   Item: ${registryItemIdn}`);
      console.log(`   Version: ${registryItemVersion || 'latest'}`);
      console.log(`   Auto-update: ${isAutoUpdateEnabled}`);
      console.log(`   Customer: ${selectedCustomer.idn}`);
    }

    // Get access token and create client
    const accessToken = await getValidAccessToken(selectedCustomer);
    const client = await makeClient(verbose, accessToken);

    // Validate registry exists
    console.log(`🔍 Validating registry "${registryIdn}"...`);
    const registries = await listRegistries(client);
    const registry = registries.find((r: Registry) => r.idn === registryIdn);

    if (!registry) {
      console.error(`❌ Registry "${registryIdn}" not found`);
      console.error('');
      console.error('Available registries:');
      for (const r of registries) {
        console.error(`  • ${r.idn}`);
      }
      process.exit(1);
    }

    // Validate registry item exists and find version
    console.log(`🔍 Validating project template "${registryItemIdn}"...`);
    const items = await listRegistryItems(client, registry.id);
    const matchingItems = items.filter((item: RegistryItem) => item.idn === registryItemIdn);

    if (matchingItems.length === 0) {
      console.error(`❌ Project template "${registryItemIdn}" not found in "${registryIdn}" registry`);
      console.error('');
      console.error('Run "newo list-registry-items ' + registryIdn + '" to see available templates');
      process.exit(1);
    }

    // Find the specific version or latest
    let selectedItem: RegistryItem | undefined;
    if (registryItemVersion) {
      selectedItem = matchingItems.find((item: RegistryItem) => item.version === registryItemVersion);
      if (!selectedItem) {
        console.error(`❌ Version "${registryItemVersion}" not found for "${registryItemIdn}"`);
        console.error('');
        console.error('Available versions:');
        const sortedItems = [...matchingItems].sort((a, b) =>
          new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
        );
        for (const item of sortedItems.slice(0, 10)) {
          console.error(`  • ${item.version} (published: ${new Date(item.published_at).toISOString().split('T')[0]})`);
        }
        if (sortedItems.length > 10) {
          console.error(`  ... and ${sortedItems.length - 10} more`);
        }
        process.exit(1);
      }
    } else {
      // Get latest version (sorted by published_at desc)
      const sortedItems = [...matchingItems].sort((a, b) =>
        new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
      );
      selectedItem = sortedItems[0];
    }

    if (!selectedItem) {
      console.error(`❌ Could not determine version for "${registryItemIdn}"`);
      process.exit(1);
    }

    console.log(`📥 Installing "${registryItemIdn}" v${selectedItem.version} as "${finalProjectIdn}"...`);

    // Create project from registry
    const projectData: AddProjectFromRegistryRequest = {
      idn: finalProjectIdn,
      title,
      version: '',
      description,
      is_auto_update_enabled: isAutoUpdateEnabled,
      registry_idn: registryIdn,
      registry_item_idn: registryItemIdn,
      registry_item_version: registryItemVersion
    };

    const response = await addProjectFromRegistry(client, projectData);

    console.log('');
    console.log(`✅ Project installed successfully!`);
    console.log(`   Project IDN: ${finalProjectIdn}`);
    console.log(`   Project ID: ${response.id}`);
    console.log(`   Source: ${registryItemIdn} v${selectedItem.version}`);
    console.log(`   Registry: ${registryIdn}`);
    if (isAutoUpdateEnabled) {
      console.log(`   Auto-update: Enabled`);
    }
    console.log('');
    console.log(`💡 Run "newo pull" to sync the project locally`);

  } catch (error: unknown) {
    console.error('❌ Failed to add project from registry:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
