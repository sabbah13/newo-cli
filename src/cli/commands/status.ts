/**
 * Status command handler
 */
import { status } from '../../sync.js';
import { selectSingleCustomer } from '../customer-selection.js';
import type { MultiCustomerConfig, CliArgs } from '../../types.js';

export async function handleStatusCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean
): Promise<void> {
  const { selectedCustomer, allCustomers, isMultiCustomer } = selectSingleCustomer(
    customerConfig,
    args.customer as string | undefined
  );

  if (selectedCustomer) {
    // Single customer status
    await status(selectedCustomer, verbose);
  } else if (isMultiCustomer) {
    // Multi-customer status
    console.log(`🔄 Checking status for ${allCustomers.length} customers...`);
    for (const customer of allCustomers) {
      console.log(`\n📋 Status for customer: ${customer.idn}`);
      await status(customer, verbose);
    }
    console.log(`\n✅ Status check completed for all ${allCustomers.length} customers`);
  }
}