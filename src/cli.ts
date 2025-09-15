#!/usr/bin/env node
import minimist from 'minimist';
import dotenv from 'dotenv';
import { makeClient, getProjectMeta, importAkbArticle } from './api.js';
import { pullAll, pushChanged, status, saveCustomerAttributes } from './sync.js';
import { parseAkbFile, prepareArticlesForImport } from './akb.js';
import { initializeEnvironment, ENV, EnvValidationError } from './env.js';
import { parseCustomerConfigAsync, listCustomers, getCustomer, getDefaultCustomer, tryGetDefaultCustomer, getAllCustomers, validateCustomerConfig } from './customerAsync.js';
import { getValidAccessToken } from './auth.js';
import path from 'path';
import type { CliArgs, NewoApiError, CustomerConfig } from './types.js';

// Enhanced error logging for CLI
function logCliError(level: 'error' | 'warn' | 'info', message: string, meta?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    module: 'cli',
    message,
    ...meta
  };
  
  // Only log JSON format in verbose mode, otherwise use clean user messages
  const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');
  
  if (verbose) {
    if (level === 'error') {
      console.error(JSON.stringify(logEntry));
    } else if (level === 'warn') {
      console.warn(JSON.stringify(logEntry));
    } else {
      console.log(JSON.stringify(logEntry));
    }
  } else {
    // Clean user-facing messages
    if (level === 'error') {
      console.error(`❌ ${message}`);
    } else if (level === 'warn') {
      console.warn(`⚠️  ${message}`);
    } else {
      console.log(`ℹ️  ${message}`);
    }
  }
}

