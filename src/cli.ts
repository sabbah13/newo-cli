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
import { handleCreateAgentCommand } from './cli/commands/create-agent.js';
import { handleDeleteAgentCommand } from './cli/commands/delete-agent.js';
import { handleCreateFlowCommand } from './cli/commands/create-flow.js';
import { handleDeleteFlowCommand } from './cli/commands/delete-flow.js';
import { handleCreateSkillCommand } from './cli/commands/create-skill.js';
import { handleDeleteSkillCommand } from './cli/commands/delete-skill.js';
import { handleCreateProjectCommand } from './cli/commands/create-project.js';
import { handleCreateEventCommand } from './cli/commands/create-event.js';
import { handleCreateStateCommand } from './cli/commands/create-state.js';
import { handleCreateParameterCommand } from './cli/commands/create-parameter.js';
import { handleCreatePersonaCommand } from './cli/commands/create-persona.js';
import { handleCreateAttributeCommand } from './cli/commands/create-attribute.js';
import { handleSandboxCommand } from './cli/commands/sandbox.js';
import { handlePullIntegrationsCommand } from './cli/commands/pull-integrations.js';
import { handlePushIntegrationsCommand } from './cli/commands/push-integrations.js';
import { handleListActionsCommand } from './cli/commands/list-actions.js';
import { handleProfileCommand } from './cli/commands/profile.js';
import { handlePullAkbCommand } from './cli/commands/pull-akb.js';
import { handlePushAkbCommand } from './cli/commands/push-akb.js';
import { handleMigrateAccountCommand } from './cli/commands/migrate-account.js';
import { handleVerifyMigrationCommand } from './cli/commands/verify-migration.js';
import { handleCreateWebhooksCommand } from './cli/commands/create-webhooks.js';
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
  const quiet = Boolean(args.quiet || args.q);

  // Set quiet mode flag EARLY to suppress auth logging
  if (quiet) {
    process.env.NEWO_QUIET_MODE = 'true';
  }

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

      case 'sandbox':
        await handleSandboxCommand(customerConfig, args, verbose);
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

      case 'create-agent':
        await handleCreateAgentCommand(customerConfig, args, verbose);
        break;

      case 'delete-agent':
        await handleDeleteAgentCommand(customerConfig, args, verbose);
        break;

      case 'create-flow':
        await handleCreateFlowCommand(customerConfig, args, verbose);
        break;

      case 'delete-flow':
        await handleDeleteFlowCommand(customerConfig, args, verbose);
        break;

      case 'create-skill':
        await handleCreateSkillCommand(customerConfig, args, verbose);
        break;

      case 'delete-skill':
        await handleDeleteSkillCommand(customerConfig, args, verbose);
        break;

      case 'create-project':
        await handleCreateProjectCommand(customerConfig, args, verbose);
        break;

      case 'create-event':
        await handleCreateEventCommand(customerConfig, args, verbose);
        break;

      case 'create-state':
        await handleCreateStateCommand(customerConfig, args, verbose);
        break;

      case 'create-parameter':
        await handleCreateParameterCommand(customerConfig, args, verbose);
        break;

      case 'create-persona':
        await handleCreatePersonaCommand(customerConfig, args, verbose);
        break;

      case 'create-attribute':
        await handleCreateAttributeCommand(customerConfig, args, verbose);
        break;

      case 'pull-integrations':
        await handlePullIntegrationsCommand(customerConfig, args, verbose);
        break;

      case 'push-integrations':
        await handlePushIntegrationsCommand(customerConfig, args, verbose);
        break;

      case 'list-actions':
        await handleListActionsCommand(customerConfig, args, verbose);
        break;

      case 'profile':
        await handleProfileCommand(customerConfig, args, verbose);
        break;

      case 'pull-akb':
        await handlePullAkbCommand(customerConfig, args, verbose);
        break;

      case 'push-akb':
        await handlePushAkbCommand(customerConfig, args, verbose);
        break;

      case 'migrate-account':
        await handleMigrateAccountCommand(customerConfig, args, verbose);
        break;

      case 'verify':
      case 'verify-migration':
        await handleVerifyMigrationCommand(customerConfig, args, verbose);
        break;

      case 'create-webhooks':
        await handleCreateWebhooksCommand(customerConfig, args, verbose);
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