/**
 * Customer selection and management utilities for CLI commands
 */
import {
  parseCustomerConfigAsync,
  listCustomers,
  getCustomer,
  getDefaultCustomer,
  tryGetDefaultCustomer,
  getAllCustomers,
  validateCustomerConfig
} from '../customerAsync.js';
import { logCliError } from './errors.js';
import type { CustomerConfig, MultiCustomerConfig } from '../types.js';

export interface CustomerSelectionResult {
  selectedCustomer: CustomerConfig | null;
  allCustomers: CustomerConfig[];
  isMultiCustomer: boolean;
}

/**
 * Parse and validate customer configuration
 */
export async function parseAndValidateCustomerConfig(env: any, verbose: boolean): Promise<MultiCustomerConfig> {
  try {
    const customerConfig = await parseCustomerConfigAsync(env, verbose);
    validateCustomerConfig(customerConfig);
    return customerConfig;
  } catch (error: unknown) {
    logCliError('error', 'Failed to parse customer configuration');
    if (error instanceof Error) {
      logCliError('error', error.message);
    }
    process.exit(1);
  }
}

/**
 * Handle customer selection for commands that support single customer operations
 */
export function selectSingleCustomer(
  customerConfig: MultiCustomerConfig,
  customerArg?: string
): CustomerSelectionResult {
  let selectedCustomer: CustomerConfig | null = null;
  let allCustomers: CustomerConfig[] = [];

  if (customerArg) {
    const customer = getCustomer(customerConfig, customerArg);
    if (!customer) {
      console.error(`Unknown customer: ${customerArg}`);
      console.error(`Available customers: ${listCustomers(customerConfig).join(', ')}`);
      process.exit(1);
    }
    selectedCustomer = customer;
  } else {
    // Try to get default, fall back to all customers
    selectedCustomer = tryGetDefaultCustomer(customerConfig);
    if (!selectedCustomer) {
      allCustomers = getAllCustomers(customerConfig);
    }
  }

  return {
    selectedCustomer,
    allCustomers,
    isMultiCustomer: allCustomers.length > 0
  };
}

/**
 * Handle customer selection for commands that require exactly one customer
 */
export function requireSingleCustomer(
  customerConfig: MultiCustomerConfig,
  customerArg?: string
): CustomerConfig {
  if (customerArg) {
    const customer = getCustomer(customerConfig, customerArg);
    if (!customer) {
      console.error(`Unknown customer: ${customerArg}`);
      console.error(`Available customers: ${listCustomers(customerConfig).join(', ')}`);
      process.exit(1);
    }
    return customer;
  } else {
    try {
      return getDefaultCustomer(customerConfig);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exit(1);
    }
  }
}

/**
 * Interactive customer selection for commands like push
 */
export async function interactiveCustomerSelection(allCustomers: CustomerConfig[]): Promise<CustomerConfig[]> {
  console.log(`\n📤 Multiple customers available for push:`);
  allCustomers.forEach((customer, index) => {
    console.log(`  ${index + 1}. ${customer.idn}`);
  });
  console.log(`  ${allCustomers.length + 1}. All customers`);

  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const choice = await new Promise<string>((resolve) => {
    rl.question(`\nSelect customer to push (1-${allCustomers.length + 1}): `, resolve);
  });
  rl.close();

  const choiceNum = parseInt(choice.trim());
  if (choiceNum === allCustomers.length + 1) {
    // User selected "All customers"
    console.log(`🔄 Pushing to all ${allCustomers.length} customers...`);
    return allCustomers;
  } else if (choiceNum >= 1 && choiceNum <= allCustomers.length) {
    // User selected specific customer
    const selectedCustomer = allCustomers[choiceNum - 1];
    if (selectedCustomer) {
      console.log(`🔄 Pushing to customer: ${selectedCustomer.idn}`);
      return [selectedCustomer];
    }
  }

  console.error('Invalid choice. Exiting.');
  process.exit(1);
}