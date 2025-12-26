# NEWO CLI Architecture Redesign Proposal

**Document Version:** 1.0
**Date:** October 20, 2025
**Author:** Professional Software Architect Analysis
**Status:** Proposal - No Code Changes Yet

---

## Executive Summary

This document presents a comprehensive architectural redesign for the NEWO CLI tool, addressing technical debt accumulated through rapid feature evolution from v1.6 to v3.3. The analysis identifies **critical areas for improvement** while proposing **minimal, high-impact changes** to transform the codebase from a collection of incrementally added features into a **cohesive, scalable platform**.

### Key Findings

**Current State:**
- ✅ Functional TypeScript architecture with excellent type safety (833 lines of types)
- ✅ Modular command structure (34 commands in `src/cli/commands/`)
- ✅ Comprehensive feature set (pull/push, entity mgmt, migration, testing)
- ⚠️ **202 instances** of duplicate error handling (`console.error` + `process.exit(1)`)
- ⚠️ **16 files** with duplicate usage message patterns
- ⚠️ **23 deep import paths** (`../../api`) indicating poor module boundaries
- ⚠️ Large files needing decomposition: types.ts (833), migrate.ts (746), push.ts (624), api.ts (554)

**Evolution Pattern (Git History Analysis):**
```
v1.6-1.7 → Customer attributes, multi-customer support
v1.8-1.9 → Change tracking, conversations, modular refactor
v2.0     → IDN-based naming, professional architecture
v3.0     → Complete entity management (create/delete)
v3.1     → Sandbox chat testing
v3.2     → Integration management, AKB, project attributes
v3.3     → Account migration, webhook automation
```

**Future Direction Prediction:**
Based on evolution analysis, the product is becoming a **comprehensive NEWO platform management tool** beyond simple sync:
- Platform automation & orchestration
- Advanced testing & validation
- Multi-environment management
- Developer productivity tools
- CI/CD integration expansion

---

## Part 1: Current Architecture Analysis

### 1.1 Directory Structure Assessment

**Current Organization:**
```
src/
├── cli/
│   ├── commands/          # 34 command handlers (✅ Good separation)
│   ├── customer-selection.ts
│   └── errors.ts
├── sync/                  # 10 sync modules (⚠️ Mixed responsibilities)
│   ├── akb.ts
│   ├── attributes.ts
│   ├── conversations.ts
│   ├── diff-utils.ts
│   ├── integrations.ts
│   ├── metadata.ts
│   ├── migrate.ts        # 746 lines - too large
│   ├── projects.ts       # 578 lines - complex
│   ├── push.ts           # 624 lines - needs decomposition
│   ├── skill-files.ts
│   └── status.ts
├── sandbox/              # Chat testing (✅ Well isolated)
│   └── chat.ts
├── core/                 # Empty directory (⚠️ Unused)
├── api.ts               # 554 lines - HTTP client + endpoints
├── auth.ts              # 419 lines - multi-strategy auth
├── types.ts             # 833 lines - all type definitions
├── cli.ts               # 241 lines - main entry point
├── customer*.ts         # 3 files - customer config management
├── env.ts               # Environment configuration
├── fsutil.ts            # File system utilities
├── hash.ts              # SHA256 hashing
├── sync.ts              # Legacy sync (13 lines, re-exports)
└── akb.ts               # AKB article parser
```

**Assessment:**
- ✅ **Strengths:** Clear command separation, good use of TypeScript
- ⚠️ **Weaknesses:**
  - Module boundaries unclear (`sync/` vs root level)
  - Large files indicate missing abstractions
  - Deep import paths (`../../`) show poor encapsulation
  - `core/` directory unused, indicating incomplete refactoring

---

### 1.2 Code Duplication Analysis

#### Critical Duplication Areas

**1. Error Handling Pattern (202 instances)**
```typescript
// Repeated in 16+ command files:
if (!idn) {
  console.error('Error: IDN is required');
  console.error('Usage: newo create-X <idn> ...');
  process.exit(1);
}
```

**Impact:**
- Maintenance nightmare: every error message change requires 16+ file edits
- Inconsistent error formatting across commands
- No centralized error tracking or logging

**2. Command Handler Boilerplate (34 files)**
```typescript
// Every command handler repeats:
export async function handleXCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean
): Promise<void> {
  try {
    const selectedCustomer = requireSingleCustomer(customerConfig, args.customer);
    // ... validation
    // ... business logic
  } catch (error: unknown) {
    console.error('❌ Failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
```

**Impact:**
- 34 files with nearly identical structure
- Copy-paste programming for new commands
- Testing requires mocking same patterns repeatedly

**3. API Client Creation (23+ files)**
```typescript
// Repeated pattern:
const accessToken = await getValidAccessToken(selectedCustomer);
const client = await makeClient(verbose, accessToken);
```

**Impact:**
- Authentication logic scattered across command files
- No centralized request lifecycle management
- Difficult to add cross-cutting concerns (metrics, retry logic)

**4. Usage Message Patterns (16 files)**
```typescript
// Similar usage messages with slight variations:
console.error('Usage: newo create-agent <idn> --project <project-idn> [--title <title>]');
console.error('Usage: newo create-flow <idn> --agent <agent-idn> --project <project-idn> ...');
```

**Impact:**
- No single source of truth for command documentation
- Help command must be manually updated
- CLI usage inconsistencies

---

### 1.3 Large File Analysis

**Files Requiring Decomposition:**

| File | Lines | Issues | Recommended Split |
|------|-------|--------|-------------------|
| `types.ts` | 833 | All types in one file, difficult to navigate | Split by domain (api/, sync/, cli/) |
| `migrate.ts` | 746 | Account migration + verification + webhook creation | Separate concerns into modules |
| `push.ts` | 624 | Entity scanning + creation + validation + push | Extract entity factory, validator |
| `projects.ts` | 578 | Pull + cleanup + deletion + metadata generation | Separate pull/cleanup/deletion |
| `api.ts` | 554 | HTTP client factory + 30+ API endpoint functions | Split client/endpoints |
| `auth.ts` | 419 | Validation + token mgmt + refresh + multi-strategy | Extract strategies pattern |

**Impact:**
- Cognitive overload: developers must understand 500+ line files
- Merge conflicts in large files
- Difficult to test individual responsibilities
- Violates Single Responsibility Principle

---

### 1.4 Architecture Pattern Assessment

**Current Pattern: Functional + Modular**
```
✅ Advantages:
- Simple to understand for small-scale operations
- TypeScript provides strong typing
- Functions are easily testable in isolation
- No complex OOP hierarchies

⚠️ Disadvantages:
- No dependency injection (testing requires module mocking)
- Cross-cutting concerns (logging, error handling) implemented ad-hoc
- Difficult to extend without modifying existing code (violates Open/Closed)
- No clear boundaries for feature domains
```

**Module Organization Issues:**
```
src/
  cli/commands/    ← Command handlers (good)
  sync/           ← Mixed: pull, push, migrate, status, attributes, integrations
  root level      ← api, auth, types, fsutil, hash, customer*, env, akb, sync.ts
```

