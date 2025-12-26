/**
 * Bootstrap - Application Initialization and DI Setup
 *
 * This file wires all dependencies together and creates the service container.
 * It's the single entry point for configuring the application.
 */

import { ServiceContainer } from './di/Container.js';
import { TOKENS } from './di/tokens.js';
import { ConsoleLogger, type ILogger, type CustomerConfig, type MultiCustomerConfig } from '../domain/resources/common/types.js';
import { SyncEngine, type SyncEngineOptions } from '../application/sync/SyncEngine.js';
import { MigrationEngine, TransformService } from '../application/migration/MigrationEngine.js';
import { ProjectSyncStrategy, createProjectSyncStrategy } from '../domain/strategies/sync/ProjectSyncStrategy.js';
import { AttributeSyncStrategy, createAttributeSyncStrategy } from '../domain/strategies/sync/AttributeSyncStrategy.js';
import { IntegrationSyncStrategy, createIntegrationSyncStrategy } from '../domain/strategies/sync/IntegrationSyncStrategy.js';
import { AkbSyncStrategy, createAkbSyncStrategy } from '../domain/strategies/sync/AkbSyncStrategy.js';
import { ConversationSyncStrategy, createConversationSyncStrategy } from '../domain/strategies/sync/ConversationSyncStrategy.js';
import type { ISyncStrategy } from '../domain/strategies/sync/ISyncStrategy.js';
import type { AxiosInstance } from 'axios';
import { makeClient } from '../api.js';
import { getValidAccessToken } from '../auth.js';

/**
 * API Client Factory that creates authenticated clients
 */
export async function createApiClient(customer: CustomerConfig, verbose: boolean): Promise<AxiosInstance> {
  // Set environment variables for the customer
  process.env.NEWO_API_KEY = customer.apiKey;
  if (customer.projectId) {
    process.env.NEWO_PROJECT_ID = customer.projectId;
  }

  const token = await getValidAccessToken();
  return makeClient(verbose, token);
}

/**
 * Bootstrap options
 */
export interface BootstrapOptions {
  /**
   * Enable verbose logging
   */
  verbose?: boolean;

  /**
   * Sync engine options
   */
  syncEngineOptions?: SyncEngineOptions;
}

/**
 * Create and configure the service container
 */
export function createServiceContainer(
  customerConfig: MultiCustomerConfig,
  options: BootstrapOptions = {}
): ServiceContainer {
  const container = new ServiceContainer();
  const verbose = options.verbose ?? false;

  // === Infrastructure Layer ===

  // Logger
  const logger = new ConsoleLogger(verbose);
  container.registerValue(TOKENS.LOGGER, logger);

  // Customer Config
  container.registerValue(TOKENS.CUSTOMER_CONFIG, customerConfig);

  // API Client Factory
  container.registerValue(TOKENS.API_CLIENT_FACTORY, createApiClient);

  // === Domain Layer - Sync Strategies ===

  // Project Sync Strategy
  container.registerSingleton(TOKENS.PROJECT_SYNC_STRATEGY, () =>
    createProjectSyncStrategy(createApiClient, container.get<ILogger>(TOKENS.LOGGER))
  );

  // Attribute Sync Strategy
  container.registerSingleton(TOKENS.ATTRIBUTE_SYNC_STRATEGY, () =>
    createAttributeSyncStrategy(createApiClient, container.get<ILogger>(TOKENS.LOGGER))
  );

  // Integration Sync Strategy
  container.registerSingleton(TOKENS.INTEGRATION_SYNC_STRATEGY, () =>
    createIntegrationSyncStrategy(createApiClient, container.get<ILogger>(TOKENS.LOGGER))
  );

  // AKB Sync Strategy
  container.registerSingleton(TOKENS.AKB_SYNC_STRATEGY, () =>
    createAkbSyncStrategy(createApiClient, container.get<ILogger>(TOKENS.LOGGER))
  );

  // Conversation Sync Strategy
  container.registerSingleton(TOKENS.CONVERSATION_SYNC_STRATEGY, () =>
    createConversationSyncStrategy(createApiClient, container.get<ILogger>(TOKENS.LOGGER))
  );

  // === Application Layer ===

  // Sync Engine (uses all sync strategies)
  container.registerSingleton(TOKENS.SYNC_ENGINE, () => {
    const strategies: ISyncStrategy[] = [
      container.get<ProjectSyncStrategy>(TOKENS.PROJECT_SYNC_STRATEGY),
      container.get<AttributeSyncStrategy>(TOKENS.ATTRIBUTE_SYNC_STRATEGY),
      container.get<IntegrationSyncStrategy>(TOKENS.INTEGRATION_SYNC_STRATEGY),
      container.get<AkbSyncStrategy>(TOKENS.AKB_SYNC_STRATEGY),
      container.get<ConversationSyncStrategy>(TOKENS.CONVERSATION_SYNC_STRATEGY),
    ];

    return new SyncEngine(strategies, container.get<ILogger>(TOKENS.LOGGER), options.syncEngineOptions);
  });

  // Migration Engine (uses SyncEngine)
  container.registerSingleton(TOKENS.MIGRATION_ENGINE, () => {
    const syncEngine = container.get<SyncEngine>(TOKENS.SYNC_ENGINE);
    const transformService = new TransformService(container.get<ILogger>(TOKENS.LOGGER));
    return new MigrationEngine(syncEngine, transformService, container.get<ILogger>(TOKENS.LOGGER));
  });

  return container;
}

