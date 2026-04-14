/**
 * Push command handler
 *
 * Supports selective resource sync with --only and --exclude flags:
 *   newo push --only projects,attributes
 *   newo push --exclude integrations
 *   newo push --all  (explicit all resources)
 *
 * Available resources: projects, attributes, integrations, akb
 * Note: conversations is read-only and cannot be pushed
 */
import { makeClient } from '../../api.js';
import { pushChanged } from '../../sync.js';
import { getValidAccessToken } from '../../auth.js';
import { selectSingleCustomer, interactiveCustomerSelection } from '../customer-selection.js';
import { setupCli } from '../../cli-new/bootstrap.js';
import { PUSHABLE_RESOURCE_TYPES } from '../../cli-new/di/tokens.js';
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
 * Validate resource types for push
 */
function validateResources(resources: string[]): { valid: string[]; invalid: string[] } {
  const validTypes = new Set<string>(PUSHABLE_RESOURCE_TYPES);
  const valid: string[] = [];
  const invalid: string[] = [];

  for (const r of resources) {
    if (r === 'conversations') {
      invalid.push(r + ' (read-only)');
    } else if (validTypes.has(r)) {
      valid.push(r);
    } else {
      invalid.push(r);
    }
  }

  return { valid, invalid };
}

/**
 * Push using SyncEngine with selective sync and format support
 */
async function pushWithSyncEngine(
  customerConfig: MultiCustomerConfig,
  customer: CustomerConfig,
  resources: string[] | 'all',
  verbose: boolean,
  formatVersion?: FormatVersion
): Promise<void> {
  const { syncEngine, logger } = setupCli(customerConfig, verbose, formatVersion);

  if (resources === 'all') {
    const result = await syncEngine.pushAll(customer);
    logger.info(`✅ Pushed: ${result.totalCreated} created, ${result.totalUpdated} updated, ${result.totalDeleted} deleted`);
    if (result.errors.length > 0) {
      logger.warn(`⚠️  ${result.errors.length} error(s) occurred`);
      result.errors.forEach(e => logger.error(`   ${e}`));
    }
  } else {
    const result = await syncEngine.pushSelected(customer, resources);
    logger.info(`✅ Pushed: ${result.totalCreated} created, ${result.totalUpdated} updated, ${result.totalDeleted} deleted`);
    if (result.errors.length > 0) {
      logger.warn(`⚠️  ${result.errors.length} error(s) occurred`);
      result.errors.forEach(e => logger.error(`   ${e}`));
    }
  }
}

export async function handlePushCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean
): Promise<void> {
  const { selectedCustomer, allCustomers, isMultiCustomer } = selectSingleCustomer(
    customerConfig,
    args.customer as string | undefined
  );

  const shouldPublish = !args['no-publish'];

  // Check for selective sync flags
  const onlyResources = parseResourceList(args.only as string | undefined);
  const excludeResources = parseResourceList(args.exclude as string | undefined);
  const pushAllResources = Boolean(args.all);

  // Validate resource types
  if (onlyResources.length > 0) {
    const { invalid } = validateResources(onlyResources);
    if (invalid.length > 0) {
      console.error(`❌ Cannot push resource(s): ${invalid.join(', ')}`);
      console.error(`   Available for push: ${PUSHABLE_RESOURCE_TYPES.join(', ')}`);
      process.exit(1);
    }
  }

  if (excludeResources.length > 0) {
    const { invalid } = validateResources(excludeResources);
    if (invalid.length > 0 && !invalid.every(r => r.includes('read-only'))) {
      console.error(`❌ Unknown resource type(s): ${invalid.join(', ')}`);
      console.error(`   Available: ${PUSHABLE_RESOURCE_TYPES.join(', ')}`);
      process.exit(1);
    }
  }

  // Determine which resources to push
  let resourcesToPush: string[] | 'all' = 'all';

  if (onlyResources.length > 0) {
    resourcesToPush = onlyResources;
    console.log(`📦 Pushing selected resources: ${onlyResources.join(', ')}`);
  } else if (excludeResources.length > 0) {
    resourcesToPush = PUSHABLE_RESOURCE_TYPES.filter(r => !excludeResources.includes(r));
    console.log(`📦 Pushing resources (excluding: ${excludeResources.join(', ')})`);
  } else if (pushAllResources) {
    resourcesToPush = 'all';
    console.log(`📦 Pushing ALL resources`);
  }

  // Use SyncEngine if selective sync requested, otherwise use legacy for backward compatibility
  const useSyncEngine = onlyResources.length > 0 || excludeResources.length > 0 || pushAllResources;
  const explicitFormat = args.format as string | undefined;

  /**
   * Push for a single customer with format detection
   */
  async function pushForCustomer(customer: CustomerConfig): Promise<void> {
    const formatConfig = resolveFormat(customer.idn, explicitFormat);
    const isV2Format = formatConfig.version === 'newo_v2';

    if (verbose || isV2Format) {
      const sourceLabel = formatConfig.source === 'auto-detected' ? 'auto-detected'
        : formatConfig.source === 'env-var' ? 'from .env'
        : formatConfig.source === 'explicit-flag' ? '--format flag'
        : 'default';
      console.log(`Format: ${formatConfig.version} [${sourceLabel}]`);
    }

    if (useSyncEngine || isV2Format) {
      await pushWithSyncEngine(customerConfig, customer, resourcesToPush, verbose, formatConfig.version);
    } else {
      const accessToken = await getValidAccessToken(customer);
      const client = await makeClient(verbose, accessToken);
      await pushChanged(client, customer, verbose, shouldPublish);
    }
  }

  if (selectedCustomer) {
    await pushForCustomer(selectedCustomer);
  } else if (isMultiCustomer) {
    const customersToProcess = await interactiveCustomerSelection(allCustomers);

    if (customersToProcess.length === 1) {
      await pushForCustomer(customersToProcess[0]!);
    } else {
      console.log(`Pushing to ${customersToProcess.length} customers...`);
      for (const customer of customersToProcess) {
        console.log(`\nPushing for customer: ${customer.idn}`);
        await pushForCustomer(customer);
      }
      console.log(`\nPush completed for all ${customersToProcess.length} customers`);
    }
  }
}