/**
 * Status command handler
 *
 * Supports format-aware status with --format flag:
 *   newo status                     # auto-detect format per customer
 *   newo status --format newo_v2    # force V2 format
 */
import { status } from '../../sync.js';
import { selectSingleCustomer } from '../customer-selection.js';
import { setupCli } from '../../cli-new/bootstrap.js';
import { resolveFormat } from '../../format/detect.js';
import type { MultiCustomerConfig, CliArgs, CustomerConfig } from '../../types.js';

async function statusForCustomer(
  customerConfig: MultiCustomerConfig,
  customer: CustomerConfig,
  explicitFormat: string | undefined,
  verbose: boolean
): Promise<void> {
  const formatConfig = resolveFormat(customer.idn, explicitFormat);
  const isV2Format = formatConfig.version === 'newo_v2';

  if (verbose || isV2Format) {
    const sourceLabel = formatConfig.source === 'auto-detected' ? 'auto-detected'
      : formatConfig.source === 'env-var' ? 'from .env'
      : formatConfig.source === 'explicit-flag' ? '--format flag'
      : 'default';
    console.log(`Format: ${formatConfig.version} [${sourceLabel}]`);
  }

  if (isV2Format) {
    // Use SyncEngine with V2ProjectSyncStrategy
    const { syncEngine, logger } = setupCli(customerConfig, verbose, formatConfig.version);
    const report = await syncEngine.getStatus(customer);

    logger.info(`\nStatus for customer: ${report.customer}`);
    logger.info(`Total changes: ${report.totalChanges}\n`);

    for (const resource of report.resources) {
      if (resource.changedCount > 0) {
        logger.info(`${resource.displayName}: ${resource.changedCount} change(s)`);
        for (const change of resource.changes) {
          const op = change.operation.toUpperCase().charAt(0);
          logger.info(`  ${op} ${change.path}`);
        }
      }
    }

    if (report.totalChanges === 0) {
      logger.info('No changes to push.');
    }
  } else {
    // Legacy V1 status
    await status(customer, verbose);
  }
}

export async function handleStatusCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean
): Promise<void> {
  const { selectedCustomer, allCustomers, isMultiCustomer } = selectSingleCustomer(
    customerConfig,
    args.customer as string | undefined
  );

  const explicitFormat = args.format as string | undefined;

  if (selectedCustomer) {
    await statusForCustomer(customerConfig, selectedCustomer, explicitFormat, verbose);
  } else if (isMultiCustomer) {
    console.log(`Checking status for ${allCustomers.length} customers...`);
    for (const customer of allCustomers) {
      console.log(`\nStatus for customer: ${customer.idn}`);
      await statusForCustomer(customerConfig, customer, explicitFormat, verbose);
    }
    console.log(`\nStatus check completed for all ${allCustomers.length} customers`);
  }
}
