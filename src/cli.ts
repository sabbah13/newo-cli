#!/usr/bin/env node
/**
 * NEWO CLI - Main entry point using modular architecture
 */
import minimist from 'minimist';
import dotenv from 'dotenv';
import { initializeEnvironment, ENV } from './env.js';
import { parseAndValidateCustomerConfig } from './cli/customer-selection.js';
import { handleCliError, logCliError } from './cli/errors.js';
import { handlePullCommand } from './cli/commands/pull.js';
import { handlePushCommand } from './cli/commands/push.js';
import { handleStatusCommand } from './cli/commands/status.js';
import { handleConversationsCommand } from './cli/commands/conversations.js';
import { handleMetaCommand } from './cli/commands/meta.js';
import { handlePullAttributesCommand } from './cli/commands/pull-attributes.js';
import { handleImportAkbCommand } from './cli/commands/import-akb.js';
import { handleHelpCommand } from './cli/commands/help.js';
import { handleListCustomersCommand } from './cli/commands/list-customers.js';
import type { CliArgs, NewoApiError } from './types.js';

dotenv.config();

async function main(): Promise<void> {
  try {
    // Initialize and validate environment at startup
    initializeEnvironment();
  } catch (error: unknown) {
    console.error('Environment validation failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const args = minimist(process.argv.slice(2)) as CliArgs;
  const cmd = args._[0];
  const verbose = Boolean(args.verbose || args.v);

  if (verbose) console.log(`🔍 Command parsed: "${cmd}"`);

  // Handle help command first
  if (!cmd || ['help', '-h', '--help'].includes(cmd)) {
    handleHelpCommand();
    return;
  }

  // Handle list-customers command (doesn't need full customer config)
  if (cmd === 'list-customers') {
    try {
      const customerConfig = await parseAndValidateCustomerConfig(ENV as any, verbose);
      handleListCustomersCommand(customerConfig);
      return;
    } catch (error: unknown) {
      handleCliError(error, 'list-customers');
    }
  }

  // For all other commands, parse and validate customer configuration
  const customerConfig = await parseAndValidateCustomerConfig(ENV as any, verbose);

  if (verbose) console.log(`🔍 Starting command processing for: ${cmd}`);

  try {
    switch (cmd) {
      case 'pull':
        await handlePullCommand(customerConfig, args, verbose);
        break;

      case 'push':
        await handlePushCommand(customerConfig, args, verbose);
        break;

      case 'status':
        await handleStatusCommand(customerConfig, args, verbose);
        break;

      case 'conversations':
        await handleConversationsCommand(customerConfig, args, verbose);
        break;

      case 'meta':
        await handleMetaCommand(customerConfig, args, verbose);
        break;

      case 'pull-attributes':
        await handlePullAttributesCommand(customerConfig, args, verbose);
        break;

      case 'import-akb':
        await handleImportAkbCommand(customerConfig, args, verbose);
        break;

      default:
        console.error('Unknown command:', cmd);
        console.error('Run "newo --help" for usage information');
        process.exit(1);
    }
  } catch (error: unknown) {
    handleCliError(error, cmd);
  }
}

// Global error handler
process.on('unhandledRejection', (error: unknown) => {
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

// Start the CLI
main().catch((error: unknown) => {
  const args = process.argv.slice(2);
  const cmd = args.find(arg => !arg.startsWith('-')) || 'unknown command';
  handleCliError(error, cmd);
});