// Enhanced error handling with user-friendly messages  
function handleCliError(error: unknown, operation: string = 'operation'): never {
  const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');
  
  if (error instanceof Error) {
    // Authentication errors
    if (error.message.includes('API key') || error.message.includes('Authentication failed')) {
      logCliError('error', 'Authentication failed. Please check your API key configuration.');
      if (!verbose) {
        console.error('\n💡 Troubleshooting tips:');
        console.error('  • Verify your API key is correct in .env file');
        console.error('  • For multi-customer setup, check NEWO_CUSTOMER_<IDN>_API_KEY');
        console.error('  • Run with --verbose for detailed error information');
      }
    }
    // Network errors
    else if (error.message.includes('Network timeout') || error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
      logCliError('error', 'Network connection failed. Please check your internet connection.');
      if (!verbose) {
        console.error('\n💡 Troubleshooting tips:');
        console.error('  • Check your internet connection');
        console.error('  • Verify NEWO_BASE_URL is correct');
        console.error('  • Try again in a few moments');
      }
    }
    // Environment configuration errors
    else if (error instanceof EnvValidationError || error.message.includes('not set')) {
      logCliError('error', 'Configuration error. Please check your environment setup.');
      if (!verbose) {
        console.error('\n💡 Setup help:');
        console.error('  • Copy .env.example to .env and configure your settings');
        console.error('  • Run "newo --help" to see configuration examples');
        console.error('  • Check the README for detailed setup instructions');
      }
    }
    // File system errors
    else if (error.message.includes('ENOENT') || error.message.includes('EACCES')) {
      logCliError('error', 'File system error. Please check file permissions and paths.');
    }
    // Rate limiting
    else if (error.message.includes('Rate limit exceeded')) {
      logCliError('error', 'Rate limit exceeded. Please wait before trying again.');
    }
    // General API errors
    else if (error.message.includes('response') || error.message.includes('status')) {
      logCliError('error', `API error during ${operation}. Please try again or contact support.`);
    }
    // Unknown errors
    else {
      logCliError('error', `Unexpected error during ${operation}: ${error.message}`);
      if (!verbose) {
        console.error('\n💡 For more details, run the command with --verbose flag');
      }
    }
    
    if (verbose) {
      logCliError('error', 'Full error details', { 
        operation,
        errorType: error.constructor.name,
        stack: error.stack?.split('\n').slice(0, 5).join('\n') // First 5 lines of stack
      });
    }
  } else {
    logCliError('error', `Unknown error during ${operation}: ${String(error)}`);
  }
  
  process.exit(1);
}

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
  let customerConfig;
  try {
    customerConfig = await parseCustomerConfigAsync(ENV as any, verbose);
    validateCustomerConfig(customerConfig);
  } catch (error: unknown) {
    logCliError('error', 'Failed to parse customer configuration');
    if (error instanceof Error) {
      logCliError('error', error.message);
    }
    process.exit(1);
  }
  
  // Handle customer selection
  let selectedCustomer: CustomerConfig | null = null;
  let allCustomers: CustomerConfig[] = [];

  if (cmd === 'list-customers') {
    const customers = listCustomers(customerConfig);
    console.log('Available customers:');
    for (const customerIdn of customers) {
      const isDefault = customerConfig.defaultCustomer === customerIdn;
      console.log(`  ${customerIdn}${isDefault ? ' (default)' : ''}`);
    }
    return;
  }

  // Customer selection logic moved inside command processing to avoid early failures

  if (verbose) console.log(`🔍 Command parsed: "${cmd}"`);

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
  --customer <idn>             # specify customer (if not set, uses default or interactive selection)
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
  newo pull                                    # Pull from all customers (if no default set)
  newo pull --customer acme                    # Pull projects for Acme only
  newo status                                  # Status for all customers (if no default set)
  newo push                                    # Interactive selection for multiple customers
  newo push --customer globex                  # Push changes for Globex only

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

  if (verbose) console.log(`🔍 Starting command processing for: ${cmd}`);

  if (cmd === 'pull') {
    // Handle customer selection for pull command
    if (args.customer) {
      const customer = getCustomer(customerConfig, args.customer as string);
      if (!customer) {
        console.error(`Unknown customer: ${args.customer}`);
        console.error(`Available customers: ${listCustomers(customerConfig).join(', ')}`);
        process.exit(1);
      }
      selectedCustomer = customer;
    } else {
      // Try to get default, fall back to all customers
      selectedCustomer = tryGetDefaultCustomer(customerConfig);
      if (!selectedCustomer) {
        allCustomers = getAllCustomers(customerConfig);
        if (verbose) console.log(`📥 No default customer specified, pulling from all ${allCustomers.length} customers`);
      }
    }

    if (selectedCustomer) {
      // Single customer pull
      const accessToken = await getValidAccessToken(selectedCustomer);
      const client = await makeClient(verbose, accessToken);
      const projectId = selectedCustomer.projectId || null;
      await pullAll(client, selectedCustomer, projectId, verbose);
    } else if (allCustomers.length > 0) {
      // Multi-customer pull
      console.log(`🔄 Pulling from ${allCustomers.length} customers...`);
      for (const customer of allCustomers) {
        console.log(`\n📥 Pulling from customer: ${customer.idn}`);
        const accessToken = await getValidAccessToken(customer);
        const client = await makeClient(verbose, accessToken);
        const projectId = customer.projectId || null;
        await pullAll(client, customer, projectId, verbose);
      }
      console.log(`\n✅ Pull completed for all ${allCustomers.length} customers`);
    }
    return;
  }

  if (cmd === 'status') {
    // Handle customer selection for status command
    if (args.customer) {
      const customer = getCustomer(customerConfig, args.customer as string);
      if (!customer) {
        console.error(`Unknown customer: ${args.customer}`);
        console.error(`Available customers: ${listCustomers(customerConfig).join(', ')}`);
        process.exit(1);
      }
      selectedCustomer = customer;
    } else {
      // Try to get default, fall back to all customers
      selectedCustomer = tryGetDefaultCustomer(customerConfig);
      if (!selectedCustomer) {
        allCustomers = getAllCustomers(customerConfig);
        console.log(`🔄 Checking status for ${allCustomers.length} customers...`);
      }
    }

    if (selectedCustomer) {
      // Single customer status
      await status(selectedCustomer, verbose);
    } else if (allCustomers.length > 0) {
      // Multi-customer status
      for (const customer of allCustomers) {
        console.log(`\n📋 Status for customer: ${customer.idn}`);
        await status(customer, verbose);
      }
      console.log(`\n✅ Status check completed for all ${allCustomers.length} customers`);
    }
    return;
  }

  if (cmd === 'push') {
    // Handle customer selection for push command
    if (args.customer) {
      const customer = getCustomer(customerConfig, args.customer as string);
      if (!customer) {
        console.error(`Unknown customer: ${args.customer}`);
        console.error(`Available customers: ${listCustomers(customerConfig).join(', ')}`);
        process.exit(1);
      }
      selectedCustomer = customer;
    } else {
      // Try to get default, provide interactive selection if multiple exist
      selectedCustomer = tryGetDefaultCustomer(customerConfig);
      if (!selectedCustomer) {
        // Multiple customers exist with no default, ask user
        allCustomers = getAllCustomers(customerConfig);
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
        } else if (choiceNum >= 1 && choiceNum <= allCustomers.length) {
          // User selected specific customer
          selectedCustomer = allCustomers[choiceNum - 1] || null;
          allCustomers = []; // Clear to indicate single customer mode
          if (selectedCustomer) {
            console.log(`🔄 Pushing to customer: ${selectedCustomer.idn}`);
          }
        } else {
          console.error('Invalid choice. Exiting.');
          process.exit(1);
        }
      }
    }

    if (selectedCustomer) {
      // Single customer push
      const accessToken = await getValidAccessToken(selectedCustomer);
      const client = await makeClient(verbose, accessToken);
      await pushChanged(client, selectedCustomer, verbose);
    } else if (allCustomers.length > 0) {
      // Multi-customer push (user selected "All customers")
      console.log(`🔄 Pushing to ${allCustomers.length} customers...`);
      for (const customer of allCustomers) {
        console.log(`\n📤 Pushing for customer: ${customer.idn}`);
        const accessToken = await getValidAccessToken(customer);
        const client = await makeClient(verbose, accessToken);
        await pushChanged(client, customer, verbose);
      }
      console.log(`\n✅ Push completed for all ${allCustomers.length} customers`);
    }
    return;
  }

  // For all other commands, require a single selected customer
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

  if (!selectedCustomer) {
    console.error('Customer selection required for this command');
    process.exit(1);
  }

  // Get access token for the selected customer
  const accessToken = await getValidAccessToken(selectedCustomer);
  const client = await makeClient(verbose, accessToken);

  if (cmd === 'meta') {
    if (!selectedCustomer.projectId) {
      console.error(`No project ID configured for customer ${selectedCustomer.idn}`);
      console.error(`Set NEWO_CUSTOMER_${selectedCustomer.idn.toUpperCase()}_PROJECT_ID in your .env file`);
      process.exit(1);
    }
    const meta = await getProjectMeta(client, selectedCustomer.projectId);
    console.log(JSON.stringify(meta, null, 2));
  } else if (cmd === 'pull-attributes') {
    console.log(`🔍 Fetching customer attributes for ${selectedCustomer.idn}...`);
    await saveCustomerAttributes(client, selectedCustomer, verbose);
    console.log(`✅ Customer attributes saved to newo_customers/${selectedCustomer.idn}/attributes.yaml`);
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
  // Determine operation context from command line args
  const args = process.argv.slice(2);
  const cmd = args.find(arg => !arg.startsWith('-')) || 'unknown command';
  
  // Handle API errors with specific data
  if (error instanceof Error && 'response' in error) {
    const apiError = error as NewoApiError;
    const responseData = apiError.response?.data;
    const status = apiError.response?.status;
    
    if (responseData && status) {
      logCliError('error', `API error (${status}): ${JSON.stringify(responseData)}`);
    }
  }
  
  handleCliError(error, cmd);
});