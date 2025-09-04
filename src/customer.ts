import type { NewoEnvironment, CustomerConfig, MultiCustomerConfig } from './types.js';

/**
 * Parse environment variables to extract customer configurations
 * Supports both array-based (NEWO_API_KEYS) and individual customer configs
 */
export function parseCustomerConfig(env: NewoEnvironment): MultiCustomerConfig {
  const customers: Record<string, CustomerConfig> = {};
  
  // Parse customer-specific API keys
  // Format: NEWO_CUSTOMER_[IDN]_API_KEY=api_key
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('NEWO_CUSTOMER_') && key.endsWith('_API_KEY') && value) {
      const idn = key.slice('NEWO_CUSTOMER_'.length, -'_API_KEY'.length).toLowerCase();
      
      if (!customers[idn]) {
        customers[idn] = { idn, apiKey: value };
      } else {
        customers[idn].apiKey = value;
      }
      
      // Check for corresponding project ID
      const projectIdKey = `NEWO_CUSTOMER_${idn.toUpperCase()}_PROJECT_ID`;
      if (env[projectIdKey]) {
        customers[idn].projectId = env[projectIdKey];
      }
    }
  }
  
  // Check for legacy single customer mode
  if (env.NEWO_API_KEY && Object.keys(customers).length === 0) {
    customers['default'] = { 
      idn: 'default', 
      apiKey: env.NEWO_API_KEY,
      projectId: env.NEWO_PROJECT_ID
    };
  }
  
  return {
    customers,
    defaultCustomer: env.NEWO_DEFAULT_CUSTOMER || (Object.keys(customers).length === 1 ? Object.keys(customers)[0] : undefined)
  };
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
    throw new Error('No customers configured. Please set NEWO_CUSTOMER_[IDN]_API_KEY in your .env file.');
  }
  
  throw new Error(
    `Multiple customers configured but no default specified. Available: ${customerIdns.join(', ')}. ` +
    `Set NEWO_DEFAULT_CUSTOMER or use --customer flag.`
  );
}

/**
 * Validate customer configuration
 */
export function validateCustomerConfig(config: MultiCustomerConfig): void {
  const customers = listCustomers(config);
  
  if (customers.length === 0) {
    throw new Error('No customers configured. Please set NEWO_CUSTOMER_[IDN]_API_KEY in your .env file.');
  }
  
  for (const customerIdn of customers) {
    const customer = config.customers[customerIdn]!;
    if (!customer.apiKey) {
      throw new Error(`Customer ${customerIdn} missing API key`);
    }
  }
}