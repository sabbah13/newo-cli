/**
 * Push command handler
 */
import { makeClient } from '../../api.js';
import { pushChanged } from '../../sync/index.js';
import { getValidAccessToken } from '../../auth.js';
import { selectSingleCustomer, interactiveCustomerSelection } from '../customer-selection.js';
import type { MultiCustomerConfig, CliArgs } from '../../types.js';

export async function handlePushCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean
): Promise<void> {
  const { selectedCustomer, allCustomers, isMultiCustomer } = selectSingleCustomer(
    customerConfig,
    args.customer as string | undefined
  );

  if (selectedCustomer) {
    // Single customer push
    const accessToken = await getValidAccessToken(selectedCustomer);
    const client = await makeClient(verbose, accessToken);
    await pushChanged(client, selectedCustomer, verbose);
  } else if (isMultiCustomer) {
    // Multiple customers exist with no default, ask user
    const customersToProcess = await interactiveCustomerSelection(allCustomers);

    if (customersToProcess.length === 1) {
      // Single customer selected
      const customer = customersToProcess[0]!;
      const accessToken = await getValidAccessToken(customer);
      const client = await makeClient(verbose, accessToken);
      await pushChanged(client, customer, verbose);
    } else {
      // Multi-customer push (user selected "All customers")
      console.log(`🔄 Pushing to ${customersToProcess.length} customers...`);
      for (const customer of customersToProcess) {
        console.log(`\n📤 Pushing for customer: ${customer.idn}`);
        const accessToken = await getValidAccessToken(customer);
        const client = await makeClient(verbose, accessToken);
        await pushChanged(client, customer, verbose);
      }
      console.log(`\n✅ Push completed for all ${customersToProcess.length} customers`);
    }
  }
}