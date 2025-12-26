# NEWO CLI Architecture Redesign Proposal V2

**Document Version:** 2.0 (Revised for Resource-Oriented Architecture)
**Date:** October 20, 2025
**Author:** Professional Software Architect Analysis
**Status:** Proposal - No Code Changes Yet
**Revision Focus:** Proper code reuse through resource-oriented design

---

## Executive Summary

This is a **revised architectural proposal** that addresses the critical insight: **all commands operate on the same underlying resources** (Projects, Integrations, AKB, Attributes). The original proposal inadvertently created silos by organizing around operations (sync/, entities/, migration/), which would have led to code duplication.

### The Core Insight

**Problem with V1 Approach:**
```
❌ Bad: Organize by operation (creates duplication)
domains/
  ├── sync/commands/pull.ts              # Pulls projects, integrations, AKB, attributes
  ├── integration/commands/pull-integrations.ts  # Duplicates pull logic for integrations
  ├── knowledge/commands/pull-akb.ts     # Duplicates pull logic for AKB
  └── migration/                         # Has to duplicate ALL pull/push logic

Result: Same sync logic written 4+ times for different resources
```

**V2 Solution: Resource-Oriented Architecture**
```
✅ Good: Organize by resource + generic operations (enables reuse)
domain/
  ├── resources/           # What we manage (entities)
  │   ├── project/         # Projects, Agents, Flows, Skills
  │   ├── integration/     # Integrations, Connectors, Webhooks
  │   ├── knowledge/       # AKB articles
  │   └── attribute/       # Customer & Project attributes
  │
  └── operations/          # How we manage them (behaviors)
      ├── SyncEngine.ts    # Generic pull/push for ALL resources
      ├── MigrationEngine.ts  # Pull(source) + Push(dest) using SyncEngine
      └── EntityManager.ts    # Generic create/delete for ALL resources
```

### Key Benefits of V2

1. **90% code reuse** - One sync engine handles all resources (projects, integrations, AKB, attributes)
2. **Migration = composition** - `pull(source) + push(dest)` using same sync engine
3. **Strategy pattern** - Resource-specific behavior encapsulated in strategies
4. **No duplication** - All commands use same underlying operations
5. **Easy to extend** - Adding new resource type = add one strategy class

---

## Part 1: Understanding the Domain Model

### 1.1 The Real Domain Structure

**NEWO Platform Resources** (what exists in the system):
```
Customer
  ├── Attributes (customer-level configuration)
  ├── Integrations
  │   ├── Connectors
  │   └── Webhooks (outgoing/incoming)
  ├── Conversations (user personas + chat history)
  └── Projects
      ├── Attributes (project-level configuration)
      ├── Agents
      │   └── Flows
      │       ├── Skills (.guidance or .jinja scripts)
      │       ├── Events
      │       └── States
      └── AKB (knowledge base articles per persona)
```

**Key Relationships:**
- All resources belong to a Customer
- Projects contain Agents → Flows → Skills hierarchy
- Integrations are customer-level
- AKB articles are linked to Personas/Agents
- Attributes exist at Customer and Project levels

### 1.2 Operations vs Resources

**The Critical Realization:**

| Operation | What It Really Does |
|-----------|---------------------|
| `pull` | Sync FROM platform → local for ALL resources |
| `push` | Sync FROM local → platform for ALL resources |
| `status` | Detect changes in ALL resources |
| `migrate` | `pull` from source + `push` to destination |
| `create-X` | Create local entity (any resource type) |
| `delete-X` | Delete local entity (any resource type) |
| `sandbox` | Test agent using Conversation resource |

**All operations work on the same resources!**

---

## Part 2: Resource-Oriented Architecture

