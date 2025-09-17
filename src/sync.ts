/**
 * NEWO CLI Sync Operations - Modular architecture entry point
 */

// Re-export from specialized modules
export { saveCustomerAttributes } from './sync/attributes.js';
export { pullConversations } from './sync/conversations.js';
export { status } from './sync/status.js';
export { pullSingleProject, pullAll } from './sync/projects.js';
export { pushChanged } from './sync/push.js';
export { generateFlowsYaml } from './sync/metadata.js';

// Re-export type guards for backward compatibility
export { isProjectMap, isLegacyProjectMap } from './sync/projects.js';