**Problems:**
1. `sync/` contains unrelated concerns (migration ≠ status ≠ integrations)
2. Root level cluttered with 11+ files of different purposes
3. No clear domain separation (API layer, Business logic, Infrastructure)

---

## Part 2: Proposed Architecture

### 2.1 Design Principles

**1. Domain-Driven Structure**
Organize code by business domain rather than technical layer:
```
src/
  domains/
    sync/         # Pull, push, status, change detection
    entities/     # Create, delete, validate agents/flows/skills
    migration/    # Account migration, verification, webhooks
    integration/  # Connectors, webhooks, AKB
    sandbox/      # Testing, chat, conversations
```

**2. Layered Architecture**
Clear separation of concerns with dependency flow:
```
CLI Layer         → Command handlers, argument parsing
Application Layer → Use cases, business logic
Domain Layer      → Entities, value objects, domain services
Infrastructure    → API clients, file system, authentication
```

**3. Dependency Injection**
Replace direct imports with dependency injection for testability:
```typescript
// Before (hard to test):
const client = await makeClient(verbose, accessToken);

// After (easy to mock):
class CommandExecutor {
  constructor(private apiClientFactory: ApiClientFactory) {}
}
```

**4. Open/Closed Principle**
Extend functionality without modifying existing code:
```typescript
// Pluggable command registration instead of switch/case
// Pluggable validators instead of if/else chains
// Strategy pattern for authentication instead of scattered logic
```

---

### 2.2 Proposed Directory Structure

```
newo-cli/
├── src/
│   ├── core/                      # Framework-level abstractions
│   │   ├── command/               # Command pattern framework
│   │   │   ├── Command.ts         # Base command interface
│   │   │   ├── CommandRegistry.ts # Command registration & discovery
│   │   │   ├── CommandExecutor.ts # Execution pipeline
│   │   │   └── CommandValidator.ts # Argument validation framework
│   │   ├── errors/               # Error handling framework
│   │   │   ├── ErrorHandler.ts   # Centralized error handling
│   │   │   ├── CliError.ts       # CLI error types
│   │   │   └── ErrorFormatter.ts # User-friendly error messages
│   │   ├── di/                   # Dependency injection
│   │   │   ├── Container.ts      # DI container
│   │   │   └── ServiceProvider.ts # Service registration
│   │   └── types/                # Core type definitions
│   │       ├── common.ts         # Shared types
│   │       └── index.ts          # Type exports
│   │
│   ├── domains/                   # Business domain modules
│   │   ├── sync/                 # Project synchronization domain
│   │   │   ├── commands/         # pull, push, status
│   │   │   ├── services/         # SyncService, ChangeDetector
│   │   │   ├── repositories/     # ProjectRepository, SkillRepository
│   │   │   ├── models/           # ProjectData, SkillData
│   │   │   ├── types.ts          # Domain-specific types
│   │   │   └── index.ts
│   │   │
│   │   ├── entities/             # Entity management domain
│   │   │   ├── commands/         # create-*, delete-*
│   │   │   ├── services/         # EntityFactory, EntityValidator
│   │   │   ├── models/           # Agent, Flow, Skill, Event, State
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── migration/            # Account migration domain
│   │   │   ├── commands/         # migrate-account, verify-migration
│   │   │   ├── services/         # MigrationService, VerificationService
│   │   │   ├── strategies/       # EntityMigrationStrategy
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── integration/          # Integration & webhook domain
│   │   │   ├── commands/         # pull-integrations, push-integrations
│   │   │   ├── services/         # IntegrationService, WebhookService
│   │   │   ├── models/           # Integration, Connector, Webhook
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── attributes/           # Attributes domain
│   │   │   ├── commands/         # pull-attributes, create-attribute
│   │   │   ├── services/         # AttributeService
│   │   │   ├── models/           # CustomerAttribute, ProjectAttribute
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── sandbox/              # Testing & sandbox domain
│   │   │   ├── commands/         # sandbox, conversations
│   │   │   ├── services/         # SandboxChatService, ConversationService
│   │   │   ├── models/           # ChatSession, Conversation
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   │
│   │   └── knowledge/            # AKB & knowledge base domain
│   │       ├── commands/         # import-akb, pull-akb, push-akb
│   │       ├── services/         # AkbService, ArticleParser
│   │       ├── models/           # AkbArticle, AkbTopic
│   │       ├── types.ts
│   │       └── index.ts
│   │
│   ├── infrastructure/            # Technical infrastructure
│   │   ├── api/                  # API client layer
│   │   │   ├── NewoApiClient.ts  # Main HTTP client
│   │   │   ├── endpoints/        # API endpoint modules
│   │   │   │   ├── projects.ts   # Project endpoints
│   │   │   │   ├── agents.ts     # Agent endpoints
│   │   │   │   ├── skills.ts     # Skill endpoints
│   │   │   │   ├── integrations.ts
│   │   │   │   ├── attributes.ts
│   │   │   │   └── index.ts
│   │   │   ├── interceptors/     # Request/response interceptors
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── auth/                 # Authentication layer
│   │   │   ├── AuthService.ts    # Main auth service
│   │   │   ├── strategies/       # Auth strategy pattern
│   │   │   │   ├── ApiKeyStrategy.ts
│   │   │   │   ├── TokenStrategy.ts
│   │   │   │   └── RefreshStrategy.ts
│   │   │   ├── TokenManager.ts   # Token lifecycle management
│   │   │   ├── validators.ts     # Auth validation
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── storage/              # File system layer
│   │   │   ├── FileSystemService.ts
│   │   │   ├── PathResolver.ts   # Path management
│   │   │   ├── HashStore.ts      # SHA256 hash management
│   │   │   ├── YamlSerializer.ts # YAML read/write
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── config/               # Configuration management
│   │   │   ├── EnvConfig.ts      # Environment variables
│   │   │   ├── CustomerConfig.ts # Customer configuration
│   │   │   ├── validators.ts     # Config validation
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   │
│   │   └── logging/              # Logging infrastructure
│   │       ├── Logger.ts         # Structured logging
│   │       ├── LogFormatter.ts   # Log formatting
│   │       └── index.ts
│   │
│   ├── cli/                      # CLI entry point & orchestration
│   │   ├── NewoCliApp.ts         # Main application class
│   │   ├── bootstrap.ts          # App initialization
│   │   ├── index.ts              # CLI entry point (#!/usr/bin/env node)
│   │   └── types.ts              # CLI-specific types
│   │
│   └── shared/                   # Shared utilities
│       ├── utils/                # General utilities
│       ├── constants/            # Application constants
│       └── types.ts              # Shared types
│
├── docs/                         # Documentation (reorganized)
│   ├── architecture/             # Architecture documentation
│   │   ├── ARCHITECTURE.md       # This document
│   │   ├── DESIGN_DECISIONS.md   # ADR (Architecture Decision Records)
│   │   └── DOMAIN_MODEL.md       # Domain model documentation
│   ├── api/                      # API documentation
│   ├── guides/                   # User guides
│   └── development/              # Development guides
│
├── test/                         # Test organization
│   ├── unit/                     # Unit tests (by domain)
│   │   ├── domains/
│   │   ├── infrastructure/
│   │   └── core/
│   ├── integration/              # Integration tests
│   └── e2e/                      # End-to-end tests
│
├── scripts/                      # Build & utility scripts
├── .newo/                        # CLI state (runtime)
├── newo_customers/               # Customer data (runtime)
└── package.json
```