### 2.1 Layered Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                   CLI Layer (Commands)                       │
│  PullCommand, PushCommand, MigrateCommand, CreateCommand    │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────┴────────────────────────────────────────┐
│              Application Layer (Use Cases)                   │
│  SyncEngine, MigrationEngine, EntityManager                 │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────┴────────────────────────────────────────┐
│                   Domain Layer                               │
│  ┌─────────────────────┐  ┌─────────────────────┐          │
│  │    Resources        │  │   Resource          │          │
│  │   (Entities)        │  │   Strategies        │          │
│  │                     │  │   (Behaviors)       │          │
│  │ • Project           │  │ • ProjectSync       │          │
│  │ • Integration       │  │ • IntegrationSync   │          │
│  │ • AkbArticle        │  │ • AkbSync           │          │
│  │ • Attribute         │  │ • AttributeSync     │          │
│  └─────────────────────┘  └─────────────────────┘          │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────┴────────────────────────────────────────┐
│              Infrastructure Layer                            │
│  API Client, File Storage, Hash Manager, Auth Service      │
└─────────────────────────────────────────────────────────────┘
```

**Dependency Flow:** CLI → Application → Domain → Infrastructure
**Data Flow:** Infrastructure ↔ Domain ↔ Application ↔ CLI

---

### 2.2 Proposed Directory Structure

```
newo-cli/
├── src/
│   ├── domain/                        # Pure domain logic (business entities)
│   │   ├── resources/                 # Domain entities (the "nouns")
│   │   │   ├── project/
│   │   │   │   ├── Project.ts         # Project aggregate root
│   │   │   │   ├── Agent.ts
│   │   │   │   ├── Flow.ts
│   │   │   │   ├── Skill.ts
│   │   │   │   ├── Event.ts
│   │   │   │   ├── State.ts
│   │   │   │   └── types.ts
│   │   │   │
│   │   │   ├── integration/
│   │   │   │   ├── Integration.ts
│   │   │   │   ├── Connector.ts
│   │   │   │   ├── Webhook.ts
│   │   │   │   └── types.ts
│   │   │   │
│   │   │   ├── knowledge/
│   │   │   │   ├── AkbArticle.ts
│   │   │   │   ├── AkbTopic.ts
│   │   │   │   └── types.ts
│   │   │   │
│   │   │   ├── attribute/
│   │   │   │   ├── CustomerAttribute.ts
│   │   │   │   ├── ProjectAttribute.ts
│   │   │   │   └── types.ts
│   │   │   │
│   │   │   ├── conversation/
│   │   │   │   ├── Conversation.ts
│   │   │   │   ├── UserPersona.ts
│   │   │   │   └── types.ts
│   │   │   │
│   │   │   └── common/
│   │   │       ├── Entity.ts          # Base entity class
│   │   │       ├── ValueObject.ts     # Base value object
│   │   │       └── types.ts
│   │   │
│   │   ├── strategies/                # Resource-specific behaviors
│   │   │   ├── sync/
│   │   │   │   ├── ISyncStrategy.ts   # Sync strategy interface
│   │   │   │   ├── ProjectSyncStrategy.ts
│   │   │   │   ├── IntegrationSyncStrategy.ts
│   │   │   │   ├── AkbSyncStrategy.ts
│   │   │   │   ├── AttributeSyncStrategy.ts
│   │   │   │   └── ConversationSyncStrategy.ts
│   │   │   │
│   │   │   └── entity/
│   │   │       ├── IEntityStrategy.ts  # Create/delete strategy interface
│   │   │       ├── ProjectEntityStrategy.ts
│   │   │       └── IntegrationEntityStrategy.ts
│   │   │
│   │   └── services/                  # Domain services (complex business logic)
│   │       ├── ChangeDetector.ts      # Detects changes across resources
│   │       ├── HashManager.ts         # SHA256 hash management
│   │       └── MetadataGenerator.ts   # Generates flows.yaml, metadata.yaml
│   │
│   ├── application/                   # Use cases (orchestration layer)
│   │   ├── sync/
│   │   │   ├── SyncEngine.ts          # Core: Orchestrates sync for ALL resources
│   │   │   ├── PullUseCase.ts         # Uses SyncEngine with all strategies
│   │   │   ├── PushUseCase.ts         # Uses SyncEngine with all strategies
│   │   │   └── StatusUseCase.ts       # Uses ChangeDetector
│   │   │
│   │   ├── migration/
│   │   │   ├── MigrationEngine.ts     # Orchestrates migration
│   │   │   ├── MigrateAccountUseCase.ts   # Pull(source) + Push(dest)
│   │   │   ├── VerifyMigrationUseCase.ts
│   │   │   └── WebhookMigrationUseCase.ts
│   │   │
│   │   ├── entity/
│   │   │   ├── EntityManager.ts       # Generic create/delete for all entities
│   │   │   ├── CreateEntityUseCase.ts
│   │   │   └── DeleteEntityUseCase.ts
│   │   │
│   │   └── testing/
│   │       ├── SandboxTestUseCase.ts  # Uses Conversation resource
│   │       └── ConversationPullUseCase.ts
│   │
│   ├── infrastructure/                # External systems & technical concerns
│   │   ├── api/                       # NEWO API client
│   │   │   ├── NewoApiClient.ts       # Main HTTP client
│   │   │   ├── endpoints/             # API endpoints (organized by resource)
│   │   │   │   ├── ProjectsApi.ts
│   │   │   │   ├── AgentsApi.ts
│   │   │   │   ├── FlowsApi.ts
│   │   │   │   ├── SkillsApi.ts
│   │   │   │   ├── IntegrationsApi.ts
│   │   │   │   ├── ConnectorsApi.ts
│   │   │   │   ├── WebhooksApi.ts
│   │   │   │   ├── AkbApi.ts
│   │   │   │   ├── AttributesApi.ts
│   │   │   │   ├── ConversationsApi.ts
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   ├── interceptors/          # Request/response interceptors
│   │   │   │   ├── AuthInterceptor.ts
│   │   │   │   ├── LoggingInterceptor.ts
│   │   │   │   ├── RetryInterceptor.ts
│   │   │   │   └── CacheInterceptor.ts
│   │   │   │
│   │   │   └── types.ts
│   │   │
│   │   ├── persistence/               # File system storage
│   │   │   ├── repositories/          # Repository implementations
│   │   │   │   ├── IRepository.ts     # Generic repository interface
│   │   │   │   ├── ProjectRepository.ts
│   │   │   │   ├── IntegrationRepository.ts
│   │   │   │   ├── AkbRepository.ts
│   │   │   │   ├── AttributeRepository.ts
│   │   │   │   └── ConversationRepository.ts
│   │   │   │
│   │   │   ├── FileSystemService.ts   # Low-level file operations
│   │   │   ├── YamlSerializer.ts      # YAML read/write
│   │   │   ├── PathResolver.ts        # Path management
│   │   │   └── types.ts
│   │   │
│   │   ├── auth/                      # Authentication
│   │   │   ├── AuthService.ts         # Main auth service
│   │   │   ├── strategies/            # Auth strategies
│   │   │   │   ├── IAuthStrategy.ts
│   │   │   │   ├── ApiKeyAuthStrategy.ts
│   │   │   │   ├── TokenAuthStrategy.ts
│   │   │   │   └── RefreshTokenStrategy.ts
│   │   │   │
│   │   │   ├── TokenManager.ts        # Token lifecycle
│   │   │   ├── validators.ts
│   │   │   └── types.ts
│   │   │
│   │   ├── config/                    # Configuration management
│   │   │   ├── EnvConfig.ts
│   │   │   ├── CustomerConfig.ts
│   │   │   └── types.ts
│   │   │
│   │   └── logging/                   # Logging infrastructure
│   │       ├── Logger.ts
│   │       ├── LogFormatter.ts
│   │       └── types.ts
│   │
│   ├── cli/                           # CLI entry point & command handlers
│   │   ├── commands/                  # Command implementations
│   │   │   ├── sync/
│   │   │   │   ├── PullCommand.ts
│   │   │   │   ├── PushCommand.ts
│   │   │   │   └── StatusCommand.ts
│   │   │   │
│   │   │   ├── migration/
│   │   │   │   ├── MigrateAccountCommand.ts
│   │   │   │   ├── VerifyMigrationCommand.ts
│   │   │   │   └── CreateWebhooksCommand.ts
│   │   │   │
│   │   │   ├── entity/
│   │   │   │   ├── CreateAgentCommand.ts
│   │   │   │   ├── CreateFlowCommand.ts
│   │   │   │   ├── CreateSkillCommand.ts
│   │   │   │   ├── DeleteAgentCommand.ts
│   │   │   │   ├── DeleteFlowCommand.ts
│   │   │   │   └── DeleteSkillCommand.ts
│   │   │   │
│   │   │   ├── testing/
│   │   │   │   ├── SandboxCommand.ts
│   │   │   │   └── ConversationsCommand.ts
│   │   │   │
│   │   │   └── utility/
│   │   │       ├── HelpCommand.ts
│   │   │       ├── ListCustomersCommand.ts
│   │   │       ├── ProfileCommand.ts
│   │   │       └── MetaCommand.ts
│   │   │
│   │   ├── framework/                 # Command framework
│   │   │   ├── Command.ts             # Base command interface
│   │   │   ├── CommandRegistry.ts
│   │   │   ├── CommandExecutor.ts
│   │   │   ├── CommandValidator.ts
│   │   │   └── types.ts
│   │   │
│   │   ├── errors/                    # Error handling
│   │   │   ├── ErrorHandler.ts
│   │   │   ├── CliError.ts
│   │   │   └── types.ts
│   │   │
│   │   ├── di/                        # Dependency injection
│   │   │   ├── Container.ts
│   │   │   ├── ServiceProvider.ts
│   │   │   └── tokens.ts
│   │   │
│   │   ├── bootstrap.ts               # App initialization & DI setup
│   │   ├── NewoCliApp.ts              # Main application class
│   │   └── index.ts                   # CLI entry point (#!/usr/bin/env node)
│   │
│   └── shared/                        # Shared utilities
│       ├── utils/
│       ├── constants/
│       └── types.ts
│
├── docs/                              # Documentation
│   ├── architecture/
│   │   ├── ARCHITECTURE.md            # This document
│   │   ├── RESOURCE_MODEL.md          # Resource domain model
│   │   ├── SYNC_ENGINE.md             # How sync works
│   │   └── ADRs/                      # Architecture Decision Records
│   ├── api/
│   ├── guides/
│   └── development/
│
└── test/
    ├── unit/
    │   ├── domain/
    │   ├── application/
    │   ├── infrastructure/
    │   └── cli/
    ├── integration/
    └── e2e/