/**
 * Get SyncEngine from container
 */
export function getSyncEngine(container: ServiceContainer): SyncEngine {
  return container.get<SyncEngine>(TOKENS.SYNC_ENGINE);
}

/**
 * Get MigrationEngine from container
 */
export function getMigrationEngine(container: ServiceContainer): MigrationEngine {
  return container.get<MigrationEngine>(TOKENS.MIGRATION_ENGINE);
}

/**
 * Get Logger from container
 */
export function getLogger(container: ServiceContainer): ILogger {
  return container.get<ILogger>(TOKENS.LOGGER);
}

/**
 * Quick setup for CLI commands
 *
 * Creates a configured container with all services ready to use.
 */
export function setupCli(
  customerConfig: MultiCustomerConfig,
  verbose: boolean = false
): {
  container: ServiceContainer;
  syncEngine: SyncEngine;
  migrationEngine: MigrationEngine;
  logger: ILogger;
} {
  const container = createServiceContainer(customerConfig, { verbose });

  return {
    container,
    syncEngine: getSyncEngine(container),
    migrationEngine: getMigrationEngine(container),
    logger: getLogger(container)
  };
}

/**
 * Adapter function for legacy pull command
 *
 * This provides backward compatibility with the existing CLI.
 */
export async function legacyPullAdapter(
  customerConfig: MultiCustomerConfig,
  customer: CustomerConfig,
  verbose: boolean,
  silentOverwrite: boolean
): Promise<void> {
  const { syncEngine } = setupCli(customerConfig, verbose);

  await syncEngine.pullAll(customer, {
    silentOverwrite,
    verbose
  });
}

/**
 * Adapter function for legacy push command
 */
export async function legacyPushAdapter(
  customerConfig: MultiCustomerConfig,
  customer: CustomerConfig,
  verbose: boolean
): Promise<void> {
  const { syncEngine } = setupCli(customerConfig, verbose);

  await syncEngine.pushAll(customer);
}

/**
 * Adapter function for legacy status command
 */
export async function legacyStatusAdapter(
  customerConfig: MultiCustomerConfig,
  customer: CustomerConfig,
  verbose: boolean
): Promise<void> {
  const { syncEngine, logger } = setupCli(customerConfig, verbose);

  const status = await syncEngine.getStatus(customer);

  logger.info(`\nStatus for customer: ${status.customer}`);
  logger.info(`Total changes: ${status.totalChanges}\n`);

  for (const resource of status.resources) {
    if (resource.changedCount > 0) {
      logger.info(`${resource.displayName}: ${resource.changedCount} change(s)`);
      for (const change of resource.changes) {
        logger.info(`  ${change.operation.toUpperCase()[0]} ${change.path}`);
      }
    }
  }

  if (status.totalChanges === 0) {
    logger.info('No changes to push.');
  }
}

/**
 * Adapter function for legacy migrate command
 */
export async function legacyMigrateAdapter(
  customerConfig: MultiCustomerConfig,
  sourceCustomer: CustomerConfig,
  destCustomer: CustomerConfig,
  sourceClient: AxiosInstance,
  destClient: AxiosInstance,
  verbose: boolean
): Promise<void> {
  const { migrationEngine } = setupCli(customerConfig, verbose);

  await migrationEngine.migrateAccount(
    sourceCustomer,
    destCustomer,
    sourceClient,
    destClient,
    { verbose }
  );
}