**Key Improvements:**
1. **Clear domain separation** - Each business domain in its own module
2. **Layered architecture** - Core → Domains → Infrastructure → CLI
3. **Organized types** - Types live with their domains, not centralized
4. **Better testability** - Domain logic separated from infrastructure
5. **Scalability** - Easy to add new domains/commands without touching existing code

---

### 2.3 Core Framework Components

#### 2.3.1 Command Pattern Implementation

**Base Command Interface:**
```typescript
// src/core/command/Command.ts
export interface CommandMetadata {
  name: string;
  description: string;
  usage: string;
  examples: string[];
  category: 'sync' | 'entity' | 'migration' | 'integration' | 'test' | 'util';
}

export interface CommandContext {
  args: CliArgs;
  verbose: boolean;
  customerConfig: MultiCustomerConfig;
  services: ServiceContainer; // DI container
}

export interface Command {
  metadata: CommandMetadata;
  validate(context: CommandContext): Promise<ValidationResult>;
  execute(context: CommandContext): Promise<CommandResult>;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface CommandResult {
  success: boolean;
  message?: string;
  data?: unknown;
}
```

**Command Registry:**
```typescript
// src/core/command/CommandRegistry.ts
export class CommandRegistry {
  private commands = new Map<string, Command>();

  register(command: Command): void {
    this.commands.set(command.metadata.name, command);
  }

  get(name: string): Command | undefined {
    return this.commands.get(name);
  }

  list(): CommandMetadata[] {
    return Array.from(this.commands.values()).map(c => c.metadata);
  }

  listByCategory(category: string): CommandMetadata[] {
    return this.list().filter(m => m.category === category);
  }
}
```

**Command Executor (with pipeline):**
```typescript
// src/core/command/CommandExecutor.ts
export class CommandExecutor {
  constructor(
    private registry: CommandRegistry,
    private errorHandler: ErrorHandler,
    private logger: Logger
  ) {}

  async execute(commandName: string, context: CommandContext): Promise<void> {
    try {
      // 1. Find command
      const command = this.registry.get(commandName);
      if (!command) {
        throw new CommandNotFoundError(commandName);
      }

      // 2. Validate
      this.logger.debug(`Validating command: ${commandName}`);
      const validation = await command.validate(context);
      if (!validation.valid) {
        throw new ValidationError(validation.errors);
      }

      // 3. Execute
      this.logger.info(`Executing command: ${commandName}`);
      const result = await command.execute(context);

      // 4. Handle result
      if (result.success) {
        this.logger.info(result.message || 'Command completed successfully');
      } else {
        throw new CommandExecutionError(result.message || 'Command failed');
      }
    } catch (error) {
      await this.errorHandler.handle(error, commandName);
      throw error; // Re-throw for process.exit handling
    }
  }
}
```

**Example Command Implementation:**
```typescript
// src/domains/sync/commands/PullCommand.ts
export class PullCommand implements Command {
  metadata: CommandMetadata = {
    name: 'pull',
    description: 'Download projects from NEWO platform',
    usage: 'newo pull [--customer <idn>] [--force] [--verbose]',
    examples: [
      'newo pull',
      'newo pull --customer NEWO_ABC123',
      'newo pull --force --verbose'
    ],
    category: 'sync'
  };

  constructor(
    private syncService: SyncService,
    private customerSelector: CustomerSelector,
    private logger: Logger
  ) {}

  async validate(context: CommandContext): Promise<ValidationResult> {
    const errors: ValidationError[] = [];

    // Customer validation handled by framework
    // No need to repeat error messages

    return { valid: errors.length === 0, errors };
  }

  async execute(context: CommandContext): Promise<CommandResult> {
    const { selectedCustomer, isMultiCustomer } =
      this.customerSelector.select(context.customerConfig, context.args.customer);

    const silentOverwrite = Boolean(context.args.force || context.args.f);

    if (selectedCustomer) {
      await this.syncService.pullAll(selectedCustomer, silentOverwrite);
    } else if (isMultiCustomer) {
      await this.syncService.pullAllCustomers(
        context.customerConfig,
        silentOverwrite
      );
    }

    return { success: true, message: '✅ Pull completed' };
  }
}
```

**Benefits:**
- ✅ No more duplicate error handling
- ✅ Automatic usage message generation
- ✅ Validation separated from execution
- ✅ Easy to test (mock dependencies)
- ✅ Help command auto-generated from metadata
- ✅ Extensible without modifying existing code

---

#### 2.3.2 Centralized Error Handling

**Error Hierarchy:**
```typescript
// src/core/errors/CliError.ts
export abstract class CliError extends Error {
  abstract code: string;
  abstract exitCode: number;
  abstract userMessage: string;
}

export class CommandNotFoundError extends CliError {
  code = 'COMMAND_NOT_FOUND';
  exitCode = 1;
  userMessage = `Unknown command: ${this.commandName}`;

  constructor(public commandName: string) {
    super(`Command not found: ${commandName}`);
  }
}

export class ValidationError extends CliError {
  code = 'VALIDATION_ERROR';
  exitCode = 1;
  userMessage: string;

  constructor(public errors: ValidationError[]) {
    super('Validation failed');
    this.userMessage = errors.map(e => `• ${e.message}`).join('\n');
  }
}

export class ApiError extends CliError {
  code = 'API_ERROR';
  exitCode = 1;
  userMessage: string;

  constructor(
    message: string,
    public statusCode?: number,
    public endpoint?: string
  ) {
    super(message);
    this.userMessage = `API error${endpoint ? ` (${endpoint})` : ''}: ${message}`;
  }
}

// ... more specific error types
```

**Centralized Error Handler:**
```typescript
// src/core/errors/ErrorHandler.ts
export class ErrorHandler {
  constructor(private logger: Logger) {}

  async handle(error: unknown, context: string): Promise<void> {
    if (error instanceof CliError) {
      this.handleCliError(error);
    } else if (error instanceof Error) {
      this.handleUnexpectedError(error, context);
    } else {
      this.handleUnknownError(error, context);
    }
  }

  private handleCliError(error: CliError): void {
    // User-friendly message
    console.error(`\n❌ ${error.userMessage}\n`);

    // Log technical details
    this.logger.error('CLI Error', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
  }

  private handleUnexpectedError(error: Error, context: string): void {
    console.error(`\n❌ Unexpected error in ${context}:`);
    console.error(error.message);

    this.logger.error('Unexpected error', {
      context,
      message: error.message,
      stack: error.stack
    });
  }

  private handleUnknownError(error: unknown, context: string): void {
    console.error(`\n❌ Unknown error in ${context}:`);
    console.error(String(error));

    this.logger.error('Unknown error', { context, error });
  }
}
```

