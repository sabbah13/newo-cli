/**
 * List Registry Items Command Handler - Lists available projects in a registry
 */
import { makeClient, listRegistries, listRegistryItems } from '../../api.js';
import { getValidAccessToken } from '../../auth.js';
import { requireSingleCustomer } from '../customer-selection.js';
import type { MultiCustomerConfig, CliArgs, Registry, RegistryItem } from '../../types.js';

interface GroupedItem {
  idn: string;
  versions: RegistryItem[];
  latestVersion: string;
  totalActiveProjects: number;
}

function groupItemsByIdn(items: RegistryItem[]): GroupedItem[] {
  const groups = new Map<string, RegistryItem[]>();

  for (const item of items) {
    const existing = groups.get(item.idn) || [];
    existing.push(item);
    groups.set(item.idn, existing);
  }

  const result: GroupedItem[] = [];

  for (const [idn, versions] of groups) {
    // Sort versions by published_at descending (newest first)
    const sortedVersions = [...versions].sort((a, b) =>
      new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
    );

    const latestItem = sortedVersions[0];
    if (!latestItem) continue;

    // Sum up active project counts across all versions
    const totalActiveProjects = versions.reduce((sum, v) => sum + v.active_project_count, 0);

    result.push({
      idn,
      versions: sortedVersions,
      latestVersion: latestItem.version,
      totalActiveProjects
    });
  }

  // Sort by IDN alphabetically
  return result.sort((a, b) => a.idn.localeCompare(b.idn));
}

export async function handleListRegistryItemsCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean = false
): Promise<void> {
  try {
    const selectedCustomer = requireSingleCustomer(customerConfig, args.customer as string | undefined);

    // Parse arguments
    const registryIdn = args._[1] as string;
    const showAllVersions = Boolean(args.all || args.a);

    if (!registryIdn) {
      console.error('Error: Registry IDN is required');
      console.error('Usage: newo list-registry-items <registry-idn> [--all]');
      console.error('');
      console.error('Examples:');
      console.error('  newo list-registry-items production');
      console.error('  newo list-registry-items staging --all');
      console.error('');
      console.error('Run "newo list-registries" to see available registries');
      process.exit(1);
    }

    if (verbose) {
      console.log(`📋 Fetching items from registry: ${registryIdn}`);
      console.log(`   Customer: ${selectedCustomer.idn}`);
      console.log(`   Show all versions: ${showAllVersions}`);
    }

    // Get access token and create client
    const accessToken = await getValidAccessToken(selectedCustomer);
    const client = await makeClient(verbose, accessToken);

    // First, get registries to find the ID
    console.log(`🔍 Fetching registry "${registryIdn}"...`);
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

    console.log(`📦 Fetching projects from "${registryIdn}" registry (this may take a moment)...\n`);

    const items = await listRegistryItems(client, registry.id);

    if (items.length === 0) {
      console.log(`No projects found in "${registryIdn}" registry.`);
      return;
    }

    if (showAllVersions) {
      // Show all versions
      console.log(`✅ Found ${items.length} project versions in "${registryIdn}" registry:\n`);

      console.log('  Project IDN            │ Version  │ Active │ Published');
      console.log('  ───────────────────────┼──────────┼────────┼────────────────────');

      for (const item of items) {
        const idnPadded = item.idn.substring(0, 21).padEnd(21);
        const versionPadded = item.version.substring(0, 8).padEnd(8);
        const activePadded = String(item.active_project_count).padEnd(6);
        const published = new Date(item.published_at).toISOString().split('T')[0];
        console.log(`  ${idnPadded} │ ${versionPadded} │ ${activePadded} │ ${published}`);
      }
    } else {
      // Group by project IDN and show only latest version
      const grouped = groupItemsByIdn(items);

      console.log(`✅ Found ${grouped.length} unique projects in "${registryIdn}" registry:\n`);

      console.log('  Project IDN            │ Latest   │ Active │ Versions');
      console.log('  ───────────────────────┼──────────┼────────┼──────────');

      for (const group of grouped) {
        const idnPadded = group.idn.substring(0, 21).padEnd(21);
        const versionPadded = group.latestVersion.substring(0, 8).padEnd(8);
        const activePadded = String(group.totalActiveProjects).padEnd(6);
        const versionCount = String(group.versions.length).padEnd(8);
        console.log(`  ${idnPadded} │ ${versionPadded} │ ${activePadded} │ ${versionCount}`);
      }

      console.log('\n💡 Use --all flag to see all versions');
    }

    console.log(`\n💡 Use "newo add-project <idn> --registry ${registryIdn} --item <project-idn>" to install a project`);

  } catch (error: unknown) {
    console.error('❌ Failed to list registry items:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
