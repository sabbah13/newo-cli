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
 * Pull using V2 SyncEngine with selective sync
 */
async function pullWithV2Engine(
  customerConfig: MultiCustomerConfig,
  customer: CustomerConfig,
  resources: string[] | 'all',
  verbose: boolean,
  silentOverwrite: boolean
): Promise<void> {
  const { syncEngine, logger } = setupCli(customerConfig, verbose);

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

  // Use V2 engine if selective sync requested, otherwise use legacy for backward compatibility
  const useV2Engine = onlyResources.length > 0 || excludeResources.length > 0 || pullAllResources;

  if (selectedCustomer) {
    if (useV2Engine) {
      await pullWithV2Engine(customerConfig, selectedCustomer, resourcesToFetch, verbose, silentOverwrite);
    } else {
      // Legacy behavior: pull projects + attributes only
      const accessToken = await getValidAccessToken(selectedCustomer);
      const client = await makeClient(verbose, accessToken);
      const projectId = selectedCustomer.projectId || null;
      await pullAll(client, selectedCustomer, projectId, verbose, silentOverwrite);
    }
  } else if (isMultiCustomer) {
    if (verbose) console.log(`📥 No default customer specified, pulling from all ${allCustomers.length} customers`);
    console.log(`🔄 Pulling from ${allCustomers.length} customers...`);

    for (const customer of allCustomers) {
      console.log(`\n📥 Pulling from customer: ${customer.idn}`);

      if (useV2Engine) {
        await pullWithV2Engine(customerConfig, customer, resourcesToFetch, verbose, silentOverwrite);
      } else {
        const accessToken = await getValidAccessToken(customer);
        const client = await makeClient(verbose, accessToken);
        const projectId = customer.projectId || null;
        await pullAll(client, customer, projectId, verbose, silentOverwrite);
      }
    }
    console.log(`\n✅ Pull completed for all ${allCustomers.length} customers`);
  }
}