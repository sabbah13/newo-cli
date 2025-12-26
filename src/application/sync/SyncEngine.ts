/**
 * SyncEngine - Core synchronization orchestrator
 *
 * This is the central engine that coordinates sync operations across all resource types.
 * It uses the Strategy pattern to handle different resources uniformly.
 *
 * Key benefits:
 * - One engine handles projects, integrations, AKB, attributes, conversations
 * - Adding new resource = implement one strategy class
 * - No duplicate pull/push logic
 * - Easy to test (mock strategies)
 */

import type {
  ISyncStrategy,
  PullOptions,
  PullResult,
  PushResult,
  StatusSummary,
  ValidationResult
} from '../../domain/strategies/sync/ISyncStrategy.js';
import type { CustomerConfig, ILogger } from '../../domain/resources/common/types.js';

/**
 * Combined pull result from all strategies
 */
export interface SyncPullResult {
  customer: string;
  resources: Array<{
    resourceType: string;
    displayName: string;
    result: PullResult;
  }>;
  totalItems: number;
  errors: string[];
}

/**
 * Combined push result from all strategies
 */
export interface SyncPushResult {
  customer: string;
  resources: Array<{
    resourceType: string;
    displayName: string;
    result: PushResult;
  }>;
  totalCreated: number;
  totalUpdated: number;
  totalDeleted: number;
  errors: string[];
}

/**
 * Status report for all resources
 */
export interface StatusReport {
  customer: string;
  resources: StatusSummary[];
  totalChanges: number;
}

/**
 * Sync error with context
 */
export class SyncError extends Error {
  constructor(
    message: string,
    public resourceType: string,
    public override cause?: Error
  ) {
    super(message);
    this.name = 'SyncError';
  }
}

/**
 * Validation error with details
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    public results: ValidationResult[]
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * SyncEngine Options
 */
export interface SyncEngineOptions {
  /**
   * Stop on first error instead of continuing
   */
  stopOnError?: boolean;

  /**
   * Run strategies in parallel where possible
   */
  parallel?: boolean;
}

/**
 * SyncEngine - Generic synchronization orchestrator
 *
 * Orchestrates pull/push/status operations across all registered strategies.
 */
export class SyncEngine {
  private strategies: Map<string, ISyncStrategy> = new Map();

  constructor(
    strategies: ISyncStrategy[],
    private logger: ILogger,
    private options: SyncEngineOptions = {}
  ) {
    for (const strategy of strategies) {
      this.strategies.set(strategy.resourceType, strategy);
    }
  }

  /**
   * Register a new strategy
   */
  registerStrategy(strategy: ISyncStrategy): void {
    this.strategies.set(strategy.resourceType, strategy);
  }

  /**
   * Get a specific strategy by resource type
   */
  getStrategy(resourceType: string): ISyncStrategy | undefined {
    return this.strategies.get(resourceType);
  }

  /**
   * Get all registered strategies
   */
  getStrategies(): ISyncStrategy[] {
    return Array.from(this.strategies.values());
  }

  /**
   * Pull ALL resources using registered strategies
   */
  async pullAll(customer: CustomerConfig, options: PullOptions = {}): Promise<SyncPullResult> {
    this.logger.info(`📥 Pulling all resources for customer: ${customer.idn}`);

    const result: SyncPullResult = {
      customer: customer.idn,
      resources: [],
      totalItems: 0,
      errors: []
    };

    const strategies = Array.from(this.strategies.values());

    if (this.options.parallel) {
      // Parallel execution
      const pullPromises = strategies.map(async (strategy) => {
        try {
          return await this.pullWithStrategy(strategy, customer, options);
        } catch (error) {
          const message = `Failed to pull ${strategy.displayName}: ${error instanceof Error ? error.message : String(error)}`;
          if (this.options.stopOnError) {
            throw new SyncError(message, strategy.resourceType, error instanceof Error ? error : undefined);
          }
          result.errors.push(message);
          return null;
        }
      });

      const pullResults = await Promise.all(pullPromises);

      for (const pullResult of pullResults) {
        if (pullResult) {
          result.resources.push(pullResult);
          result.totalItems += pullResult.result.count;
        }
      }
    } else {
      // Sequential execution
      for (const strategy of strategies) {
        this.logger.info(`  📦 Pulling ${strategy.displayName}...`);

        try {
          const pullResult = await this.pullWithStrategy(strategy, customer, options);
          result.resources.push(pullResult);
          result.totalItems += pullResult.result.count;
          this.logger.info(`    ✅ Pulled ${pullResult.result.count} ${strategy.displayName}`);
        } catch (error) {
          const message = `Failed to pull ${strategy.displayName}: ${error instanceof Error ? error.message : String(error)}`;
          this.logger.error(message, error);

          if (this.options.stopOnError) {
            throw new SyncError(message, strategy.resourceType, error instanceof Error ? error : undefined);
          }
          result.errors.push(message);
        }
      }
    }

    this.logger.info(`✅ Pull completed: ${result.totalItems} items from ${result.resources.length} resource types`);

    return result;
  }

