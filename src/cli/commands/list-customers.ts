/**
 * List customers command handler
 */
import { listCustomers } from '../../customerAsync.js';
import type { MultiCustomerConfig } from '../../types.js';

export function handleListCustomersCommand(customerConfig: MultiCustomerConfig): void {
  const customers = listCustomers(customerConfig);
  console.log('Available customers:');
  for (const customerIdn of customers) {
    const isDefault = customerConfig.defaultCustomer === customerIdn;
    console.log(`  ${customerIdn}${isDefault ? ' (default)' : ''}`);
  }
}