**Benefits:**
- ✅ Eliminates 202 instances of duplicate error handling
- ✅ Consistent error messages across all commands
- ✅ Centralized logging for debugging
- ✅ Easy to add error tracking (Sentry, etc.)

---

#### 2.3.3 Dependency Injection Container

**Service Container:**
```typescript
// src/core/di/Container.ts
export class ServiceContainer {
  private services = new Map<symbol, any>();
  private factories = new Map<symbol, () => any>();

  register<T>(token: symbol, factory: () => T): void {
    this.factories.set(token, factory);
  }

  registerSingleton<T>(token: symbol, instance: T): void {
    this.services.set(token, instance);
  }

  get<T>(token: symbol): T {
    // Return singleton if exists
    if (this.services.has(token)) {
      return this.services.get(token);
    }

    // Create new instance from factory
    const factory = this.factories.get(token);
    if (!factory) {
      throw new Error(`Service not registered: ${token.toString()}`);
    }

    const instance = factory();
    return instance;
  }

  getSingleton<T>(token: symbol): T {
    if (!this.services.has(token)) {
      const factory = this.factories.get(token);
      if (!factory) {
        throw new Error(`Service not registered: ${token.toString()}`);
      }
      this.services.set(token, factory());
    }
    return this.services.get(token);
  }
}

// Service tokens
export const TOKENS = {
  // Infrastructure
  API_CLIENT: Symbol('ApiClient'),
  AUTH_SERVICE: Symbol('AuthService'),
  FILE_SYSTEM: Symbol('FileSystem'),
  LOGGER: Symbol('Logger'),

  // Services
  SYNC_SERVICE: Symbol('SyncService'),
  ENTITY_SERVICE: Symbol('EntityService'),
  MIGRATION_SERVICE: Symbol('MigrationService'),

  // Repositories
  PROJECT_REPOSITORY: Symbol('ProjectRepository'),
  SKILL_REPOSITORY: Symbol('SkillRepository'),
};
```

**Service Registration:**
```typescript
// src/cli/bootstrap.ts
export function createServiceContainer(
  customerConfig: MultiCustomerConfig,
  verbose: boolean
): ServiceContainer {
  const container = new ServiceContainer();

  // Infrastructure layer
  container.registerSingleton(TOKENS.LOGGER, new Logger(verbose));
  container.register(TOKENS.AUTH_SERVICE, () =>
    new AuthService(container.get(TOKENS.LOGGER))
  );
  container.register(TOKENS.API_CLIENT, () =>
    new NewoApiClient(
      container.get(TOKENS.AUTH_SERVICE),
      container.get(TOKENS.LOGGER)
    )
  );
  container.registerSingleton(TOKENS.FILE_SYSTEM, new FileSystemService());

  // Domain services
  container.register(TOKENS.SYNC_SERVICE, () =>
    new SyncService(
      container.get(TOKENS.API_CLIENT),
      container.get(TOKENS.FILE_SYSTEM),
      container.get(TOKENS.LOGGER)
    )
  );

  // ... register all services

  return container;
}
```

**Benefits:**
- ✅ Easy to mock services for testing
- ✅ Clear dependency graph
- ✅ Services can be swapped without code changes
- ✅ No more scattered `makeClient()` calls

---

### 2.4 Domain Module Structure

Each domain follows consistent structure for predictability:

**Example: Sync Domain**
```typescript
// src/domains/sync/index.ts
export { PullCommand } from './commands/PullCommand';
export { PushCommand } from './commands/PushCommand';
export { StatusCommand } from './commands/StatusCommand';
export { SyncService } from './services/SyncService';
export { ChangeDetector } from './services/ChangeDetector';
export { ProjectRepository } from './repositories/ProjectRepository';
export * from './types';

// src/domains/sync/services/SyncService.ts
export class SyncService {
  constructor(
    private apiClient: NewoApiClient,
    private fileSystem: FileSystemService,
    private changeDetector: ChangeDetector,
    private logger: Logger
  ) {}

  async pullAll(
    customer: CustomerConfig,
    silentOverwrite: boolean = false
  ): Promise<void> {
    this.logger.info(`Pulling projects for customer: ${customer.idn}`);

    // Business logic here (no infrastructure concerns)
    const projects = await this.apiClient.projects.list();
    // ... rest of pull logic
  }

  async pushChanges(customer: CustomerConfig): Promise<PushResult> {
    const changes = await this.changeDetector.detectChanges(customer);
    // ... push logic
  }
}
```

**Repository Pattern:**
```typescript
// src/domains/sync/repositories/ProjectRepository.ts
export class ProjectRepository {
  constructor(
    private fileSystem: FileSystemService,
    private hashStore: HashStore
  ) {}

  async getProjects(customerIdn: string): Promise<ProjectData[]> {
    // Read from filesystem, return domain models
  }

  async saveProject(customerIdn: string, project: ProjectData): Promise<void> {
    // Save to filesystem, update hashes
  }

  async getChangedProjects(customerIdn: string): Promise<ProjectData[]> {
    // Use hashStore to detect changes
  }
}
```

---

### 2.5 API Client Refactoring

**Current Issues:**
- 554-line api.ts with HTTP client + 30+ endpoint functions
- All endpoints in one file
- Direct axios usage throughout

**Proposed Structure:**
```typescript
// src/infrastructure/api/NewoApiClient.ts
export class NewoApiClient {
  constructor(
    private authService: AuthService,
    private logger: Logger,
    private baseURL: string = ENV.NEWO_BASE_URL
  ) {
    this.projects = new ProjectsApi(this);
    this.agents = new AgentsApi(this);
    this.skills = new SkillsApi(this);
    // ... other endpoints
  }

  readonly projects: ProjectsApi;
  readonly agents: AgentsApi;
  readonly skills: SkillsApi;
  readonly integrations: IntegrationsApi;
  readonly attributes: AttributesApi;
  readonly akb: AkbApi;

  async request<T>(config: RequestConfig): Promise<T> {
    const token = await this.authService.getValidToken();

    const response = await axios.request({
      ...config,
      baseURL: this.baseURL,
      headers: {
        ...config.headers,
        Authorization: `Bearer ${token}`
      }
    });

    return response.data;
  }
}

// src/infrastructure/api/endpoints/projects.ts
export class ProjectsApi {
  constructor(private client: NewoApiClient) {}

  async list(): Promise<ProjectMeta[]> {
    return this.client.request({
      method: 'GET',
      url: '/api/v1/designer/projects'
    });
  }

  async getById(id: string): Promise<ProjectMeta> {
    return this.client.request({
      method: 'GET',
      url: `/api/v1/designer/projects/by-id/${id}`
    });
  }

  // ... other project endpoints
}
```

