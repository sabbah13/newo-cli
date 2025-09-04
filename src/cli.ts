#!/usr/bin/env node
import minimist from 'minimist';
import dotenv from 'dotenv';
import { makeClient, getProjectMeta, importAkbArticle } from './api.js';
import { pullAll, pushChanged, status } from './sync.js';
import { parseAkbFile, prepareArticlesForImport } from './akb.js';
import { initializeEnvironment, ENV, EnvValidationError } from './env.js';
import { parseCustomerConfigAsync, listCustomers, getCustomer, getDefaultCustomer, validateCustomerConfig } from './customerAsync.js';
import { getValidAccessToken } from './auth.js';
import path from 'path';
import type { CliArgs, NewoApiError, CustomerConfig } from './types.js';

dotenv.config();

async function main(): Promise<void> {
  try {
    // Initialize and validate environment at startup
    initializeEnvironment();
  } catch (error: unknown) {
    if (error instanceof EnvValidationError) {
      console.error('Environment validation failed:', error.message);
      process.exit(1);
    }
    throw error;
  }

  const args = minimist(process.argv.slice(2)) as CliArgs;
  const cmd = args._[0];
  const verbose = Boolean(args.verbose || args.v);
  
  // Parse customer configuration (async for API key array support)
  const customerConfig = await parseCustomerConfigAsync(ENV as any, verbose);
  validateCustomerConfig(customerConfig);
  
  // Handle customer selection
  let selectedCustomer: CustomerConfig;
  
  if (cmd === 'list-customers') {
    const customers = listCustomers(customerConfig);
    console.log('Available customers:');
    for (const customerIdn of customers) {
      const isDefault = customerConfig.defaultCustomer === customerIdn;
      console.log(`  ${customerIdn}${isDefault ? ' (default)' : ''}`);
    }
    return;
  }
  
  if (args.customer) {
    const customer = getCustomer(customerConfig, args.customer as string);
    if (!customer) {
      console.error(`Unknown customer: ${args.customer}`);
      console.error(`Available customers: ${listCustomers(customerConfig).join(', ')}`);
      process.exit(1);
    }
    selectedCustomer = customer;
  } else {
    try {
      selectedCustomer = getDefaultCustomer(customerConfig);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exit(1);
    }
  }

  if (!cmd || ['help', '-h', '--help'].includes(cmd)) {
    console.log(`NEWO CLI - Multi-Customer Support
Usage:
  newo pull [--customer <idn>]                  # download projects -> ./newo_customers/<idn>/projects/
  newo push [--customer <idn>]                  # upload modified *.guidance/*.jinja back to NEWO
  newo status [--customer <idn>]                # show modified files
  newo list-customers                           # list available customers
  newo meta [--customer <idn>]                  # get project metadata (debug)
  newo import-akb <file> <persona_id> [--customer <idn>]  # import AKB articles from file
  
Flags:
  --customer <idn>             # specify customer (if not set, uses default)
  --verbose, -v                # enable detailed logging
  
Environment Variables:
  NEWO_BASE_URL                                 # NEWO API base URL (default: https://app.newo.ai)
  NEWO_CUSTOMER_<IDN>_API_KEY                   # API key for customer <IDN>
  NEWO_CUSTOMER_<IDN>_PROJECT_ID               # Optional: specific project ID for customer
  NEWO_DEFAULT_CUSTOMER                        # Optional: default customer to use
  
Multi-Customer Examples:
  # Configure customers in .env:
  NEWO_CUSTOMER_acme_API_KEY=your_acme_api_key
  NEWO_CUSTOMER_globex_API_KEY=your_globex_api_key
  NEWO_DEFAULT_CUSTOMER=acme
  
  # Commands:
  newo pull --customer acme                    # Pull projects for Acme
  newo push --customer globex                  # Push changes for Globex
  newo status                                  # Status for default customer
  
File Structure:
  newo_customers/
  ├── acme/
  │   └── projects/
  │       └── project1/
  └── globex/
      └── projects/
          └── project2/
`);
    return;
  }

  // Get access token for the selected customer
  const accessToken = await getValidAccessToken(selectedCustomer);
  const client = await makeClient(verbose, accessToken);

  if (cmd === 'pull') {
    // Use customer-specific project ID if set, otherwise pull all projects
    const projectId = selectedCustomer.projectId || null;
    await pullAll(client, selectedCustomer, projectId, verbose);
  } else if (cmd === 'push') {
    await pushChanged(client, selectedCustomer, verbose);
  } else if (cmd === 'status') {
    await status(selectedCustomer, verbose);
  } else if (cmd === 'meta') {
    if (!selectedCustomer.projectId) {
      console.error(`No project ID configured for customer ${selectedCustomer.idn}`);
      console.error(`Set NEWO_CUSTOMER_${selectedCustomer.idn.toUpperCase()}_PROJECT_ID in your .env file`);
      process.exit(1);
    }
    const meta = await getProjectMeta(client, selectedCustomer.projectId);
    console.log(JSON.stringify(meta, null, 2));
  } else if (cmd === 'import-akb') {
    const akbFile = args._[1];
    const personaId = args._[2];
    
    if (!akbFile || !personaId) {
      console.error('Usage: newo import-akb <file> <persona_id>');
      console.error('Example: newo import-akb akb.txt da4550db-2b95-4500-91ff-fb4b60fe7be9');
      process.exit(1);
    }
    
    const filePath = path.resolve(akbFile);
    
    try {
      if (verbose) console.log(`📖 Parsing AKB file: ${filePath}`);
      const articles = await parseAkbFile(filePath);
      console.log(`✓ Parsed ${articles.length} articles from ${akbFile}`);
      
      if (verbose) console.log(`🔧 Preparing articles for persona: ${personaId}`);
      const preparedArticles = prepareArticlesForImport(articles, personaId);
      
      let successCount = 0;
      let errorCount = 0;
      
      console.log(`📤 Importing ${preparedArticles.length} articles...`);
      
      for (const [index, article] of preparedArticles.entries()) {
        try {
          if (verbose) {
            console.log(`  [${index + 1}/${preparedArticles.length}] Importing ${article.topic_name}...`);
          }
          await importAkbArticle(client, article);
          successCount++;
          if (!verbose) process.stdout.write('.');
        } catch (error: unknown) {
          errorCount++;
          const errorMessage = error instanceof Error && 'response' in error
            ? (error as NewoApiError)?.response?.data
            : error instanceof Error 
            ? error.message
            : String(error);
          console.error(`\n❌ Failed to import ${article.topic_name}:`, errorMessage);
        }
      }
      
      if (!verbose) console.log(''); // new line after dots
      console.log(`✅ Import complete: ${successCount} successful, ${errorCount} failed`);
      
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('❌ AKB import failed:', message);
      process.exit(1);
    }
  } else {
    console.error('Unknown command:', cmd);
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  const errorData = error instanceof Error && 'response' in error 
    ? (error as NewoApiError)?.response?.data 
    : error;
  console.error(errorData || error);
  process.exit(1);
});