```

**Key Improvements Over V1:**
1. ✅ **Resources organized by type** - Clear domain boundaries
2. ✅ **Strategies separated** - Behavior isolated from data
3. ✅ **Generic operations** - SyncEngine, EntityManager work on ALL resources
4. ✅ **No duplication** - Pull/push logic written once, used everywhere
5. ✅ **Clear layers** - Domain → Application → Infrastructure → CLI

---

## Part 3: The Core - Sync Engine

### 3.1 Generic Sync Strategy Pattern

**The Key to Code Reuse:**

```typescript
// src/domain/strategies/sync/ISyncStrategy.ts
export interface ISyncStrategy<TRemote, TLocal> {
  /**
   * Resource type identifier (e.g., 'projects', 'integrations', 'akb')
   */
  readonly resourceType: string;

  /**
   * Pull resources from NEWO platform
   */
  pull(customer: CustomerConfig): Promise<TLocal[]>;

  /**
   * Push local changes to NEWO platform
   */
  push(customer: CustomerConfig, changes: TLocal[]): Promise<void>;

  /**
   * Detect what has changed locally
   */
  getChanges(customer: CustomerConfig): Promise<TLocal[]>;

  /**
   * Validate local state before push
   */
  validate(customer: CustomerConfig, items: TLocal[]): Promise<ValidationResult>;
}
```

**Generic Sync Engine (Works for ALL Resources):**

```typescript
// src/application/sync/SyncEngine.ts
export class SyncEngine {
  constructor(
    private strategies: ISyncStrategy<any, any>[],
    private logger: Logger
  ) {}

  /**
   * Pull ALL resources using registered strategies
   */
  async pullAll(customer: CustomerConfig, silentOverwrite: boolean = false): Promise<void> {
    this.logger.info(`Pulling all resources for customer: ${customer.idn}`);

    for (const strategy of this.strategies) {
      this.logger.info(`Pulling ${strategy.resourceType}...`);

      try {
        const items = await strategy.pull(customer);
        this.logger.info(`✓ Pulled ${items.length} ${strategy.resourceType}`);
      } catch (error) {
        this.logger.error(`✗ Failed to pull ${strategy.resourceType}`, error);
        throw new SyncError(`Failed to pull ${strategy.resourceType}`, error);
      }
    }

    this.logger.info(`✅ Pull completed for all resources`);
  }

  /**
   * Push ALL changed resources using registered strategies
   */
  async pushAll(customer: CustomerConfig): Promise<void> {
    this.logger.info(`Pushing changes for customer: ${customer.idn}`);

    for (const strategy of this.strategies) {
      this.logger.info(`Checking changes for ${strategy.resourceType}...`);

      const changes = await strategy.getChanges(customer);

      if (changes.length === 0) {
        this.logger.info(`No changes for ${strategy.resourceType}`);
        continue;
      }

      this.logger.info(`Found ${changes.length} changes in ${strategy.resourceType}`);

      // Validate before push
      const validation = await strategy.validate(customer, changes);
      if (!validation.valid) {
        throw new ValidationError(validation.errors);
      }

      // Push changes
      try {
        await strategy.push(customer, changes);
        this.logger.info(`✓ Pushed ${changes.length} ${strategy.resourceType}`);
      } catch (error) {
        this.logger.error(`✗ Failed to push ${strategy.resourceType}`, error);
        throw new SyncError(`Failed to push ${strategy.resourceType}`, error);
      }
    }

    this.logger.info(`✅ Push completed for all resources`);
  }

  /**
   * Get status for ALL resources
   */
  async getStatus(customer: CustomerConfig): Promise<StatusReport> {
    const report: StatusReport = {
      customer: customer.idn,
      resources: []
    };

    for (const strategy of this.strategies) {
      const changes = await strategy.getChanges(customer);

      report.resources.push({
        type: strategy.resourceType,
        changedCount: changes.length,
        changes: changes.map(c => ({
          path: c.path,
          operation: c.operation // 'created' | 'modified' | 'deleted'
        }))
      });
    }

    return report;
  }
}
```

**Benefits:**
- ✅ One sync engine handles projects, integrations, AKB, attributes, conversations
- ✅ Adding new resource = implement one strategy class
- ✅ No duplicate pull/push logic
- ✅ Easy to test (mock strategies)

---

### 3.2 Example: Project Sync Strategy

```typescript
// src/domain/strategies/sync/ProjectSyncStrategy.ts
export class ProjectSyncStrategy implements ISyncStrategy<ProjectApiResponse, ProjectData> {
  readonly resourceType = 'projects';

  constructor(
    private apiClient: NewoApiClient,
    private repository: ProjectRepository,
    private hashManager: HashManager,
    private metadataGenerator: MetadataGenerator
  ) {}

  async pull(customer: CustomerConfig): Promise<ProjectData[]> {
    // 1. Fetch from API
    const projects = await this.apiClient.projects.list();
    const projectDataList: ProjectData[] = [];

    // 2. For each project, fetch full structure (agents → flows → skills)
    for (const project of projects) {
      const agents = await this.apiClient.agents.list(project.id);

      const agentDataList = [];
      for (const agent of agents) {
        const flows = await this.apiClient.flows.list(agent.id);

        const flowDataList = [];
        for (const flow of flows) {
          const skills = await this.apiClient.skills.list(flow.id);
          const events = await this.apiClient.events.list(flow.id);
          const states = await this.apiClient.states.list(flow.id);

          flowDataList.push({
            id: flow.id,
            idn: flow.idn,
            skills,
            events,
            states
          });
        }

        agentDataList.push({
          id: agent.id,
          idn: agent.idn,
          flows: flowDataList
        });
      }

      projectDataList.push({
        id: project.id,
        idn: project.idn,
        agents: agentDataList
      });
    }

    // 3. Save to local filesystem via repository
    for (const projectData of projectDataList) {
      await this.repository.save(customer.idn, projectData);

      // Generate metadata files
      await this.metadataGenerator.generateProjectMetadata(customer.idn, projectData);
      await this.metadataGenerator.generateFlowsYaml(customer.idn, projectData);

      // Update hashes
      await this.hashManager.updateHashes(customer.idn, projectData);
    }

    return projectDataList;
  }

  async push(customer: CustomerConfig, changes: ProjectData[]): Promise<void> {
    for (const change of changes) {
      // Handle different change types
      if (change.operation === 'created') {
        await this.createEntity(customer, change);
      } else if (change.operation === 'modified') {
        await this.updateEntity(customer, change);
      } else if (change.operation === 'deleted') {
        // Delete operations handled separately (requires confirmation)
      }

      // Update hashes after successful push
      await this.hashManager.updateHashes(customer.idn, change);
    }
  }

  async getChanges(customer: CustomerConfig): Promise<ProjectData[]> {
    // Use hash manager to detect changes
    return this.hashManager.detectChanges(customer.idn, this.resourceType);
  }

