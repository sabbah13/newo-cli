/**
 * Generic Sync Strategy Interface
 *
 * All resource types (Projects, Integrations, AKB, Attributes) implement this interface.
 * This enables the SyncEngine to handle all resources uniformly.
 */

import type { CustomerConfig } from '../../resources/common/types.js';

/**
 * Validation result for pre-sync validation
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  field: string;
  message: string;
  path?: string;
}

/**
 * Change operation types
 */
export type ChangeOperation = 'created' | 'modified' | 'deleted';

/**
 * Generic change item representing a resource change
 */
export interface ChangeItem<T = unknown> {
  item: T;
  operation: ChangeOperation;
  path: string;
}

/**
 * Pull result containing resources and metadata
 */
export interface PullResult<T = unknown> {
  items: T[];
  count: number;
  hashes: Record<string, string>;
}

/**
 * Push result containing operation outcomes
 */
export interface PushResult {
  created: number;
  updated: number;
  deleted: number;
  errors: string[];
}

/**
 * Generic Sync Strategy Interface
 *
 * TRemote - Type from the API (e.g., API response types)
 * TLocal - Type for local storage (e.g., YAML/JSON file types)
 */
export interface ISyncStrategy<_TRemote = unknown, TLocal = unknown> {
  /**
   * Resource type identifier (e.g., 'projects', 'integrations', 'akb', 'attributes')
   */
  readonly resourceType: string;

  /**
   * Display name for logging/UI (e.g., 'Projects', 'Integrations')
   */
  readonly displayName: string;

  /**
   * Pull resources from NEWO platform to local filesystem
   *
   * @param customer - Customer configuration
   * @param options - Optional pull options
   * @returns Pull result with items and hashes
   */
  pull(customer: CustomerConfig, options?: PullOptions): Promise<PullResult<TLocal>>;

  /**
   * Push local changes to NEWO platform
   *
   * @param customer - Customer configuration
   * @param changes - Changes to push (if not provided, detect changes automatically)
   * @returns Push result with counts
   */
  push(customer: CustomerConfig, changes?: ChangeItem<TLocal>[]): Promise<PushResult>;

  /**
   * Detect what has changed locally since last sync
   *
   * @param customer - Customer configuration
   * @returns Array of changed items
   */
  getChanges(customer: CustomerConfig): Promise<ChangeItem<TLocal>[]>;

  /**
   * Validate local state before push
   *
   * @param customer - Customer configuration
   * @param items - Items to validate
   * @returns Validation result
   */
  validate(customer: CustomerConfig, items: TLocal[]): Promise<ValidationResult>;

  /**
   * Get status summary for display
   *
   * @param customer - Customer configuration
   * @returns Status summary
   */
  getStatus(customer: CustomerConfig): Promise<StatusSummary>;
}

/**
 * Pull operation options
 */
export interface PullOptions {
  /**
   * Overwrite local changes without prompting
   */
  silentOverwrite?: boolean;

  /**
   * Enable verbose logging
   */
  verbose?: boolean;

  /**
   * Specific project ID to pull (for projects strategy)
   */
  projectId?: string | null;

  /**
   * Skip deletion detection and cleanup
   */
  skipCleanup?: boolean;
}

/**
 * Status summary for a resource type
 */
export interface StatusSummary {
  resourceType: string;
  displayName: string;
  changedCount: number;
  changes: Array<{
    path: string;
    operation: ChangeOperation;
    details?: string;
  }>;
}

/**
 * Abstract base class with common strategy functionality
 */
export abstract class BaseSyncStrategy<TRemote = unknown, TLocal = unknown> implements ISyncStrategy<TRemote, TLocal> {
  abstract readonly resourceType: string;
  abstract readonly displayName: string;

  abstract pull(customer: CustomerConfig, options?: PullOptions): Promise<PullResult<TLocal>>;
  abstract push(customer: CustomerConfig, changes?: ChangeItem<TLocal>[]): Promise<PushResult>;
  abstract getChanges(customer: CustomerConfig): Promise<ChangeItem<TLocal>[]>;
  abstract validate(customer: CustomerConfig, items: TLocal[]): Promise<ValidationResult>;

  async getStatus(customer: CustomerConfig): Promise<StatusSummary> {
    const changes = await this.getChanges(customer);

    return {
      resourceType: this.resourceType,
      displayName: this.displayName,
      changedCount: changes.length,
      changes: changes.map(c => ({
        path: c.path,
        operation: c.operation
      }))
    };
  }
}
