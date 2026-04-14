/**
 * Pull command handler
 *
 * Supports selective resource sync with --only and --exclude flags:
 *   newo pull --only projects,attributes
 *   newo pull --exclude conversations,akb
 *   newo pull --all  (explicit all resources)
 *
 * Available resources: projects, attributes, integrations, akb, conversations
 */
import { makeClient } from '../../api.js';
import { pullAll } from '../../sync.js';
import { getValidAccessToken } from '../../auth.js';
import { selectSingleCustomer } from '../customer-selection.js';
import { setupCli } from '../../cli-new/bootstrap.js';
import { ALL_RESOURCE_TYPES, RESOURCE_TYPES } from '../../cli-new/di/tokens.js';
import type { MultiCustomerConfig, CliArgs, CustomerConfig } from '../../types.js';
import { resolveFormat } from '../../format/detect.js';
import type { FormatVersion } from '../../format/types.js';

/**
 * Parse resource list from comma-separated string
 */
function parseResourceList(input: string | undefined): string[] {
  if (!input) return [];
  return input.split(',').map(r => r.trim().toLowerCase()).filter(Boolean);
}

/**
 * Validate resource types
 */
function validateResources(resources: string[]): { valid: string[]; invalid: string[] } {
  const validTypes = new Set(ALL_RESOURCE_TYPES);
  const valid: string[] = [];
  const invalid: string[] = [];

  for (const r of resources) {
    if (validTypes.has(r as typeof RESOURCE_TYPES[keyof typeof RESOURCE_TYPES])) {
      valid.push(r);
    } else {
      invalid.push(r);
    }
  }

  return { valid, invalid };
}

/**
 * Pull using SyncEngine with selective sync and format support
 */
async function pullWithSyncEngine(
  customerConfig: MultiCustomerConfig,
  customer: CustomerConfig,
  resources: string[] | 'all',
  verbose: boolean,
  silentOverwrite: boolean,
  formatVersion?: FormatVersion
): Promise<void> {
  const { syncEngine, logger } = setupCli(customerConfig, verbose, formatVersion);

  const pullOptions = {
    verbose,
    silentOverwrite
  };

  if (resources === 'all') {
    const result = await syncEngine.pullAll(customer, pullOptions);
    logger.info(`✅ Pulled ${result.totalItems} items from ${result.resources.length} resource types`);
    if (result.errors.length > 0) {
      logger.warn(`⚠️  ${result.errors.length} error(s) occurred`);
    }
  } else {
    const result = await syncEngine.pullSelected(customer, resources, pullOptions);
    logger.info(`✅ Pulled ${result.totalItems} items from ${result.resources.length} resource types`);
    if (result.errors.length > 0) {
      logger.warn(`⚠️  ${result.errors.length} error(s) occurred`);
    }
  }
}

export async function handlePullCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean
): Promise<void> {
  const { selectedCustomer, allCustomers, isMultiCustomer } = selectSingleCustomer(
    customerConfig,
    args.customer as string | undefined
  );

  // Check for force/silent overwrite flag
  const silentOverwrite = Boolean(args.force || args.f);

  // Check for selective sync flags
  const onlyResources = parseResourceList(args.only as string | undefined);
  const excludeResources = parseResourceList(args.exclude as string | undefined);
  const pullAllResources = Boolean(args.all);

  // Validate resource types
  if (onlyResources.length > 0) {
    const { invalid } = validateResources(onlyResources);
    if (invalid.length > 0) {
      console.error(`❌ Unknown resource type(s): ${invalid.join(', ')}`);
      console.error(`   Available: ${ALL_RESOURCE_TYPES.join(', ')}`);
      process.exit(1);
    }
  }

  if (excludeResources.length > 0) {
    const { invalid } = validateResources(excludeResources);
    if (invalid.length > 0) {
      console.error(`❌ Unknown resource type(s): ${invalid.join(', ')}`);
      console.error(`   Available: ${ALL_RESOURCE_TYPES.join(', ')}`);
      process.exit(1);
    }
  }

  // Determine which resources to pull
  let resourcesToFetch: string[] | 'all' = 'all';

  if (onlyResources.length > 0) {
    resourcesToFetch = onlyResources;
    console.log(`📦 Pulling selected resources: ${onlyResources.join(', ')}`);
  } else if (excludeResources.length > 0) {
    resourcesToFetch = ALL_RESOURCE_TYPES.filter(r => !excludeResources.includes(r));
    console.log(`📦 Pulling resources (excluding: ${excludeResources.join(', ')})`);
  } else if (pullAllResources) {
    resourcesToFetch = 'all';
    console.log(`📦 Pulling ALL resources`);
  }

  // Use SyncEngine if selective sync requested, otherwise use legacy for backward compatibility
  const useSyncEngine = onlyResources.length > 0 || excludeResources.length > 0 || pullAllResources;

  // Explicit --format flag (applies to all customers in this run)
  const explicitFormat = args.format as string | undefined;

  if (selectedCustomer) {
    // Resolve format for this customer
    const formatConfig = resolveFormat(selectedCustomer.idn, explicitFormat);
    const isV2Format = formatConfig.version === 'newo_v2';

    if (verbose || isV2Format) {
      const sourceLabel = formatConfig.source === 'auto-detected' ? 'auto-detected'
        : formatConfig.source === 'env-var' ? 'from .env'
        : formatConfig.source === 'explicit-flag' ? '--format flag'
        : 'default';
      console.log(`Format: ${formatConfig.version} [${sourceLabel}]`);
    }

    // If format is newo_v2, always use SyncEngine (which will use V2ProjectSyncStrategy)
    if (useSyncEngine || isV2Format) {
      await pullWithSyncEngine(customerConfig, selectedCustomer, resourcesToFetch, verbose, silentOverwrite, formatConfig.version);
    } else {
      // Legacy behavior: pull projects + attributes only (cli_v1)
      const accessToken = await getValidAccessToken(selectedCustomer);
      const client = await makeClient(verbose, accessToken);
      const projectId = selectedCustomer.projectId || null;
      await pullAll(client, selectedCustomer, projectId, verbose, silentOverwrite);
    }
  } else if (isMultiCustomer) {
    if (verbose) console.log(`No default customer specified, pulling from all ${allCustomers.length} customers`);
    console.log(`Pulling from ${allCustomers.length} customers...`);

    for (const customer of allCustomers) {
      console.log(`\nPulling from customer: ${customer.idn}`);

      // Resolve format per customer (auto-detect from filesystem)
      const formatConfig = resolveFormat(customer.idn, explicitFormat);
      const isV2Format = formatConfig.version === 'newo_v2';

      if (verbose || isV2Format) {
        const sourceLabel = formatConfig.source === 'auto-detected' ? 'auto-detected'
          : formatConfig.source === 'env-var' ? 'from .env'
          : formatConfig.source === 'explicit-flag' ? '--format flag'
          : 'default';
        console.log(`  Format: ${formatConfig.version} [${sourceLabel}]`);
      }

      if (useSyncEngine || isV2Format) {
        await pullWithSyncEngine(customerConfig, customer, resourcesToFetch, verbose, silentOverwrite, formatConfig.version);
      } else {
        const accessToken = await getValidAccessToken(customer);
        const client = await makeClient(verbose, accessToken);
        const projectId = customer.projectId || null;
        await pullAll(client, customer, projectId, verbose, silentOverwrite);
      }
    }
    console.log(`\nPull completed for all ${allCustomers.length} customers`);
  }
}