  /**
   * Pull specific resource types
   */
  async pullSelected(
    customer: CustomerConfig,
    resourceTypes: string[],
    options: PullOptions = {}
  ): Promise<SyncPullResult> {
    this.logger.info(`📥 Pulling selected resources for customer: ${customer.idn}`);

    const result: SyncPullResult = {
      customer: customer.idn,
      resources: [],
      totalItems: 0,
      errors: []
    };

    for (const resourceType of resourceTypes) {
      const strategy = this.strategies.get(resourceType);

      if (!strategy) {
        result.errors.push(`Unknown resource type: ${resourceType}`);
        continue;
      }

      this.logger.info(`  📦 Pulling ${strategy.displayName}...`);

      try {
        const pullResult = await this.pullWithStrategy(strategy, customer, options);
        result.resources.push(pullResult);
        result.totalItems += pullResult.result.count;
        this.logger.info(`    ✅ Pulled ${pullResult.result.count} ${strategy.displayName}`);
      } catch (error) {
        const message = `Failed to pull ${strategy.displayName}: ${error instanceof Error ? error.message : String(error)}`;
        this.logger.error(message, error);

        if (this.options.stopOnError) {
          throw new SyncError(message, strategy.resourceType, error instanceof Error ? error : undefined);
        }
        result.errors.push(message);
      }
    }

    return result;
  }

  /**
   * Push ALL changed resources using registered strategies
   */
  async pushAll(customer: CustomerConfig): Promise<SyncPushResult> {
    this.logger.info(`📤 Pushing changes for customer: ${customer.idn}`);

    const result: SyncPushResult = {
      customer: customer.idn,
      resources: [],
      totalCreated: 0,
      totalUpdated: 0,
      totalDeleted: 0,
      errors: []
    };

    for (const strategy of this.strategies.values()) {
      this.logger.info(`  🔍 Checking changes for ${strategy.displayName}...`);

      try {
        const changes = await strategy.getChanges(customer);

        if (changes.length === 0) {
          this.logger.verbose(`    No changes for ${strategy.displayName}`);
          continue;
        }

        this.logger.info(`    Found ${changes.length} changes in ${strategy.displayName}`);

        // Validate before push
        const items = changes.map(c => c.item);
        const validation = await strategy.validate(customer, items);

        if (!validation.valid) {
          const errorMessages = validation.errors.map(e => `${e.field}: ${e.message}`).join(', ');
          throw new ValidationError(`Validation failed: ${errorMessages}`, [validation]);
        }

        // Push changes
        const pushResult = await strategy.push(customer, changes);

        result.resources.push({
          resourceType: strategy.resourceType,
          displayName: strategy.displayName,
          result: pushResult
        });

        result.totalCreated += pushResult.created;
        result.totalUpdated += pushResult.updated;
        result.totalDeleted += pushResult.deleted;
        result.errors.push(...pushResult.errors);

        this.logger.info(`    ✅ Pushed: ${pushResult.created} created, ${pushResult.updated} updated, ${pushResult.deleted} deleted`);
      } catch (error) {
        const message = `Failed to push ${strategy.displayName}: ${error instanceof Error ? error.message : String(error)}`;
        this.logger.error(message, error);

        if (this.options.stopOnError) {
          throw new SyncError(message, strategy.resourceType, error instanceof Error ? error : undefined);
        }
        result.errors.push(message);
      }
    }

    this.logger.info(`✅ Push completed: ${result.totalCreated} created, ${result.totalUpdated} updated, ${result.totalDeleted} deleted`);

    return result;
  }

