/**
 * Dependency Injection Tokens
 *
 * These symbols are used as unique identifiers for services in the DI container.
 * Using symbols ensures no naming conflicts.
 */

// Infrastructure Layer
export const TOKENS = {
  // Logging
  LOGGER: Symbol('Logger'),

  // Auth
  AUTH_SERVICE: Symbol('AuthService'),

  // API Client
  API_CLIENT: Symbol('ApiClient'),
  API_CLIENT_FACTORY: Symbol('ApiClientFactory'),

  // File System
  FILE_SYSTEM: Symbol('FileSystem'),
  HASH_MANAGER: Symbol('HashManager'),
  METADATA_GENERATOR: Symbol('MetadataGenerator'),

  // Repositories
  PROJECT_REPOSITORY: Symbol('ProjectRepository'),
  INTEGRATION_REPOSITORY: Symbol('IntegrationRepository'),
  AKB_REPOSITORY: Symbol('AkbRepository'),
  ATTRIBUTE_REPOSITORY: Symbol('AttributeRepository'),
  CONVERSATION_REPOSITORY: Symbol('ConversationRepository'),

  // Domain Layer - Sync Strategies
  PROJECT_SYNC_STRATEGY: Symbol('ProjectSyncStrategy'),
  INTEGRATION_SYNC_STRATEGY: Symbol('IntegrationSyncStrategy'),
  AKB_SYNC_STRATEGY: Symbol('AkbSyncStrategy'),
  ATTRIBUTE_SYNC_STRATEGY: Symbol('AttributeSyncStrategy'),
  CONVERSATION_SYNC_STRATEGY: Symbol('ConversationSyncStrategy'),

  // Domain Layer - Entity Strategies
  PROJECT_ENTITY_STRATEGY: Symbol('ProjectEntityStrategy'),
  AGENT_ENTITY_STRATEGY: Symbol('AgentEntityStrategy'),
  FLOW_ENTITY_STRATEGY: Symbol('FlowEntityStrategy'),
  SKILL_ENTITY_STRATEGY: Symbol('SkillEntityStrategy'),

  // Application Layer - Engines
  SYNC_ENGINE: Symbol('SyncEngine'),
  MIGRATION_ENGINE: Symbol('MigrationEngine'),
  ENTITY_MANAGER: Symbol('EntityManager'),

  // Application Layer - Use Cases
  PULL_USE_CASE: Symbol('PullUseCase'),
  PUSH_USE_CASE: Symbol('PushUseCase'),
  STATUS_USE_CASE: Symbol('StatusUseCase'),
  MIGRATE_USE_CASE: Symbol('MigrateUseCase'),
  CREATE_ENTITY_USE_CASE: Symbol('CreateEntityUseCase'),
  DELETE_ENTITY_USE_CASE: Symbol('DeleteEntityUseCase'),

  // CLI Layer
  COMMAND_REGISTRY: Symbol('CommandRegistry'),
  COMMAND_EXECUTOR: Symbol('CommandExecutor'),
  ERROR_HANDLER: Symbol('ErrorHandler'),
  CUSTOMER_SELECTOR: Symbol('CustomerSelector'),

  // Configuration
  CUSTOMER_CONFIG: Symbol('CustomerConfig'),
  ENVIRONMENT: Symbol('Environment'),
} as const;

/**
 * Type for the tokens object
 */
export type TokenKey = keyof typeof TOKENS;
export type Token = (typeof TOKENS)[TokenKey];

/**
 * Resource types for selective sync
 * These match the resourceType property in each ISyncStrategy implementation
 */
export const RESOURCE_TYPES = {
  PROJECTS: 'projects',
  ATTRIBUTES: 'attributes',
  INTEGRATIONS: 'integrations',
  AKB: 'akb',
  CONVERSATIONS: 'conversations',
} as const;

/**
 * All available resource types for sync operations
 */
export const ALL_RESOURCE_TYPES = Object.values(RESOURCE_TYPES);

/**
 * Type for resource type values
 */
export type ResourceType = (typeof RESOURCE_TYPES)[keyof typeof RESOURCE_TYPES];