**Benefits:**
- ✅ API organized by resource
- ✅ Each endpoint file < 100 lines
- ✅ Easy to add new endpoints
- ✅ Consistent interface

---

## Part 3: Migration Strategy

### 3.1 Phased Approach (Minimal Disruption)

**Phase 1: Foundation (No Breaking Changes)**
- Create new directory structure alongside existing code
- Implement core framework (Command, ErrorHandler, DI Container)
- Add framework tests
- **Estimated Effort:** 3-5 days
- **Risk:** Low (no existing code modified)

**Phase 2: Migrate High-Value Commands (Incremental)**
- Migrate 5 most-used commands to new pattern (pull, push, status, sandbox, help)
- Keep old commands working via adapter pattern
- Update tests
- **Estimated Effort:** 5-7 days
- **Risk:** Low (gradual migration)

**Phase 3: Refactor Infrastructure**
- Split api.ts into endpoint modules
- Implement repository pattern for file operations
- Refactor auth.ts into strategy pattern
- **Estimated Effort:** 4-6 days
- **Risk:** Medium (requires careful testing)

**Phase 4: Migrate Remaining Commands**
- Migrate all 29 remaining commands
- Remove old command handlers
- Clean up legacy code
- **Estimated Effort:** 7-10 days
- **Risk:** Low (pattern established)

**Phase 5: Domain Reorganization**
- Move code into domain modules
- Clean up types.ts (split by domain)
- Update documentation
- **Estimated Effort:** 3-4 days
- **Risk:** Low (mostly file moves)

**Total Estimated Effort:** 22-32 days (4-6 weeks)

---

### 3.2 Backward Compatibility Strategy

**Adapter Pattern for Old → New:**
```typescript
// Temporary adapter during migration
export async function handlePullCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean
): Promise<void> {
  // Old function signature maintained
  // Delegates to new command pattern internally
  const container = createServiceContainer(customerConfig, verbose);
  const executor = container.get<CommandExecutor>(TOKENS.COMMAND_EXECUTOR);
  const context: CommandContext = { args, verbose, customerConfig, services: container };
  await executor.execute('pull', context);
}
```

**Benefits:**
- Existing tests keep working
- No immediate breaking changes
- Gradual migration possible
- Can fall back if issues found

---

### 3.3 Testing Strategy

**Current State:**
- 8 test files in `test/` directory
- Tests use Node.js native test runner
- Good coverage of core functionality

**Proposed Enhancements:**
```
test/
├── unit/                    # Fast, isolated tests
│   ├── core/                # Framework tests
│   │   ├── command/
│   │   ├── errors/
│   │   └── di/
│   ├── domains/             # Domain logic tests
│   │   ├── sync/
│   │   ├── entities/
│   │   └── migration/
│   └── infrastructure/      # Infrastructure tests
│       ├── api/
│       ├── auth/
│       └── storage/
│
├── integration/             # Multi-component tests
│   ├── pull-push-cycle.test.ts
│   ├── entity-creation.test.ts
│   └── migration-flow.test.ts
│
└── e2e/                     # Full workflow tests
    ├── basic-workflow.test.ts
    └── multi-customer.test.ts
```

**Test Coverage Goals:**
- Unit tests: >80% coverage
- Integration tests: Critical paths covered
- E2E tests: Main workflows validated

---

## Part 4: Documentation Reorganization

### 4.1 Current Documentation Assessment

**Current Structure:**
```
newo-docs/
├── guides/ (7 files, 121KB)
├── best-practices/ (3 files, 52KB)
├── testing-reports/ (8 files, reports)
└── platform/ (empty)

Root:
├── CLAUDE.md (technical reference)
├── README.md (user documentation)
├── CHANGELOG.md
└── SECURITY.md
```

**Issues:**
- Technical guidance mixed with user guides
- No architecture documentation
- Testing reports in docs/ (should be in temp/)
- Platform/ directory empty

---

### 4.2 Proposed Documentation Structure

```
docs/
├── README.md                     # Documentation index
│
├── user-guide/                   # End-user documentation
│   ├── 01-getting-started.md     # Installation, setup
│   ├── 02-core-commands.md       # pull, push, status
│   ├── 03-entity-management.md   # create/delete commands
│   ├── 04-multi-customer.md      # Multi-customer workflows
│   ├── 05-migration.md           # Account migration
│   ├── 06-testing.md             # Sandbox & testing
│   ├── 07-ci-cd.md               # GitHub Actions integration
│   └── 08-troubleshooting.md     # Common issues
│
├── developer-guide/              # Developer documentation
│   ├── 01-architecture.md        # THIS DOCUMENT
│   ├── 02-getting-started.md     # Development setup
│   ├── 03-adding-commands.md     # How to add new commands
│   ├── 04-domain-modules.md      # Domain structure guide
│   ├── 05-testing.md             # Testing guide
│   ├── 06-contributing.md        # Contribution guidelines
│   └── 07-api-reference.md       # API documentation
│
├── architecture/                 # Architecture decisions
│   ├── ADR-001-command-pattern.md
│   ├── ADR-002-domain-structure.md
│   ├── ADR-003-dependency-injection.md
│   ├── DOMAIN-MODEL.md           # Domain model diagrams
│   └── SYSTEM-OVERVIEW.md        # High-level overview
│
├── platform/                     # NEWO platform documentation
│   ├── api-endpoints.md          # API endpoint reference
│   ├── authentication.md         # Auth flows
│   ├── data-model.md             # Platform data model
│   └── nsl-reference.md          # NSL scripting reference
│
└── migration/                    # Migration guides
    ├── v2-to-v3.md
    └── legacy-to-new-arch.md     # This refactoring guide
```

**Benefits:**
- Clear separation: user vs developer docs
- Progressive disclosure (01, 02, 03 numbering)
- Architecture decisions documented (ADRs)
- Easy to navigate and maintain

---

## Part 5: Specific Refactoring Recommendations

### 5.1 Breaking Down Large Files

#### types.ts (833 lines)

**Current:** All types in one massive file

**Proposed Split:**
```
src/
├── core/types/
│   └── common.ts              # Shared types (50 lines)
├── infrastructure/
│   ├── api/types.ts           # API-related types (200 lines)
│   ├── auth/types.ts          # Auth types (100 lines)
│   └── storage/types.ts       # File system types (50 lines)
└── domains/
    ├── sync/types.ts          # Sync domain types (150 lines)
    ├── entities/types.ts      # Entity domain types (150 lines)
    └── migration/types.ts     # Migration types (100 lines)
```

**Migration:**
1. Create new type files in appropriate modules
2. Move types one domain at a time
3. Update imports using IDE refactoring
4. Keep old types.ts exporting everything temporarily
5. Remove types.ts once all imports updated

---

#### migrate.ts (746 lines)

**Current:** Account migration + verification + webhook creation in one file