  /**
   * Push specific resource types
   */
  async pushSelected(customer: CustomerConfig, resourceTypes: string[]): Promise<SyncPushResult> {
    this.logger.info(`📤 Pushing selected resources for customer: ${customer.idn}`);

    const result: SyncPushResult = {
      customer: customer.idn,
      resources: [],
      totalCreated: 0,
      totalUpdated: 0,
      totalDeleted: 0,
      errors: []
    };

    for (const resourceType of resourceTypes) {
      const strategy = this.strategies.get(resourceType);

      if (!strategy) {
        result.errors.push(`Unknown resource type: ${resourceType}`);
        continue;
      }

      try {
        const changes = await strategy.getChanges(customer);

        if (changes.length === 0) {
          continue;
        }

        // Validate before push
        const items = changes.map(c => c.item);
        const validation = await strategy.validate(customer, items);

        if (!validation.valid) {
          const errorMessages = validation.errors.map(e => `${e.field}: ${e.message}`).join(', ');
          throw new ValidationError(`Validation failed: ${errorMessages}`, [validation]);
        }

        const pushResult = await strategy.push(customer, changes);

        result.resources.push({
          resourceType: strategy.resourceType,
          displayName: strategy.displayName,
          result: pushResult
        });

        result.totalCreated += pushResult.created;
        result.totalUpdated += pushResult.updated;
        result.totalDeleted += pushResult.deleted;
        result.errors.push(...pushResult.errors);
      } catch (error) {
        const message = `Failed to push ${strategy.displayName}: ${error instanceof Error ? error.message : String(error)}`;
        this.logger.error(message, error);

        if (this.options.stopOnError) {
          throw new SyncError(message, strategy.resourceType, error instanceof Error ? error : undefined);
        }
        result.errors.push(message);
      }
    }

    return result;
  }

  /**
   * Get status for ALL resources
   */
  async getStatus(customer: CustomerConfig): Promise<StatusReport> {
    const report: StatusReport = {
      customer: customer.idn,
      resources: [],
      totalChanges: 0
    };

    for (const strategy of this.strategies.values()) {
      try {
        const status = await strategy.getStatus(customer);
        report.resources.push(status);
        report.totalChanges += status.changedCount;
      } catch (error) {
        this.logger.error(`Failed to get status for ${strategy.displayName}`, error);
      }
    }

    return report;
  }

  /**
   * Get status for specific resource types
   */
  async getStatusSelected(customer: CustomerConfig, resourceTypes: string[]): Promise<StatusReport> {
    const report: StatusReport = {
      customer: customer.idn,
      resources: [],
      totalChanges: 0
    };

    for (const resourceType of resourceTypes) {
      const strategy = this.strategies.get(resourceType);

      if (!strategy) {
        continue;
      }

      try {
        const status = await strategy.getStatus(customer);
        report.resources.push(status);
        report.totalChanges += status.changedCount;
      } catch (error) {
        this.logger.error(`Failed to get status for ${strategy.displayName}`, error);
      }
    }

    return report;
  }

  /**
   * Helper to execute pull with a single strategy
   */
  private async pullWithStrategy(
    strategy: ISyncStrategy,
    customer: CustomerConfig,
    options: PullOptions
  ): Promise<{ resourceType: string; displayName: string; result: PullResult }> {
    const result = await strategy.pull(customer, options);

    return {
      resourceType: strategy.resourceType,
      displayName: strategy.displayName,
      result
    };
  }
}

/**
 * Factory function for creating SyncEngine with default strategies
 */
export function createSyncEngine(
  strategies: ISyncStrategy[],
  logger: ILogger,
  options?: SyncEngineOptions
): SyncEngine {
  return new SyncEngine(strategies, logger, options);
}
