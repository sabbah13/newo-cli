/**
 * Sync Strategies Module Exports
 *
 * This module exports all sync strategies that implement ISyncStrategy.
 * Each strategy handles synchronization for a specific resource type.
 */

// Core interface
export * from './ISyncStrategy.js';

// Project strategy (projects, agents, flows, skills)
export {
  ProjectSyncStrategy,
  createProjectSyncStrategy,
  type LocalProjectData,
  type LocalFlowData,
  type LocalSkillData
} from './ProjectSyncStrategy.js';

// Attribute strategy (customer and project attributes)
export {
  AttributeSyncStrategy,
  createAttributeSyncStrategy,
  type LocalAttributeData
} from './AttributeSyncStrategy.js';

// Integration strategy (integrations, connectors, webhooks)
export {
  IntegrationSyncStrategy,
  createIntegrationSyncStrategy,
  type LocalIntegrationData
} from './IntegrationSyncStrategy.js';

// AKB strategy (knowledge base articles)
export {
  AkbSyncStrategy,
  createAkbSyncStrategy,
  type LocalAkbData
} from './AkbSyncStrategy.js';

// Conversation strategy (conversation history - pull only)
export {
  ConversationSyncStrategy,
  createConversationSyncStrategy,
  type LocalConversationData
} from './ConversationSyncStrategy.js';