**Proposed Split:**
```
src/domains/migration/
├── services/
│   ├── MigrationService.ts        # Main migration orchestration (200 lines)
│   ├── VerificationService.ts     # Migration verification (150 lines)
│   ├── WebhookMigrationService.ts # Webhook migration (100 lines)
│   └── EntityMigrationService.ts  # Entity migration logic (200 lines)
├── strategies/
│   ├── AgentMigrationStrategy.ts  # Agent-specific migration
│   ├── FlowMigrationStrategy.ts   # Flow-specific migration
│   └── SkillMigrationStrategy.ts  # Skill-specific migration
└── commands/
    ├── MigrateAccountCommand.ts   # migrate-account command
    ├── VerifyMigrationCommand.ts  # verify-migration command
    └── CreateWebhooksCommand.ts   # create-webhooks command
```

**Benefits:**
- Each file < 250 lines
- Single Responsibility Principle
- Testable in isolation
- Strategy pattern for entity types

---

#### push.ts (624 lines)

**Current:** Entity scanning + creation + validation + push logic

**Proposed Split:**
```
src/domains/sync/
├── services/
│   ├── PushService.ts            # Main push orchestration (150 lines)
│   ├── EntityScanner.ts          # Scan local entities (150 lines)
│   └── ChangeValidator.ts        # Validate changes (100 lines)
├── factories/
│   ├── EntityFactory.ts          # Create entity requests (150 lines)
└── commands/
    └── PushCommand.ts            # push command (100 lines)
```

---

#### api.ts (554 lines)

**Current:** HTTP client + all endpoints in one file

**Proposed Split:**
```
src/infrastructure/api/
├── NewoApiClient.ts              # Main client (100 lines)
├── endpoints/
│   ├── projects.ts               # Project endpoints (80 lines)
│   ├── agents.ts                 # Agent endpoints (70 lines)
│   ├── skills.ts                 # Skill endpoints (90 lines)
│   ├── integrations.ts           # Integration endpoints (80 lines)
│   ├── attributes.ts             # Attribute endpoints (60 lines)
│   ├── akb.ts                    # AKB endpoints (50 lines)
│   └── index.ts                  # Export all endpoints
└── interceptors/
    ├── AuthInterceptor.ts        # Auth header injection
    └── LoggingInterceptor.ts     # Request/response logging
```

---

### 5.2 Eliminating Code Duplication

#### Error Handling (202 instances)

**Before:**
```typescript
// Repeated in 16+ files
if (!idn) {
  console.error('Error: IDN is required');
  console.error('Usage: newo create-X <idn> ...');
  process.exit(1);
}
```

**After:**
```typescript
// Command validation framework handles this
export class CreateAgentCommand implements Command {
  metadata: CommandMetadata = {
    name: 'create-agent',
    usage: 'newo create-agent <idn> --project <project-idn> ...',
    // ...
  };

  async validate(context: CommandContext): Promise<ValidationResult> {
    const errors: ValidationError[] = [];

    if (!context.args._[1]) {
      errors.push({
        field: 'idn',
        message: 'Agent IDN is required',
        example: 'newo create-agent my-agent --project my-project'
      });
    }

    return { valid: errors.length === 0, errors };
  }
}

// ErrorHandler automatically formats and displays validation errors
```

**Result:** 202 duplicate error handling instances → 1 centralized ErrorHandler

---

#### Customer Selection (13 instances)

**Before:**
```typescript
// Repeated pattern in multiple files
const selectedCustomer = requireSingleCustomer(customerConfig, args.customer);
// ... or ...
const { selectedCustomer, allCustomers } = selectSingleCustomer(customerConfig, args.customer);
```

**After:**
```typescript
// CustomerSelector injected via DI
export class CreateAgentCommand implements Command {
  constructor(
    private customerSelector: CustomerSelector,
    // ... other dependencies
  ) {}

  async execute(context: CommandContext): Promise<CommandResult> {
    const customer = this.customerSelector.requireSingle(
      context.customerConfig,
      context.args.customer
    );
    // ... rest of logic
  }
}
```

**Result:** Customer selection logic centralized in one service

---

#### Usage Messages (16 files)

**Before:**
```typescript
// Manually written in each command
console.error('Usage: newo create-agent <idn> --project <project-idn> [--title <title>]');
console.error('Usage: newo create-flow <idn> --agent <agent-idn> ...');
```

**After:**
```typescript
// Auto-generated from metadata
export class CreateAgentCommand implements Command {
  metadata: CommandMetadata = {
    name: 'create-agent',
    usage: 'newo create-agent <idn> --project <project-idn> [--title <title>]',
    examples: [
      'newo create-agent my-bot --project my-project',
      'newo create-agent customer-support --project prod --title "Support Bot"'
    ]
  };
}

// HelpCommand automatically reads metadata
// Validation errors automatically include usage from metadata
```

**Result:** Single source of truth for command documentation

---

### 5.3 Improving Module Boundaries

**Current Problem: Deep Import Paths**
```typescript
// 23 instances of this anti-pattern
import { makeClient } from '../../api.js';
import { getValidAccessToken } from '../../auth.js';
```

**Solution: Domain-based exports**
```typescript
// src/domains/sync/index.ts
export { PullCommand } from './commands/PullCommand';
export { SyncService } from './services/SyncService';

// src/infrastructure/api/index.ts
export { NewoApiClient } from './NewoApiClient';
export * from './endpoints';

// Commands import from domain root
import { NewoApiClient } from '@infrastructure/api';
import { SyncService } from '@domains/sync';
```

**Path Aliases in tsconfig.json:**
```json
{
  "compilerOptions": {
    "paths": {
      "@core/*": ["src/core/*"],
      "@domains/*": ["src/domains/*"],
      "@infrastructure/*": ["src/infrastructure/*"],
      "@shared/*": ["src/shared/*"]
    }
  }
}
```

**Benefits:**
- No more `../../` imports
- Clear module boundaries
- Easy to enforce dependency rules (no circular deps)

---

## Part 6: Quality & Scalability Improvements

### 6.1 Adding Cross-Cutting Concerns

**Current Gaps:**
- No centralized logging (console.log scattered everywhere)
- No metrics/telemetry
- No performance monitoring
- No retry logic for API calls

**Proposed Additions:**

#### Structured Logging
```typescript
// src/infrastructure/logging/Logger.ts
export class Logger {
  constructor(
    private level: LogLevel = LogLevel.INFO,
    private transport: LogTransport = new ConsoleTransport()
  ) {}

  debug(message: string, meta?: Record<string, unknown>): void {
    if (this.level <= LogLevel.DEBUG) {
      this.transport.write({ level: 'debug', message, meta });
    }
  }

  info(message: string, meta?: Record<string, unknown>): void {
    // ...
  }

  error(message: string, meta?: Record<string, unknown>): void {
    // ...
  }
}

// Usage in commands
this.logger.info('Pulling projects', { customer: customer.idn });
this.logger.error('Failed to pull', { error: error.message, stack: error.stack });
```

#### Metrics Collection
```typescript
// src/infrastructure/metrics/MetricsCollector.ts
export class MetricsCollector {
  recordCommandExecution(command: string, duration: number, success: boolean): void {
    // Can send to external service (DataDog, CloudWatch, etc.)
  }

  recordApiCall(endpoint: string, duration: number, statusCode: number): void {
    // Track API performance
  }
}
```

