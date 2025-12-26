/**
 * Dependency Injection Container
 *
 * A simple, TypeScript-native DI container that:
 * - Supports singleton and factory registrations
 * - Provides type-safe dependency resolution
 * - Enables easy testing through dependency injection
 */

/**
 * Factory function type for creating service instances
 */
type Factory<T> = (container: ServiceContainer) => T;

/**
 * Registration types
 */
interface Registration<T> {
  factory: Factory<T>;
  singleton: boolean;
  instance?: T;
}

/**
 * Service Container for Dependency Injection
 */
export class ServiceContainer {
  private registrations: Map<symbol, Registration<unknown>> = new Map();

  /**
   * Register a factory that creates a new instance each time
   */
  register<T>(token: symbol, factory: Factory<T>): void {
    this.registrations.set(token, {
      factory,
      singleton: false
    });
  }

  /**
   * Register a singleton - only created once
   */
  registerSingleton<T>(token: symbol, instanceOrFactory: T | Factory<T>): void {
    if (typeof instanceOrFactory === 'function') {
      this.registrations.set(token, {
        factory: instanceOrFactory as Factory<T>,
        singleton: true
      });
    } else {
      this.registrations.set(token, {
        factory: () => instanceOrFactory,
        singleton: true,
        instance: instanceOrFactory
      });
    }
  }

  /**
   * Register a value directly
   */
  registerValue<T>(token: symbol, value: T): void {
    this.registrations.set(token, {
      factory: () => value,
      singleton: true,
      instance: value
    });
  }

  /**
   * Resolve a service by its token
   */
  get<T>(token: symbol): T {
    const registration = this.registrations.get(token);

    if (!registration) {
      throw new Error(`No registration found for token: ${token.toString()}`);
    }

    if (registration.singleton) {
      if (registration.instance === undefined) {
        registration.instance = registration.factory(this);
      }
      return registration.instance as T;
    }

    return registration.factory(this) as T;
  }

  /**
   * Check if a token is registered
   */
  has(token: symbol): boolean {
    return this.registrations.has(token);
  }

  /**
   * Get all registered tokens
   */
  getTokens(): symbol[] {
    return Array.from(this.registrations.keys());
  }

  /**
   * Clear all registrations (useful for testing)
   */
  clear(): void {
    this.registrations.clear();
  }

  /**
   * Create a child container that inherits parent registrations
   */
  createChild(): ServiceContainer {
    const child = new ServiceContainer();

    // Copy parent registrations
    for (const [token, registration] of this.registrations) {
      child.registrations.set(token, { ...registration });
    }

    return child;
  }
}

/**
 * Global container instance
 */
let globalContainer: ServiceContainer | null = null;

/**
 * Get the global container instance
 */
export function getContainer(): ServiceContainer {
  if (!globalContainer) {
    globalContainer = new ServiceContainer();
  }
  return globalContainer;
}

/**
 * Set the global container instance (useful for testing)
 */
export function setContainer(container: ServiceContainer): void {
  globalContainer = container;
}

/**
 * Reset the global container (useful for testing)
 */
export function resetContainer(): void {
  globalContainer = null;
}
