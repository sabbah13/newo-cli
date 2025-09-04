import { getCustomerProfile, makeClient } from './api.js';
import { exchangeApiKeyForToken } from './auth.js';
import type { NewoEnvironment, ApiKeyConfig, CustomerConfig, MultiCustomerConfig } from './types.js';

/**
 * Initialize customer configurations from API keys array
 */
export async function initializeCustomersFromApiKeys(
  env: NewoEnvironment,
  verbose: boolean = false
): Promise<MultiCustomerConfig> {
  if (!env.NEWO_API_KEYS) {
    throw new Error('NEWO_API_KEYS not set. Provide API keys array in .env file.');
  }

  let apiKeyConfigs: (string | ApiKeyConfig)[];
  
  try {
    apiKeyConfigs = JSON.parse(env.NEWO_API_KEYS);
  } catch (error) {
    throw new Error(`Invalid NEWO_API_KEYS format. Must be valid JSON array: ${error}`);
  }

  if (!Array.isArray(apiKeyConfigs)) {
    throw new Error('NEWO_API_KEYS must be an array');
  }

  const customers: Record<string, CustomerConfig> = {};

  if (verbose) console.log(`🔍 Initializing ${apiKeyConfigs.length} API keys...`);

  for (const [index, keyConfig] of apiKeyConfigs.entries()) {
    try {
      // Normalize config
      const apiKey = typeof keyConfig === 'string' ? keyConfig : keyConfig.key;
      const projectId = typeof keyConfig === 'object' ? keyConfig.project_id : undefined;

      if (verbose) console.log(`  [${index + 1}/${apiKeyConfigs.length}] Exchanging API key for token...`);

      // Create temporary customer config for token exchange
      const tempCustomer: CustomerConfig = { 
        idn: 'temp', 
        apiKey, 
        projectId 
      };

      // Exchange API key for token
      const tokens = await exchangeApiKeyForToken(tempCustomer);
      
      if (verbose) console.log(`  [${index + 1}/${apiKeyConfigs.length}] Getting customer profile...`);

      // Create client with token
      const client = await makeClient(verbose, tokens.access_token);

      // Get customer profile to extract IDN
      const profile = await getCustomerProfile(client);

      if (verbose) {
        console.log(`  [${index + 1}/${apiKeyConfigs.length}] ✓ Customer: ${profile.idn} (${profile.organization_name})`);
      }

      // Store customer config with real IDN
      customers[profile.idn] = {
        idn: profile.idn,
        apiKey,
        projectId
      };

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  [${index + 1}/${apiKeyConfigs.length}] ❌ Failed to initialize API key: ${message}`);
      // Continue with other keys rather than failing entirely
    }
  }

  const customerIdns = Object.keys(customers);
  
  if (customerIdns.length === 0) {
    throw new Error('No valid API keys found. Check your NEWO_API_KEYS configuration.');
  }

  if (verbose) {
    console.log(`✅ Initialized ${customerIdns.length} customers: ${customerIdns.join(', ')}`);
  }

  return {
    customers,
    defaultCustomer: env.NEWO_DEFAULT_CUSTOMER || (customerIdns.length === 1 ? customerIdns[0] : undefined)
  };
}

/**
 * Check if environment uses array-based configuration
 */
export function usesArrayBasedConfig(env: NewoEnvironment): boolean {
  return Boolean(env.NEWO_API_KEYS);
}