#### Retry Logic
```typescript
// src/infrastructure/api/interceptors/RetryInterceptor.ts
export class RetryInterceptor {
  async intercept(
    request: RequestConfig,
    next: () => Promise<Response>
  ): Promise<Response> {
    let lastError: Error;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await next();
      } catch (error) {
        lastError = error;
        if (!this.isRetryable(error) || attempt === 3) {
          throw error;
        }
        await this.delay(attempt * 1000);
      }
    }

    throw lastError!;
  }
}
```

---

### 6.2 Future-Proofing for Scale

**Anticipated Growth Areas:**

1. **More Entities**
   - Current: Agents, Flows, Skills, Events, States, Parameters
   - Future: Templates, Workflows, Integrations, Dashboards
   - Solution: Entity Factory pattern makes adding new types trivial

2. **More Commands**
   - Current: 34 commands
   - Future: 50+ commands (analytics, export, templates, etc.)
   - Solution: Command Registry pattern allows unlimited commands

3. **More Authentication Methods**
   - Current: API key, tokens
   - Future: OAuth, SSO, service accounts
   - Solution: Strategy pattern in AuthService

4. **More Output Formats**
   - Current: YAML
   - Future: JSON, CSV, Excel, PDF reports
   - Solution: Serializer interface with multiple implementations

5. **Plugin System**
   - Allow third-party commands
   - Allow custom validators
   - Allow custom integrations
   - Solution: Plugin loader with discovery mechanism

---

### 6.3 Performance Optimizations

**Current Bottlenecks:**
1. Sequential API calls (could be parallelized)
2. No caching of frequently-accessed data
3. Hash recalculation on every status check

**Proposed Improvements:**

#### Parallel API Calls
```typescript
// Before: Sequential (slow)
for (const agent of agents) {
  const skills = await apiClient.skills.list(agent.id);
}

// After: Parallel (fast)
const skillsPromises = agents.map(agent =>
  apiClient.skills.list(agent.id)
);
const allSkills = await Promise.all(skillsPromises);
```

#### Response Caching
```typescript
// src/infrastructure/api/CacheInterceptor.ts
export class CacheInterceptor {
  private cache = new Map<string, CachedResponse>();

  async intercept(
    request: RequestConfig,
    next: () => Promise<Response>
  ): Promise<Response> {
    if (request.method !== 'GET') {
      return next();
    }

    const key = this.getCacheKey(request);
    const cached = this.cache.get(key);

    if (cached && !this.isExpired(cached)) {
      return cached.response;
    }

    const response = await next();
    this.cache.set(key, {
      response,
      expiresAt: Date.now() + 60000 // 1 minute
    });

    return response;
  }
}
```

#### Incremental Hash Calculation
```typescript
// Only recalculate changed files
export class IncrementalHashStore {
  async getChangedFiles(customerIdn: string): Promise<string[]> {
    const lastHashes = await this.loadHashes(customerIdn);
    const currentFiles = await this.scanFiles(customerIdn);

    const changed: string[] = [];

    for (const file of currentFiles) {
      const stat = await fs.stat(file);
      const lastModified = stat.mtimeMs;

      // Only calculate hash if file modified since last check
      if (lastModified > lastHashes.timestamp) {
        const currentHash = await sha256(file);
        if (currentHash !== lastHashes.files[file]) {
          changed.push(file);
        }
      }
    }

    return changed;
  }
}
```

---

## Part 7: Implementation Roadmap

### 7.1 Priority Matrix

| Change | Impact | Effort | Priority | Phase |
|--------|--------|--------|----------|-------|
| Command Pattern Framework | High | Medium | P0 | 1 |
| Centralized Error Handling | High | Low | P0 | 1 |
| DI Container | High | Medium | P0 | 1 |
| Migrate Core Commands (5) | High | Medium | P1 | 2 |
| Split api.ts into endpoints | Medium | Low | P1 | 3 |
| Repository Pattern | Medium | Medium | P1 | 3 |
| Migrate Remaining Commands | High | High | P2 | 4 |
| Domain Reorganization | Medium | Low | P2 | 5 |
| Split types.ts | Low | Low | P2 | 5 |
| Documentation Reorganization | Medium | Low | P2 | 5 |
| Structured Logging | Low | Low | P3 | Future |
| Metrics Collection | Low | Medium | P3 | Future |
| Plugin System | Low | High | P3 | Future |

---

### 7.2 Week-by-Week Plan

**Week 1: Foundation**
- Day 1-2: Create core framework (Command, ErrorHandler, Container)
- Day 3: Implement DI container and service registration
- Day 4: Write framework tests
- Day 5: Documentation for framework

**Week 2: First Migration**
- Day 1-2: Migrate `pull` command to new pattern
- Day 3: Migrate `push` command
- Day 4: Migrate `status`, `help`, `sandbox` commands
- Day 5: Integration testing for migrated commands

**Week 3: Infrastructure Refactoring**
- Day 1-2: Split api.ts into endpoint modules
- Day 3: Implement repository pattern for file operations
- Day 4: Refactor auth.ts into strategy pattern
- Day 5: Update tests for infrastructure changes

**Week 4-5: Command Migration**
- Migrate 6 commands per day (29 remaining commands)
- Update tests as you go
- Remove old command handlers

**Week 6: Cleanup & Polish**
- Domain reorganization (move files to domains/)
- Split types.ts by domain
- Documentation update
- Final testing and validation

---

### 7.3 Risk Mitigation

**Risk 1: Breaking Existing Functionality**
- Mitigation: Adapter pattern maintains backward compatibility
- Validation: Run full test suite after each migration
- Rollback: Keep old code until all tests pass

**Risk 2: Performance Regression**
- Mitigation: Benchmark before/after for critical operations
- Validation: Performance tests for pull/push operations
- Target: No more than 5% performance degradation

**Risk 3: Developer Learning Curve**
- Mitigation: Comprehensive documentation with examples
- Validation: Pair programming for first few commands
- Support: Architecture office hours for questions

**Risk 4: Incomplete Migration**
- Mitigation: Phased approach with clear milestones
- Validation: Each phase is independently deployable
- Fallback: Can ship after Phase 2 if needed

---

## Part 8: Success Metrics

### 8.1 Code Quality Metrics

**Before Refactoring:**
- 202 instances of duplicate error handling
- 16 files with duplicate usage patterns
- 23 deep import paths
- 5 files > 500 lines
- Test coverage: ~60%

**After Refactoring Goals:**
- 0 duplicate error handling (100% centralized)
- 0 duplicate usage patterns (metadata-driven)
- 0 deep import paths (domain-based imports)
- 0 files > 400 lines
- Test coverage: >80%

---

### 8.2 Developer Experience Metrics

**Before:**
- Time to add new command: ~4 hours (copy-paste, modify, test)
- Time to understand codebase: ~3 days (large files, unclear structure)
- Time to fix bugs: ~2 hours (scattered logic)

