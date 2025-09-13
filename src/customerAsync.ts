import type { NewoEnvironment, CustomerConfig, MultiCustomerConfig } from './types.js';
import { initializeCustomersFromApiKeys, usesArrayBasedConfig } from './customerInit.js';
import { parseCustomerConfig } from './customer.js';

/**
 * Async version of customer configuration parsing that supports API key array initialization
 */
export async function parseCustomerConfigAsync(env: NewoEnvironment, verbose: boolean = false): Promise<MultiCustomerConfig> {
  
  // If using array-based config, initialize from API keys
  if (usesArrayBasedConfig(env)) {
    if (verbose) console.log('📝 Using array-based API key configuration');
    return await initializeCustomersFromApiKeys(env, verbose);
  }

  // Fall back to synchronous individual customer parsing
  if (verbose) console.log('📝 Using individual customer configuration');
  return parseCustomerConfig(env);
}

/**
 * List all available customer IDNs
 */
export function listCustomers(config: MultiCustomerConfig): string[] {
  return Object.keys(config.customers).sort();
}

/**
 * Get customer configuration by IDN
 */
export function getCustomer(config: MultiCustomerConfig, customerIdn: string): CustomerConfig | null {
  return config.customers[customerIdn] || null;
}

/**
 * Get default customer or throw error if none
 */
export function getDefaultCustomer(config: MultiCustomerConfig): CustomerConfig {
  if (config.defaultCustomer) {
    const customer = getCustomer(config, config.defaultCustomer);
    if (customer) return customer;
  }

  const customerIdns = listCustomers(config);
  if (customerIdns.length === 1) {
    const firstCustomerIdn = customerIdns[0];
    if (firstCustomerIdn) {
      return config.customers[firstCustomerIdn]!;
    }
  }

  if (customerIdns.length === 0) {
    throw new Error('No customers configured. Please set NEWO_API_KEYS or NEWO_CUSTOMER_[IDN]_API_KEY in your .env file.');
  }

  throw new Error(
    `Multiple customers configured but no default specified. Available: ${customerIdns.join(', ')}. ` +
    `Set NEWO_DEFAULT_CUSTOMER or use --customer flag.`
  );
}

/**
 * Attempt to get default customer, return null if multiple customers exist without default
 */
export function tryGetDefaultCustomer(config: MultiCustomerConfig): CustomerConfig | null {
  if (config.defaultCustomer) {
    const customer = getCustomer(config, config.defaultCustomer);
    if (customer) return customer;
  }

  const customerIdns = listCustomers(config);
  if (customerIdns.length === 1) {
    const firstCustomerIdn = customerIdns[0];
    if (firstCustomerIdn) {
      return config.customers[firstCustomerIdn]!;
    }
  }

  if (customerIdns.length === 0) {
    throw new Error('No customers configured. Please set NEWO_API_KEYS or NEWO_CUSTOMER_[IDN]_API_KEY in your .env file.');
  }

  // Return null if multiple customers exist without default (don't throw)
  return null;
}

/**
 * Get all customers as an array
 */
export function getAllCustomers(config: MultiCustomerConfig): CustomerConfig[] {
  return listCustomers(config).map(idn => getCustomer(config, idn)!);
}

/**
 * Validate customer configuration
 */
export function validateCustomerConfig(config: MultiCustomerConfig): void {
  const customers = listCustomers(config);
  
  if (customers.length === 0) {
    throw new Error('No customers configured. Please set NEWO_API_KEYS or NEWO_CUSTOMER_[IDN]_API_KEY in your .env file.');
  }
  
  for (const customerIdn of customers) {
    const customer = config.customers[customerIdn]!;
    if (!customer.apiKey) {
      throw new Error(`Customer ${customerIdn} missing API key`);
    }
  }
}