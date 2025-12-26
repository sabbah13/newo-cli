/**
 * Common types used across all domain resources
 */

/**
 * Customer configuration for API operations
 */
export interface CustomerConfig {
  idn: string;
  apiKey: string;
  projectId?: string | undefined;
}

/**
 * Multi-customer configuration
 */
export interface MultiCustomerConfig {
  customers: Record<string, CustomerConfig>;
  defaultCustomer?: string | undefined;
}

/**
 * Base entity interface with common fields
 */
export interface BaseEntity {
  id: string;
  idn: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Entity with title and description
 */
export interface DescriptiveEntity extends BaseEntity {
  title: string;
  description?: string;
}

/**
 * Hash store for change detection
 */
export interface HashStore {
  [filePath: string]: string;
}

/**
 * ID mapping for local to remote entity references
 */
export interface IdMapping {
  [localId: string]: string;
}

/**
 * Logger interface for dependency injection
 */
export interface ILogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, error?: unknown): void;
  debug(message: string, ...args: unknown[]): void;
  verbose(message: string, ...args: unknown[]): void;
  progress(current: number, total: number, message: string): void;
}

/**
 * Default console logger implementation
 */
export class ConsoleLogger implements ILogger {
  constructor(private verboseMode: boolean = false) {}

  info(message: string, ..._args: unknown[]): void {
    console.log(message);
  }

  warn(message: string, ..._args: unknown[]): void {
    console.warn(`⚠️  ${message}`);
  }

  error(message: string, error?: unknown): void {
    console.error(`❌ ${message}`);
    if (error && this.verboseMode) {
      console.error(error);
    }
  }

  debug(message: string, ..._args: unknown[]): void {
    if (this.verboseMode) {
      console.log(`🔍 ${message}`);
    }
  }

  verbose(message: string, ..._args: unknown[]): void {
    if (this.verboseMode) {
      console.log(message);
    }
  }

  progress(current: number, total: number, message: string): void {
    const pct = Math.round((current / total) * 100);
    process.stdout.write(`\r${message}: ${current}/${total} (${pct}%)`);
    if (current === total) {
      console.log('');
    }
  }
}