**After Goals:**
- Time to add new command: <1 hour (implement Command interface)
- Time to understand codebase: <1 day (clear domain structure)
- Time to fix bugs: <30 minutes (isolated modules)

---

### 8.3 Maintainability Metrics

**Cyclomatic Complexity:**
- Current: Average 12 (some functions >20)
- Target: Average <8 (no function >15)

**File Size:**
- Current: 10 files >300 lines
- Target: All files <300 lines

**Module Coupling:**
- Current: High (deep imports, scattered dependencies)
- Target: Low (clear interfaces, DI)

---

## Part 9: Conclusion

### 9.1 Summary of Benefits

**Architectural Benefits:**
1. ✅ **Scalability** - Easy to add new commands, entities, domains
2. ✅ **Maintainability** - Clear structure, small files, single responsibilities
3. ✅ **Testability** - DI enables easy mocking, isolated tests
4. ✅ **Extensibility** - Plugin system, strategy pattern for extensions
5. ✅ **Consistency** - Command pattern enforces uniform structure

**Code Quality Benefits:**
1. ✅ **Eliminated Duplication** - 202 → 0 duplicate error handlers
2. ✅ **Reduced File Sizes** - No files >400 lines
3. ✅ **Clear Boundaries** - Domain separation, layered architecture
4. ✅ **Better Types** - Types live with domains, not centralized
5. ✅ **Improved Imports** - Path aliases, no `../../`

**Developer Experience Benefits:**
1. ✅ **Faster Onboarding** - Clear structure, good documentation
2. ✅ **Easier Changes** - Isolated modules, clear interfaces
3. ✅ **Better Debugging** - Structured logging, error tracking
4. ✅ **Confident Refactoring** - High test coverage, clear dependencies

---

### 9.2 Next Steps

**Immediate Actions:**
1. Review this proposal with team/stakeholders
2. Get approval for phased migration approach
3. Set up development branch for refactoring work
4. Begin Phase 1: Foundation implementation

**Decision Points:**
- Approve overall architecture direction
- Confirm phased migration strategy
- Allocate resources (4-6 weeks development time)
- Set success criteria and review checkpoints

**Resources Needed:**
- 1 senior developer (full-time, 4-6 weeks)
- Architecture review sessions (weekly)
- Testing resources (QA validation after each phase)

---

### 9.3 Long-Term Vision

This refactoring sets the foundation for NEWO CLI to become:

1. **Platform Hub** - Central tool for all NEWO platform management
2. **Developer SDK** - Programmatic API for NEWO automation
3. **CI/CD Cornerstone** - Deep integration with deployment pipelines
4. **Extensible Ecosystem** - Third-party plugins and integrations
5. **Enterprise-Ready** - Multi-tenant, audit logs, compliance

**Future Capabilities Enabled:**
- GraphQL API alongside REST
- Real-time sync with WebSocket
- Visual studio code extension
- Desktop GUI application
- Cloud-hosted CLI runner

---

## Appendices

### Appendix A: Glossary

**Domain** - Business capability area (sync, entities, migration, etc.)
**Command Pattern** - Design pattern for encapsulating operations
**DI (Dependency Injection)** - Technique for loose coupling via injected dependencies
**Repository Pattern** - Abstraction over data storage
**Strategy Pattern** - Encapsulation of interchangeable algorithms
**ADR (Architecture Decision Record)** - Documentation of architectural decisions

---

### Appendix B: Reference Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                         CLI Layer                            │
│  NewoCliApp → CommandExecutor → CommandRegistry             │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────┴────────────────────────────────────┐
│                    Application Layer                         │
│  Commands (Pull, Push, Status, Migrate, etc.)               │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────┴────────────────────────────────────┐
│                      Domain Layer                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │   Sync   │  │ Entities │  │Migration │  │Integration│   │
│  │  Domain  │  │  Domain  │  │  Domain  │  │  Domain   │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────┴────────────────────────────────────┐
│                  Infrastructure Layer                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │   API    │  │   Auth   │  │  Storage │  │  Logging │   │
│  │  Client  │  │  Service │  │  Service │  │  Service │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└─────────────────────────────────────────────────────────────┘

Dependency Flow: CLI → Application → Domain → Infrastructure
```

---

### Appendix C: File Size Comparison

**Before Refactoring:**
```
types.ts          833 lines  →  Split across 7 domain files (<150 each)
migrate.ts        746 lines  →  Split into 7 service/strategy files (<200 each)
push.ts           624 lines  →  Split into 5 service/factory files (<150 each)
projects.ts       578 lines  →  Split into 4 service files (<200 each)
api.ts            554 lines  →  Split into 7 endpoint files (<100 each)
auth.ts           419 lines  →  Split into 4 strategy files (<150 each)
```

**Result:** No file >300 lines, most <200 lines

---

### Appendix D: Command Migration Checklist

For each command migration:

**Pre-Migration:**
- [ ] Read current implementation thoroughly
- [ ] Identify dependencies (API calls, file operations, etc.)
- [ ] Check existing tests
- [ ] Document edge cases

**Implementation:**
- [ ] Create Command class implementing Command interface
- [ ] Define CommandMetadata (name, usage, examples)
- [ ] Implement validate() method
- [ ] Implement execute() method with injected dependencies
- [ ] Register command in bootstrap
- [ ] Create adapter for backward compatibility

**Testing:**
- [ ] Write unit tests for command
- [ ] Write integration tests
- [ ] Run existing tests (should still pass with adapter)
- [ ] Manual testing in dev environment

**Documentation:**
- [ ] Update command documentation
- [ ] Add examples to metadata
- [ ] Update migration tracking

**Cleanup (after all commands migrated):**
- [ ] Remove old command handler
- [ ] Remove adapter
- [ ] Update imports

---

### Appendix E: Questions for Review

**Architecture:**
1. Does the proposed structure align with project goals?
2. Are there any domains we should add/remove/merge?
3. Should we use classes or keep functional approach for services?

**Migration:**
1. Is 4-6 weeks reasonable for this refactoring?
2. Should we do it all at once or incrementally ship phases?
3. What are the must-have features for each phase?

**Testing:**
1. What is acceptable test coverage target?
2. Should we add E2E tests before or after refactoring?
3. Do we need performance benchmarks?

**Tooling:**
1. Should we add linting for architectural rules?
2. Do we need dependency graph visualization?
3. Should we automate code quality checks in CI?

---

**End of Document**

---

## Document Metadata

**Version:** 1.0
**Last Updated:** October 20, 2025
**Status:** Proposal - Awaiting Review
**Next Review:** Schedule architecture review meeting
**Reviewers:** Technical lead, senior developers, product owner
**Estimated Reading Time:** 45 minutes
**Estimated Implementation:** 4-6 weeks

---

## Feedback & Questions

Please direct feedback to:
- Architecture questions → [Create GitHub Discussion]
- Implementation concerns → [Open GitHub Issue]
- Timeline questions → [Contact Project Manager]

---