  async validate(customer: CustomerConfig, items: ProjectData[]): Promise<ValidationResult> {
    const errors: ValidationError[] = [];

    for (const item of items) {
      // Validate project structure
      if (!item.idn) {
        errors.push({ field: 'idn', message: 'Project IDN is required' });
      }

      // Validate skills have correct file extensions
      for (const agent of item.agents) {
        for (const flow of agent.flows) {
          for (const skill of flow.skills) {
            const expectedExt = flow.default_runner_type === 'nsl' ? '.jinja' : '.guidance';
            if (!skill.script_path.endsWith(expectedExt)) {
              errors.push({
                field: 'skill.script_path',
                message: `Skill ${skill.idn} has wrong extension. Expected ${expectedExt}`
              });
            }
          }
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  private async createEntity(customer: CustomerConfig, project: ProjectData): Promise<void> {
    // Create project → agents → flows → skills hierarchy
    // ... implementation
  }

  private async updateEntity(customer: CustomerConfig, project: ProjectData): Promise<void> {
    // Update modified entities
    // ... implementation
  }
}
```

**Similar Strategies:**
- `IntegrationSyncStrategy` - Handles integrations + connectors + webhooks
- `AkbSyncStrategy` - Handles AKB articles
- `AttributeSyncStrategy` - Handles customer & project attributes
- `ConversationSyncStrategy` - Handles conversations

**All follow same pattern:**
1. Pull from API → Save to filesystem → Update hashes
2. Get changes by comparing hashes
3. Validate before push
4. Push changes to API → Update hashes

---

### 3.3 How Commands Use Sync Engine

**Pull Command (Works for ALL Resources):**
```typescript
// src/cli/commands/sync/PullCommand.ts
export class PullCommand implements Command {
  metadata: CommandMetadata = {
    name: 'pull',
    description: 'Pull ALL resources from NEWO platform',
    usage: 'newo pull [--customer <idn>] [--force]',
    category: 'sync'
  };

  constructor(
    private pullUseCase: PullUseCase,
    private customerSelector: CustomerSelector
  ) {}

  async execute(context: CommandContext): Promise<CommandResult> {
    const { selectedCustomer, allCustomers, isMultiCustomer } =
      this.customerSelector.select(context.customerConfig, context.args.customer);

    const silentOverwrite = Boolean(context.args.force || context.args.f);

    if (selectedCustomer) {
      await this.pullUseCase.execute(selectedCustomer, silentOverwrite);
    } else if (isMultiCustomer) {
      for (const customer of allCustomers) {
        await this.pullUseCase.execute(customer, silentOverwrite);
      }
    }

    return { success: true, message: '✅ Pull completed' };
  }
}

// src/application/sync/PullUseCase.ts
export class PullUseCase {
  constructor(private syncEngine: SyncEngine) {}

  async execute(customer: CustomerConfig, silentOverwrite: boolean): Promise<void> {
    // SyncEngine handles ALL resources (projects, integrations, AKB, attributes, conversations)
    await this.syncEngine.pullAll(customer, silentOverwrite);
  }
}
```

**Push Command (Works for ALL Resources):**
```typescript
// src/cli/commands/sync/PushCommand.ts
export class PushCommand implements Command {
  constructor(
    private pushUseCase: PushUseCase,
    private customerSelector: CustomerSelector
  ) {}

  async execute(context: CommandContext): Promise<CommandResult> {
    const customers = await this.customerSelector.selectForPush(
      context.customerConfig,
      context.args.customer
    );

    for (const customer of customers) {
      await this.pushUseCase.execute(customer);
    }

    return { success: true, message: '✅ Push completed' };
  }
}

// src/application/sync/PushUseCase.ts
export class PushUseCase {
  constructor(private syncEngine: SyncEngine) {}

  async execute(customer: CustomerConfig): Promise<void> {
    // SyncEngine handles ALL resources
    await this.syncEngine.pushAll(customer);
  }
}
```

**Key Point:** Commands are simple orchestrators. All logic is in SyncEngine + Strategies.

---

## Part 4: Migration = Composition

### 4.1 Migration Architecture

**The Insight:** Migration is just `pull(source) + transform + push(dest)` using the **same SyncEngine**.

```typescript
// src/application/migration/MigrationEngine.ts
export class MigrationEngine {
  constructor(
    private syncEngine: SyncEngine,
    private transformService: TransformService,
    private logger: Logger
  ) {}

  async migrateAccount(
    sourceCustomer: CustomerConfig,
    destCustomer: CustomerConfig,
    options: MigrationOptions
  ): Promise<MigrationResult> {
    this.logger.info('Starting account migration');
    this.logger.info(`Source: ${sourceCustomer.idn}`);
    this.logger.info(`Destination: ${destCustomer.idn}`);

    // 1. PULL from source account (uses SyncEngine)
    this.logger.info('Step 1/3: Pulling from source account...');
    await this.syncEngine.pullAll(sourceCustomer, true); // silent overwrite

    // 2. TRANSFORM data (clear IDs, update references)
    this.logger.info('Step 2/3: Transforming data for destination...');
    const transformed = await this.transformService.transformForMigration(
      sourceCustomer.idn,
      destCustomer.idn
    );

    // 3. PUSH to destination account (uses SyncEngine)
    this.logger.info('Step 3/3: Pushing to destination account...');
    await this.syncEngine.pushAll(destCustomer);

    this.logger.info('✅ Migration completed successfully');

    return {
      success: true,
      sourceCustomer: sourceCustomer.idn,
      destCustomer: destCustomer.idn,
      migratedResources: transformed.resourceCounts
    };
  }
}

// src/application/migration/TransformService.ts
export class TransformService {
  async transformForMigration(
    sourceIdn: string,
    destIdn: string
  ): Promise<TransformResult> {
    // Read from source customer's local files
    const sourceDir = `newo_customers/${sourceIdn}`;
    const destDir = `newo_customers/${destIdn}`;

    // Copy directory structure
    await fs.copy(sourceDir, destDir);

    // Clear all IDs in metadata files (will be regenerated on push)
    await this.clearEntityIds(destDir);

    // Update customer-specific references
    await this.updateCustomerReferences(destDir, destIdn);

    return {
      resourceCounts: {
        projects: await this.countProjects(destDir),
        integrations: await this.countIntegrations(destDir),
        akbArticles: await this.countAkbArticles(destDir),
        attributes: await this.countAttributes(destDir)
      }
    };
  }

  private async clearEntityIds(dir: string): Promise<void> {
    // Find all metadata.yaml files
    const metadataFiles = await glob(`${dir}/**/metadata.yaml`);

    for (const file of metadataFiles) {
      const metadata = await yaml.load(await fs.readFile(file, 'utf-8'));

      // Clear ID fields (will be set by platform on creation)
      delete metadata.id;
      if (metadata.agent) delete metadata.agent.id;
      if (metadata.flow) delete metadata.flow.id;

      await fs.writeFile(file, yaml.dump(metadata));
    }
  }
}
```

**Benefits:**
- ✅ No duplicate migration code for each resource type
- ✅ Migration inherits all sync improvements automatically
- ✅ Easy to add selective migration (migrate only projects, only integrations, etc.)
- ✅ Transformation logic isolated in TransformService

---

### 4.2 Migration Command

```typescript
// src/cli/commands/migration/MigrateAccountCommand.ts
export class MigrateAccountCommand implements Command {
  metadata: CommandMetadata = {
    name: 'migrate-account',
    description: 'Migrate complete account from source to destination',
    usage: 'newo migrate-account --source <src-idn> --dest <dst-idn> [--yes]',
    category: 'migration'
  };

  constructor(
    private migrationUseCase: MigrateAccountUseCase,
    private customerSelector: CustomerSelector
  ) {}

  async validate(context: CommandContext): Promise<ValidationResult> {
    const errors: ValidationError[] = [];

    if (!context.args.source) {
      errors.push({ field: 'source', message: 'Source customer IDN is required' });
    }

    if (!context.args.dest) {
      errors.push({ field: 'dest', message: 'Destination customer IDN is required' });
    }

    return { valid: errors.length === 0, errors };
  }

  async execute(context: CommandContext): Promise<CommandResult> {
    const sourceCustomer = this.customerSelector.getByIdn(
      context.customerConfig,
      context.args.source as string
    );

    const destCustomer = this.customerSelector.getByIdn(
      context.customerConfig,
      context.args.dest as string
    );

    // Confirm migration unless --yes flag
    if (!context.args.yes) {
      const confirmed = await this.confirmMigration(sourceCustomer, destCustomer);
      if (!confirmed) {
        return { success: false, message: 'Migration cancelled by user' };
      }
    }

    const result = await this.migrationUseCase.execute(sourceCustomer, destCustomer);

    return {
      success: true,
      message: `✅ Migrated ${result.migratedResources.projects} projects, ` +
               `${result.migratedResources.integrations} integrations, ` +
               `${result.migratedResources.akbArticles} AKB articles`
    };
  }

  private async confirmMigration(
    source: CustomerConfig,
    dest: CustomerConfig
  ): Promise<boolean> {
    console.log('\n⚠️  Account Migration');
    console.log(`   Source: ${source.idn}`);
    console.log(`   Destination: ${dest.idn}`);
    console.log('   This will copy ALL resources from source to destination.');

    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const answer = await new Promise<string>((resolve) => {
      rl.question('\n   Proceed? (yes/no): ', resolve);
    });
    rl.close();

    return answer.toLowerCase() === 'yes';
  }
}
```

**Key Point:** Migration command is simple. All complexity is in MigrationEngine which reuses SyncEngine.

---

## Part 5: Entity Management

### 5.1 Generic Entity Manager

**Same pattern - one manager for all entity types:**

```typescript
// src/application/entity/EntityManager.ts
export class EntityManager {
  constructor(
    private strategies: Map<EntityType, IEntityStrategy>,
    private repository: IRepository,
    private logger: Logger
  ) {}

  async create(
    entityType: EntityType,
    entityData: CreateEntityRequest
  ): Promise<CreateEntityResult> {
    const strategy = this.strategies.get(entityType);
    if (!strategy) {
      throw new Error(`No strategy found for entity type: ${entityType}`);
    }

    // Validate
    const validation = await strategy.validate(entityData);
    if (!validation.valid) {
      throw new ValidationError(validation.errors);
    }

    // Create locally
    const entity = await strategy.create(entityData);

    // Save to filesystem
    await this.repository.save(entity);

    this.logger.info(`✅ Created ${entityType}: ${entity.idn}`);

    return {
      success: true,
      entity,
      message: `Run 'newo push' to create on NEWO platform`
    };
  }

  async delete(
    entityType: EntityType,
    entityId: string,
    confirmed: boolean = false
  ): Promise<DeleteEntityResult> {
    const strategy = this.strategies.get(entityType);
    if (!strategy) {
      throw new Error(`No strategy found for entity type: ${entityType}`);
    }

    if (!confirmed) {
      throw new Error('Deletion must be confirmed with --confirm flag');
    }

    // Delete locally
    await strategy.delete(entityId);

    this.logger.info(`✅ Deleted ${entityType}: ${entityId}`);

    return {
      success: true,
      message: `Deleted locally. Changes will NOT sync to platform.`
    };
  }
}

// src/domain/strategies/entity/IEntityStrategy.ts
export interface IEntityStrategy<T> {
  validate(data: CreateEntityRequest): Promise<ValidationResult>;
  create(data: CreateEntityRequest): Promise<T>;
  delete(id: string): Promise<void>;
}
```

**Entity Strategies:**
```typescript
// src/domain/strategies/entity/ProjectEntityStrategy.ts
export class ProjectEntityStrategy implements IEntityStrategy<Project> {
  async validate(data: CreateProjectRequest): Promise<ValidationResult> {
    // Validate project creation data
  }

  async create(data: CreateProjectRequest): Promise<Project> {
    // Create project locally (metadata.yaml, directory structure)
  }

  async delete(id: string): Promise<void> {
    // Delete project directory
  }
}

// Similar for: AgentEntityStrategy, FlowEntityStrategy, SkillEntityStrategy, etc.
```

**Benefits:**
- ✅ One entity manager for all types
- ✅ No duplicate create/delete logic
- ✅ Easy to add new entity types

---

## Part 6: Dependency Injection Setup

### 6.1 Service Registration

**All strategies registered in DI container:**

```typescript
// src/cli/bootstrap.ts
export function createServiceContainer(
  customerConfig: MultiCustomerConfig,
  verbose: boolean
): ServiceContainer {
  const container = new ServiceContainer();

  // === Infrastructure Layer ===

  // Logging
  container.registerSingleton(TOKENS.LOGGER, new Logger(verbose));

  // Auth
  container.register(TOKENS.AUTH_SERVICE, () =>
    new AuthService(container.get(TOKENS.LOGGER))
  );

  // API Client
  container.register(TOKENS.API_CLIENT, () =>
    new NewoApiClient(
      container.get(TOKENS.AUTH_SERVICE),
      container.get(TOKENS.LOGGER)
    )
  );

  // File System
  container.registerSingleton(TOKENS.FILE_SYSTEM, new FileSystemService());
  container.registerSingleton(TOKENS.HASH_MANAGER, new HashManager());
  container.registerSingleton(TOKENS.METADATA_GENERATOR, new MetadataGenerator());

  // Repositories
  container.register(TOKENS.PROJECT_REPOSITORY, () =>
    new ProjectRepository(
      container.get(TOKENS.FILE_SYSTEM),
      container.get(TOKENS.HASH_MANAGER)
    )
  );
  // ... other repositories

  // === Domain Layer ===

  // Sync Strategies
  container.register(TOKENS.PROJECT_SYNC_STRATEGY, () =>
    new ProjectSyncStrategy(
      container.get(TOKENS.API_CLIENT),
      container.get(TOKENS.PROJECT_REPOSITORY),
      container.get(TOKENS.HASH_MANAGER),
      container.get(TOKENS.METADATA_GENERATOR)
    )
  );

  container.register(TOKENS.INTEGRATION_SYNC_STRATEGY, () =>
    new IntegrationSyncStrategy(
      container.get(TOKENS.API_CLIENT),
      container.get(TOKENS.INTEGRATION_REPOSITORY),
      container.get(TOKENS.HASH_MANAGER)
    )
  );

  container.register(TOKENS.AKB_SYNC_STRATEGY, () =>
    new AkbSyncStrategy(
      container.get(TOKENS.API_CLIENT),
      container.get(TOKENS.AKB_REPOSITORY),
      container.get(TOKENS.HASH_MANAGER)
    )
  );

  container.register(TOKENS.ATTRIBUTE_SYNC_STRATEGY, () =>
    new AttributeSyncStrategy(
      container.get(TOKENS.API_CLIENT),
      container.get(TOKENS.ATTRIBUTE_REPOSITORY),
      container.get(TOKENS.HASH_MANAGER)
    )
  );

  container.register(TOKENS.CONVERSATION_SYNC_STRATEGY, () =>
    new ConversationSyncStrategy(
      container.get(TOKENS.API_CLIENT),
      container.get(TOKENS.CONVERSATION_REPOSITORY)
    )
  );

  // === Application Layer ===

  // Sync Engine (uses ALL sync strategies)
  container.register(TOKENS.SYNC_ENGINE, () =>
    new SyncEngine(
      [
        container.get(TOKENS.PROJECT_SYNC_STRATEGY),
        container.get(TOKENS.INTEGRATION_SYNC_STRATEGY),
        container.get(TOKENS.AKB_SYNC_STRATEGY),
        container.get(TOKENS.ATTRIBUTE_SYNC_STRATEGY),
        container.get(TOKENS.CONVERSATION_SYNC_STRATEGY)
      ],
      container.get(TOKENS.LOGGER)
    )
  );

  // Migration Engine (uses SyncEngine)
  container.register(TOKENS.MIGRATION_ENGINE, () =>
    new MigrationEngine(
      container.get(TOKENS.SYNC_ENGINE),
      container.get(TOKENS.TRANSFORM_SERVICE),
      container.get(TOKENS.LOGGER)
    )
  );

  // Entity Manager (uses entity strategies)
  container.register(TOKENS.ENTITY_MANAGER, () =>
    new EntityManager(
      new Map([
        ['project', container.get(TOKENS.PROJECT_ENTITY_STRATEGY)],
        ['agent', container.get(TOKENS.AGENT_ENTITY_STRATEGY)],
        ['flow', container.get(TOKENS.FLOW_ENTITY_STRATEGY)],
        ['skill', container.get(TOKENS.SKILL_ENTITY_STRATEGY)]
      ]),
      container.get(TOKENS.REPOSITORY),
      container.get(TOKENS.LOGGER)
    )
  );

  // Use Cases
  container.register(TOKENS.PULL_USE_CASE, () =>
    new PullUseCase(container.get(TOKENS.SYNC_ENGINE))
  );

  container.register(TOKENS.PUSH_USE_CASE, () =>
    new PushUseCase(container.get(TOKENS.SYNC_ENGINE))
  );

  container.register(TOKENS.MIGRATE_USE_CASE, () =>
    new MigrateAccountUseCase(container.get(TOKENS.MIGRATION_ENGINE))
  );

  // === CLI Layer ===

  // Command Registry
  const registry = new CommandRegistry();

  // Register all commands
  registry.register(new PullCommand(
    container.get(TOKENS.PULL_USE_CASE),
    container.get(TOKENS.CUSTOMER_SELECTOR)
  ));

  registry.register(new PushCommand(
    container.get(TOKENS.PUSH_USE_CASE),
    container.get(TOKENS.CUSTOMER_SELECTOR)
  ));

  registry.register(new MigrateAccountCommand(
    container.get(TOKENS.MIGRATE_USE_CASE),
    container.get(TOKENS.CUSTOMER_SELECTOR)
  ));

  // ... register all other commands

  container.registerSingleton(TOKENS.COMMAND_REGISTRY, registry);

  // Command Executor
  container.register(TOKENS.COMMAND_EXECUTOR, () =>
    new CommandExecutor(
      container.get(TOKENS.COMMAND_REGISTRY),
      container.get(TOKENS.ERROR_HANDLER),
      container.get(TOKENS.LOGGER)
    )
  );

  return container;
}
```

**Key Point:** All dependencies explicitly wired. Easy to see relationships. Easy to test (swap implementations).

---

## Part 7: Code Reuse Comparison

### 7.1 V1 (Command-Based) vs V2 (Resource-Based)

**V1 Approach (DUPLICATED CODE):**
```typescript
// pull.ts - handles projects
async function pullProjects() {
  const projects = await api.getProjects();
  for (const project of projects) {
    const agents = await api.getAgents(project.id);
    // ... save to filesystem
    // ... update hashes
  }
}

// pull-integrations.ts - DUPLICATES pull logic for integrations
async function pullIntegrations() {
  const integrations = await api.getIntegrations();
  for (const integration of integrations) {
    const connectors = await api.getConnectors(integration.id);
    // ... save to filesystem (SAME LOGIC)
    // ... update hashes (SAME LOGIC)
  }
}

// pull-akb.ts - DUPLICATES pull logic for AKB
async function pullAkb() {
  const articles = await api.getAkbArticles();
  // ... save to filesystem (SAME LOGIC AGAIN)
  // ... update hashes (SAME LOGIC AGAIN)
}

// migrate.ts - DUPLICATES EVERYTHING
async function migrate(source, dest) {
  // Has to duplicate ALL pull logic for all resources
  // Has to duplicate ALL push logic for all resources
  // Hundreds of lines of duplication
}
```

**V2 Approach (REUSED CODE):**
```typescript
// SyncEngine.ts - ONE implementation for ALL resources
class SyncEngine {
  async pullAll(customer) {
    for (const strategy of this.strategies) {
      await strategy.pull(customer);  // Strategy encapsulates resource-specific logic
    }
  }

  async pushAll(customer) {
    for (const strategy of this.strategies) {
      const changes = await strategy.getChanges(customer);
      await strategy.push(customer, changes);
    }
  }
}

// Each strategy is small and focused
class ProjectSyncStrategy implements ISyncStrategy { /* 100 lines */ }
class IntegrationSyncStrategy implements ISyncStrategy { /* 80 lines */ }
class AkbSyncStrategy implements ISyncStrategy { /* 70 lines */ }

// Migration REUSES SyncEngine
class MigrationEngine {
  async migrate(source, dest) {
    await this.syncEngine.pullAll(source);   // Reuse!
    await this.transform(source, dest);
    await this.syncEngine.pushAll(dest);     // Reuse!
  }
}
```

**Lines of Code Comparison:**

| Component | V1 (Duplicated) | V2 (Reused) | Savings |
|-----------|-----------------|-------------|---------|
| Pull logic | 200 × 5 resources = 1000 | 150 (engine) + 100 × 5 (strategies) = 650 | 35% |
| Push logic | 300 × 5 resources = 1500 | 200 (engine) + 120 × 5 (strategies) = 800 | 47% |
| Migration | 746 (duplicates everything) | 100 (orchestration only) | 87% |
| Status | 150 × 5 = 750 | 80 (engine) + 50 × 5 (strategies) = 330 | 56% |
| **Total** | **3996 lines** | **1880 lines** | **53% reduction** |

**Maintenance Comparison:**

| Task | V1 Effort | V2 Effort |
|------|-----------|-----------|
| Add new resource type | Write pull + push + status = 650 lines | Implement one strategy = 100 lines |
| Fix sync bug | Fix in 5 places (pull, pull-integrations, pull-akb, migrate, status) | Fix once in SyncEngine |
| Add retry logic | Modify 10+ files | Add one interceptor |
| Add validation | Modify 5+ files | Add to strategy interface |

---

## Part 8: Migration Strategy (Implementation Plan)

### 8.1 Phased Approach

**Phase 1: Infrastructure Foundation (Week 1)**
- Create new directory structure
- Implement DI container
- Create base interfaces (ISyncStrategy, IEntityStrategy, IRepository)
- Implement Command pattern framework
- Implement centralized error handling
- **No existing code touched**
- **Estimated:** 5 days
- **Risk:** Low

**Phase 2: Build Sync Engine (Week 2)**
- Implement SyncEngine with strategy pattern
- Implement ProjectSyncStrategy (migrate existing project sync logic)
- Implement IntegrationSyncStrategy
- Implement AkbSyncStrategy
- Implement AttributeSyncStrategy
- Implement ConversationSyncStrategy
- **Existing commands still work**
- **Estimated:** 5 days
- **Risk:** Medium

**Phase 3: Migrate Core Commands (Week 3)**
- Migrate Pull command to use SyncEngine
- Migrate Push command to use SyncEngine
- Migrate Status command to use SyncEngine
- Create adapter pattern to keep old exports working
- **All tests pass**
- **Estimated:** 5 days
- **Risk:** Low (adapters maintain compatibility)

**Phase 4: Migrate Migration (Week 4)**
- Implement MigrationEngine using SyncEngine
- Implement TransformService
- Migrate migrate-account, verify-migration, create-webhooks commands
- Remove duplicate migration code
- **Estimated:** 4 days
- **Risk:** Low (reusing proven SyncEngine)

**Phase 5: Migrate Entity Commands (Week 5)**
- Implement EntityManager with strategy pattern
- Migrate create-* commands (agent, flow, skill, etc.)
- Migrate delete-* commands
- **Estimated:** 5 days
- **Risk:** Low

**Phase 6: Cleanup & Documentation (Week 6)**
- Remove old sync modules (sync/projects.ts, sync/push.ts, sync/migrate.ts)
- Remove adapter pattern (direct imports to new structure)
- Update all documentation
- Performance benchmarking
- **Estimated:** 4 days
- **Risk:** Low

**Total: 6 weeks (28 days)**

---

### 8.2 Backward Compatibility

**Adapter Pattern During Migration:**
```typescript
// Old export (still works during migration)
// src/sync.ts
export async function pullAll(
  client: AxiosInstance,
  customer: CustomerConfig,
  projectId: string | null,
  verbose: boolean,
  silentOverwrite: boolean
): Promise<void> {
  // Adapter to new architecture
  const container = createServiceContainer({ customers: { [customer.idn]: customer } }, verbose);
  const pullUseCase = container.get<PullUseCase>(TOKENS.PULL_USE_CASE);
  await pullUseCase.execute(customer, silentOverwrite);
}

// Old code keeps working
import { pullAll } from './sync.js';
```

**After migration complete:**
```typescript
// Remove adapters, use new architecture directly
import { PullUseCase } from '@application/sync';
```

---

## Part 9: Testing Strategy

### 9.1 Unit Testing with Strategies

**Easy to test with mocks:**
```typescript
// test/unit/application/sync/SyncEngine.test.ts
describe('SyncEngine', () => {
  it('should pull from all strategies', async () => {
    const mockProjectStrategy = {
      resourceType: 'projects',
      pull: jest.fn().mockResolvedValue([{ id: 'p1' }])
    };

    const mockIntegrationStrategy = {
      resourceType: 'integrations',
      pull: jest.fn().mockResolvedValue([{ id: 'i1' }])
    };

    const syncEngine = new SyncEngine(
      [mockProjectStrategy, mockIntegrationStrategy],
      mockLogger
    );

    await syncEngine.pullAll(mockCustomer);

    expect(mockProjectStrategy.pull).toHaveBeenCalledWith(mockCustomer);
    expect(mockIntegrationStrategy.pull).toHaveBeenCalledWith(mockCustomer);
  });

  it('should handle strategy failures gracefully', async () => {
    const failingStrategy = {
      resourceType: 'projects',
      pull: jest.fn().mockRejectedValue(new Error('API error'))
    };

    const syncEngine = new SyncEngine([failingStrategy], mockLogger);

    await expect(syncEngine.pullAll(mockCustomer))
      .rejects.toThrow('Failed to pull projects');
  });
});
```

**Strategy testing is isolated:**
```typescript
// test/unit/domain/strategies/ProjectSyncStrategy.test.ts
describe('ProjectSyncStrategy', () => {
  it('should pull projects with full hierarchy', async () => {
    const mockApiClient = {
      projects: { list: jest.fn().mockResolvedValue([{ id: 'p1' }]) },
      agents: { list: jest.fn().mockResolvedValue([{ id: 'a1' }]) },
      // ... other mocks
    };

    const strategy = new ProjectSyncStrategy(
      mockApiClient,
      mockRepository,
      mockHashManager,
      mockMetadataGenerator
    );

    const result = await strategy.pull(mockCustomer);

    expect(result).toHaveLength(1);
    expect(mockApiClient.projects.list).toHaveBeenCalled();
    expect(mockRepository.save).toHaveBeenCalled();
  });
});
```

---

## Part 10: Benefits Summary

### 10.1 Code Quality Improvements

**Before (V1):**
- 202 duplicate error handlers
- 16 duplicate usage patterns
- 1000+ lines of duplicate sync logic across 5 files
- 746-line migrate.ts with all logic duplicated
- 34 command files with copy-paste structure

**After (V2):**
- 0 duplicate error handlers (centralized ErrorHandler)
- 0 duplicate usage patterns (metadata-driven)
- 150-line SyncEngine + 5 focused strategies (~100 lines each)
- 100-line MigrationEngine (reuses SyncEngine)
- 34 command files, each <100 lines, using DI

**Metrics:**
- **53% code reduction** in sync operations
- **87% code reduction** in migration
- **All files <300 lines** (currently 6 files >500 lines)
- **Test coverage >80%** (currently ~60%)

---

### 10.2 Developer Experience

**Adding New Resource Type:**

**Before:**
```
1. Create pull-new-resource.ts (200 lines)
2. Create push logic in push.ts (150 lines)
3. Add status logic in status.ts (100 lines)
4. Update migration to handle new resource (100 lines)
5. Create new command handler (80 lines)
6. Update help command manually
7. Total: 630 lines, 4 hours
```

**After:**
```
1. Create NewResourceSyncStrategy (100 lines)
2. Register strategy in bootstrap.ts (3 lines)
3. Total: 103 lines, 30 minutes
```

**Pull/push/status/migrate automatically work for new resource!**

---

### 10.3 Architectural Benefits

1. **Single Responsibility** - Each class has one clear purpose
2. **Open/Closed** - Add strategies without modifying SyncEngine
3. **Dependency Inversion** - Depend on interfaces, not concretions
4. **DRY** - No duplicate sync logic
5. **Testability** - Easy to mock strategies and test in isolation
6. **Scalability** - Can handle 100+ resource types with same pattern
7. **Maintainability** - Fix sync bugs once, affects all resources

---

## Part 11: Future Extensions

### 11.1 Easy to Add

**Selective Sync:**
```typescript
// Pull only specific resources
await syncEngine.pullSelected(customer, ['projects', 'integrations']);

// Push only specific resources
await syncEngine.pushSelected(customer, ['attributes']);
```

**Parallel Sync:**
```typescript
// Sync strategies in parallel
async pullAll(customer: CustomerConfig): Promise<void> {
  await Promise.all(
    this.strategies.map(s => s.pull(customer))
  );
}
```

**Incremental Sync:**
```typescript
// Only pull changed resources
async pullIncremental(customer: CustomerConfig, since: Date): Promise<void> {
  for (const strategy of this.strategies) {
    const changes = await strategy.getChangesSince(customer, since);
    if (changes.length > 0) {
      await strategy.pull(customer);
    }
  }
}
```

**Dry Run Mode:**
```typescript
async pushDryRun(customer: CustomerConfig): Promise<PreviewResult> {
  const preview: PreviewResult = { changes: [] };

  for (const strategy of this.strategies) {
    const changes = await strategy.getChanges(customer);
    preview.changes.push({
      resourceType: strategy.resourceType,
      items: changes
    });
  }

  return preview;
}
```

---

## Part 12: Conclusion

### 12.1 V2 vs V1 Comparison

| Aspect | V1 (Command-Based) | V2 (Resource-Based) |
|--------|-------------------|---------------------|
| **Organization** | By operation (sync/, entities/, migration/) | By resource + generic operations |
| **Code Reuse** | Low (duplicate sync logic 5× times) | High (one SyncEngine for all) |
| **Lines of Code** | ~4000 for sync operations | ~1900 for sync operations |
| **Maintainability** | Fix bugs in multiple places | Fix once, affects all |
| **Extensibility** | Add 630 lines per resource | Add 100 lines per resource |
| **Testing** | Complex (many files to mock) | Simple (mock strategies) |
| **Migration** | 746 lines of duplication | 100 lines of orchestration |

---

### 12.2 Recommendation

**Adopt V2 Architecture** for the following reasons:

1. **Dramatic code reduction** - 53% fewer lines for same functionality
2. **Proper code reuse** - Migration, pull, push, status all use same engine
3. **Future-proof** - Easy to add new resources and features
4. **Better testing** - Strategies are isolated and mockable
5. **Clearer structure** - Resources vs operations is intuitive
6. **Industry standard** - Repository + Strategy pattern is proven

**The key insight:** Commands are just **operations on resources**. Organizing by resources (domain model) with generic operations (behaviors) is the natural, maintainable architecture.

---

### 12.3 Next Steps

1. ✅ Review and approve V2 architecture
2. ✅ Schedule 6-week implementation sprint
3. ✅ Begin Phase 1: Infrastructure foundation
4. ✅ Weekly check-ins to validate progress
5. ✅ Performance benchmarking after Phase 3
6. ✅ Full regression testing after Phase 6

---

## Appendices

### Appendix A: File Size Targets

All files <300 lines:

| File Type | Current Max | Target Max | Strategy |
|-----------|-------------|------------|----------|
| Strategies | N/A | 150 lines | One per resource type |
| Use Cases | N/A | 100 lines | Thin orchestration |
| Commands | 365 lines | 80 lines | Delegate to use cases |
| Repositories | N/A | 200 lines | CRUD + queries |
| API Endpoints | N/A | 100 lines | One per resource |

---

### Appendix B: Strategy Interface Reference

**Complete ISyncStrategy Interface:**
```typescript
export interface ISyncStrategy<TRemote, TLocal> {
  // Identification
  readonly resourceType: string;

  // Core operations
  pull(customer: CustomerConfig): Promise<TLocal[]>;
  push(customer: CustomerConfig, changes: TLocal[]): Promise<void>;
  getChanges(customer: CustomerConfig): Promise<TLocal[]>;
  validate(customer: CustomerConfig, items: TLocal[]): Promise<ValidationResult>;

  // Optional: Incremental sync
  getChangesSince?(customer: CustomerConfig, since: Date): Promise<TLocal[]>;

  // Optional: Selective sync
  pullPartial?(customer: CustomerConfig, filter: ResourceFilter): Promise<TLocal[]>;
}
```

---

### Appendix C: Quick Reference - Adding New Resource

**Steps to add new resource type:**

1. Create domain model:
```typescript
// src/domain/resources/myresource/MyResource.ts
export class MyResource { /* ... */ }
```

2. Create sync strategy:
```typescript
// src/domain/strategies/sync/MyResourceSyncStrategy.ts
export class MyResourceSyncStrategy implements ISyncStrategy<ApiMyResource, MyResource> {
  readonly resourceType = 'myresource';
  async pull(customer) { /* ... */ }
  async push(customer, changes) { /* ... */ }
  async getChanges(customer) { /* ... */ }
  async validate(customer, items) { /* ... */ }
}
```

3. Create repository:
```typescript
// src/infrastructure/persistence/repositories/MyResourceRepository.ts
export class MyResourceRepository implements IRepository<MyResource> {
  async save(item) { /* ... */ }
  async load(id) { /* ... */ }
}
```

4. Create API endpoint:
```typescript
// src/infrastructure/api/endpoints/MyResourceApi.ts
export class MyResourceApi {
  async list() { /* ... */ }
  async create(data) { /* ... */ }
  async update(id, data) { /* ... */ }
}
```

5. Register in bootstrap:
```typescript
// src/cli/bootstrap.ts
container.register(TOKENS.MY_RESOURCE_SYNC_STRATEGY, () =>
  new MyResourceSyncStrategy(
    container.get(TOKENS.API_CLIENT),
    container.get(TOKENS.MY_RESOURCE_REPOSITORY),
    container.get(TOKENS.HASH_MANAGER)
  )
);

// Add to SyncEngine strategies array
new SyncEngine([
  // ... existing strategies,
  container.get(TOKENS.MY_RESOURCE_SYNC_STRATEGY)
], logger)
```

**Done!** Pull, push, status, and migrate now work for the new resource.

---

**End of Document**

---

## Document Metadata

**Version:** 2.0 (Revised Architecture)
**Replaces:** ARCHITECTURE_REDESIGN.md V1.0
**Last Updated:** October 20, 2025
**Status:** Proposal - Ready for Review
**Key Change:** Resource-oriented architecture with generic operations (53% code reduction)
**Implementation Time:** 6 weeks
**Code Reduction:** 53% in sync operations, 87% in migration
**Estimated LOC After Refactoring:** ~6500 (currently ~10000)
