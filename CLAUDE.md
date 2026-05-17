# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 🤖 Specialized Agents

This project uses specialized Claude Code agents for specific tasks:

- **📝 Changelog Agent** (`.claude/agents/changelog-agent.md`) - Maintains CHANGELOG.md following Keep a Changelog v1.1.0
  - Use: `"Use the changelog agent to add version X.Y.Z"`
  - See: `.claude/AGENTS.md` for quick reference

For complete agent documentation, see `.claude/agents/README.md`

## Product Overview

**NEWO CLI Tool** - A command-line utility enabling developers to work with **NEWO AI Agent skills** directly from their preferred IDEs without being bound to the NEWO web UI. Skills are written in two distinct formats:
- **Guidance scripts** (.guidance files) - AI guidance using natural language prompts
- **NSL scripts** (.jinja files) - NEWO Scripting Language using Jinja templating engine

Provides secure pull/push functionality to sync skills between local development environments and the NEWO platform via APIs.

### Purpose & Goals
1. **Full local development environment** - Edit, version control, and test NEWO AI skills in local IDEs with proper file extensions
2. **Secure synchronization** - Authenticated pulling/pushing using secure token-based authentication
3. **CI/CD readiness** - CLI commands integrated into automation pipelines
4. **Developer productivity** - Enable offline work, syntax highlighting, code linting, formatting, and local testing

### Target Users
- **AI Agent Developers** building flows and skills for NEWO AI Agents using Guidance prompts and NSL/Jinja templates
- **DevOps Engineers** setting up automated deployments for NEWO skills with proper CI/CD workflows
- **Product Engineers** integrating NEWO AI capabilities into larger application ecosystems

### Current Implementation Status
This implementation represents **Phase 3** of the product requirements:
- ✅ Authentication (API key exchange for access/refresh tokens)
- ✅ Pull & push scripts functionality
- ✅ Basic CI/CD push command support
- ✅ Project & agent listing capabilities
- ✅ flows.yaml generation with complete project structure export
- ✅ SHA256-based change detection for efficient sync
- ✅ Multi-project workspace support (NEW in v1.4.0)
- ✅ Project metadata collection and storage
- ✅ Flexible single/multi-project operation modes
- ✅ **Full TypeScript refactoring with modern best practices**
- ✅ **Comprehensive type safety and IDE support**
- ✅ **Customer attributes pull/push functionality** (v1.7.0)
- ✅ **Complete metadata and flows.yaml synchronization** (v1.8.0)
- ✅ **Comprehensive change tracking for all file types** (v1.8.0)
- ✅ **User conversations pull functionality** (v1.9.0)
- ✅ **Modular architecture refactoring** (v1.9.3) - Split monolithic files into maintainable modules
- ✅ **Entity creation and deletion commands** (v3.0.0) - Full entity management
- ✅ **Sandbox chat testing** (v3.1.0) - Real-time agent testing
- ✅ **Integration management** (NEW v3.2.0) - Full connector CRUD, webhook sync
- ✅ **AKB knowledge base management** (NEW v3.2.0) - Complete pull/push
- ✅ **Project attributes** (NEW v3.2.0) - Full pull/push support
- ✅ **Developer tools** (NEW v3.2.0) - Profile viewer, script actions catalog
- ✅ **Account migration** (NEW v3.3.0) - Fully automated account copying with verification
- ✅ **Webhook automation** (NEW v3.3.0) - Automatic webhook creation from YAML files
- ✅ **Pull enhancements** (NEW v3.3.0) - Deletion detection with interactive confirmation
- ✅ **Project Registry** (NEW v3.4.0) - Browse and install project templates from registries
- ✅ **Analytics Logs** (NEW v3.5.0) - Real-time log viewing with filtering and tail mode
- ✅ **Customer Creation** (NEW v3.5.0) - Programmatic NEWO customer account creation via v3 API
- ✅ **NEWO V2 Format Support** (NEW v3.6.0) - Dual format: cli_v1 (native) + newo_v2 (platform compatible)
- ✅ **Libraries** (NEW v3.6.0) - Library entity pull/push in both formats
- ✅ **Bulk Export** (NEW v3.6.0) - V2 ZIP download via `newo export`
- ✅ **Format Auto-Detection** (NEW v3.6.0) - Per-customer format detection, NEWO_FORMAT env, --format flag
- ✅ **Lint / Format / Check** (NEW v3.7.0) - DSL static analysis via `newo-dsl-analyzer`. Same engine as the VS Code extension. SARIF output, `.neworc.yaml` config, `--changed` hash-diff, `--live` API refresh, offline-capable
- ✅ **Flow Metadata Sync on push** (NEW v3.7.2) - `newo push` now reconciles flow title, events, and state_fields from local `metadata.yaml` (V1) or `{FlowIdn}.yaml` (V2) to the platform. Hash-gated full sync (create/update/delete) with new `PATCH /flows/{id}`, `PATCH /flows/events/{id}`, `PUT /flows/states/{id}` endpoints. Closes GH issue [#3](https://github.com/sabbah13/newo-cli/issues/3)
- 🔄 Future: Watch mode for lint, concrete formatting rules, plugin marketplace

### NEW: Modular Architecture (v1.9.3+)
The codebase has been refactored from monolithic files into a clean, maintainable modular architecture:

**CLI Modules (`src/cli/`):**
- `cli.ts` - Main CLI entry point with command routing using switch/case pattern
- `errors.ts` - Centralized error handling and user-friendly messages
- `customer-selection.ts` - Customer management, selection logic, and interactive prompts
- `commands/` - Individual command handlers (37 modular commands):
  - Core: `pull.ts`, `push.ts`, `status.ts`, `help.ts`
  - Data: `conversations.ts`, `pull-attributes.ts`, `import-akb.ts`
  - Entity Management: `create-agent.ts`, `create-flow.ts`, `create-skill.ts`, `create-project.ts`
  - Advanced: `create-event.ts`, `create-state.ts`, `create-parameter.ts`, `create-persona.ts`, `create-attribute.ts`
  - Deletion: `delete-agent.ts`, `delete-flow.ts`, `delete-skill.ts`
  - **Integration (v3.2.0):** `pull-integrations.ts`, `push-integrations.ts`, `list-actions.ts`, `profile.ts`
  - **AKB (v3.2.0):** `pull-akb.ts`, `push-akb.ts`
  - **Migration (v3.3.0):** `migrate-account.ts`, `verify-migration.ts`, `create-webhooks.ts`
  - **Registry (v3.4.0):** `list-registries.ts`, `list-registry-items.ts`, `add-project.ts`
  - **Analytics (v3.5.0):** `logs.ts` - Real-time log viewing with filters and tail mode
  - **Customer Management (v3.5.0):** `create-customer.ts` - Programmatic customer creation
  - **Format & Export (v3.6.0):** `export.ts` - V2 bulk ZIP download
  - **Lint/Format/Check (v3.7.0):** `lint.ts`, `format.ts`, `check.ts` - DSL static analysis via `newo-dsl-analyzer`
  - Utility: `meta.ts`, `list-customers.ts`, `sandbox.ts`

**Lint Module (`src/lint/`):** (NEW v3.7.0)
- `discovery.ts` - Format-aware file walker for `newo_customers/**/*.{jinja,guidance,nsl,nslg}` with `--changed` hash-diff support
- `config.ts` - `.neworc.yaml` loader (thin wrapper over `newo-dsl-analyzer`'s `loadConfig`)
- `live-schema.ts` - Caches `/api/v1/script/actions` response to `.newo/{customer}/actions.json` for `--live`
- `reporters/{text,json,sarif}.ts` - Output formats (SARIF 2.1.0 compatible with GitHub Code Scanning)

External dependency (v3.7.0+): `newo-dsl-analyzer` + `newo-dsl-core`. Both published from the [newo-nsl-lsp](https://github.com/newo-ai/newo-nsl-lsp) monorepo. The analyzer is the SAME engine that powers the VS Code extension - no drift between editor and CI diagnostics.

**Format Module (`src/format/`):** (NEW v3.6.0)
- `types.ts` - FormatVersion type (`cli_v1` | `newo_v2`), extension maps
- `detect.ts` - Per-customer format auto-detection (import_version.txt / projects/ dir)
- `extensions.ts` - Format-aware file extension mapping (.guidance/.jinja vs .nslg/.nsl)
- `paths-v2.ts` - V2 directory path generation
- `v2-yaml.ts` - V2 YAML parsers/generators (flow YAML with inline skills)
- `yaml-patch.ts` - Post-processor to match pyyaml formatting style

**Sync Modules (`src/sync/`):**
- `sync.ts` - Legacy sync operations (push/pull core logic, to be refactored)
- `projects.ts` - Project synchronization with progress tracking and deletion detection (enhanced v3.3.0)
- `push.ts` - Push operations with entity creation, validation, and project attributes (flow metadata sync wired in v3.7.2)
- `status.ts` - File status checking with full path error messages (enhanced v3.3.0)
- `attributes.ts` - Customer and project attributes synchronization (enhanced v3.2.0)
- `conversations.ts` - Conversation history management
- `metadata.ts` - Metadata YAML generation (flows.yaml, metadata.yaml)
- `skill-files.ts` - IDN-based skill file management and validation
- `diff-utils.ts` - LCS-based diff algorithm for accurate change detection
- **`integrations.ts` (NEW v3.2.0)** - Integration, connector, and webhook synchronization
- **`akb.ts` (NEW v3.2.0)** - AKB knowledge base pull/push operations
- **`migrate.ts` (NEW v3.3.0)** - Complete account migration with automated webhook creation
- **`flow-metadata.ts` (NEW v3.7.2)** - Shared reconciler used by both V1 and V2 push paths. Compares local FlowMetadata vs the platform and emits create/update/delete API calls for flow title, events, and state_fields. Format-agnostic; V2 strategy adapts inline `V2FlowEvent`/`V2StateField` to V1-shaped FlowMetadata before calling in. Hash-gated by `metadata.yaml` SHA256 to prevent stale local trees from wiping Builder-UI events

**Core Utilities:**
- `api.ts` - HTTP client with token refresh and typed endpoints
- `auth.ts` - Multi-strategy authentication with automatic token refresh
- `env.ts` - Environment configuration and validation
- `fsutil.ts` - Type-safe file system operations
- `hash.ts` - SHA256-based change detection
- `types.ts` - Comprehensive TypeScript type definitions
- `customer.ts`, `customerInit.ts`, `customerAsync.ts` - Customer configuration management
- `akb.ts` - AKB article parser for knowledge base import

**Benefits:**
- **Maintainability** - Split 500+ line CLI file and 1400+ line sync file into focused modules
- **Testability** - Each module can be tested independently with clear dependencies
- **Readability** - Single-responsibility modules with clear interfaces
- **Extensibility** - Easy to add new commands and sync operations
- **Type Safety** - Comprehensive TypeScript definitions in types.ts

## Development Commands

### Setup
```bash
npm install              # Install dependencies and TypeScript toolchain
cp .env.example .env     # Create environment config
# Edit .env with your NEWO_PROJECT_ID and NEWO_API_KEY
```

### Build & Test
```bash
npm run build                    # Compile TypeScript to JavaScript (outputs to dist/)
npm run build:watch              # Watch mode for development
npm run typecheck                # Type checking without emit
npm run lint                     # Strict TypeScript compilation check
npm run clean                    # Remove dist/ and coverage/ directories

# Testing
npm test                         # Run all tests
npm run test:unit                # Run unit tests only
npm run test:integration         # Run integration tests only
npm run test:coverage            # Run tests with c8 coverage report
npm run test:mocha               # Run tests with mocha runner
```

### Core CLI Commands
```bash
npm run dev                                    # Build and run CLI in dev mode
npx newo pull                                  # Download NEWO project + customer attributes
npx newo push                                  # Upload modified .guidance/.jinja files + attributes
npx newo status                                # Show modified files that would be pushed
npx newo sandbox "<message>"                   # Test agent in sandbox chat (v3.1.0)
npx newo sandbox --actor <id> "<message>"      # Continue existing chat conversation
npx newo conversations                         # Download user conversations -> conversations.yaml
npx newo import-akb <file> <persona_id>        # Import AKB articles from structured text file
npx newo meta                                  # Get project metadata (debug command)
npx newo list-customers                        # List all configured customers
npx newo help                                  # Show comprehensive help

# Integration Management (NEW v3.2.0)
npx newo pull-integrations                     # Download integrations + connectors + webhooks
npx newo push-integrations                     # Upload connector changes (full CRUD)
npx newo profile                               # View customer profile information
npx newo list-actions                          # List 78 NSL/Jinja script actions

# AKB Knowledge Base (NEW v3.2.0)
npx newo pull-akb                              # Download AKB for personas with agents
npx newo push-akb                              # Upload AKB articles to platform

# Attributes (Enhanced v3.2.0)
npx newo pull-attributes                       # Download customer + project attributes

# Account Migration (NEW v3.3.0)
npx newo migrate-account --source <src> --dest <dst> [--yes]  # Migrate complete account automatically
npx newo verify --source <src> --dest <dst>                    # Verify migration entity counts match
npx newo create-webhooks [--customer <idn>]                    # Create webhooks from YAML files

# Project Registry (NEW v3.4.0)
npx newo list-registries                                       # List available registries (production, staging, etc.)
npx newo list-registry-items <registry-idn>                    # List projects in a registry
npx newo list-registry-items <registry-idn> --all              # Show all versions
npx newo add-project <idn> --item <template> --registry <reg>  # Install project from registry

# Analytics & Monitoring (NEW v3.5.0)
npx newo logs                                                  # Fetch last 1 hour of analytics logs
npx newo logs --hours 24                                       # Last 24 hours of logs
npx newo logs --level warning,error                            # Filter by level (info, warning, error)
npx newo logs --type call --skill <skill-idn>                  # Filter skill calls
npx newo logs --flow <flow-idn> --follow                       # Tail logs for specific flow
npx newo logs --from <datetime> --to <datetime>                # Date range (ISO format)
npx newo logs --json --per 100                                 # Output as JSON with pagination
npx newo logs --message "error"                                # Search in log messages

# Customer Management (NEW v3.5.0)
npx newo create-customer <org_name> --email <email>            # Create new NEWO customer
npx newo create-customer <org> --email <e> --tenant <t>        # With custom tenant
npx newo create-customer <org> --email <e> --project <idn>     # With project template
npx newo create-customer <org> --email <e> --status temporal   # Temporal (trial) account

# Format Support (NEW v3.6.0)
npx newo pull --format newo_v2                                 # Pull in NEWO V2 format (platform compatible)
npx newo pull --format cli_v1                                  # Pull in native CLI format (default)
npx newo push --format newo_v2                                 # Push from V2 format project
npx newo status --format newo_v2                               # Status for V2 format project
npx newo export [--output <file>]                              # Download V2 bulk export ZIP from platform
# Format is auto-detected per customer: import_version.txt = newo_v2, projects/ dir = cli_v1
# Set NEWO_FORMAT=newo_v2 in .env as default for new pulls

# Entity Management
npx newo create-agent <idn> --project <pid>    # Create new agent
npx newo create-flow <idn> --agent <aid>       # Create new flow
npx newo create-skill <idn> --flow <fid>       # Create new skill
npx newo create-project <idn>                  # Create new project
npx newo create-event <idn> --flow <fid>       # Create flow event
npx newo create-state <idn> --flow <fid>       # Create flow state
npx newo create-parameter <name> --skill <sid> # Create skill parameter

# Deletion (local only)
npx newo delete-agent <aid> --confirm          # Delete agent locally
npx newo delete-flow <fid> --confirm           # Delete flow locally
npx newo delete-skill <sid> --confirm          # Delete skill locally
```

### Quick Development Aliases
```bash
npm run pull            # Alias for build + newo pull
npm run push            # Alias for build + newo push
npm run status          # Alias for build + newo status
npm run conversations   # Alias for build + newo conversations
```

## Architecture Overview

This is a CLI tool that synchronizes NEWO AI platform projects with local files in a Git-first workflow. The architecture follows a clean separation of concerns with **full TypeScript implementation** for enhanced type safety and developer experience.

### Core Components

**CLI Layer (`src/cli.ts`)**
- TypeScript entry point with command parsing using minimist
- Switch/case routing pattern for 20+ commands
- Centralized error handling with handleCliError()
- Environment initialization and validation at startup
- Customer configuration parsing and validation
- Strict typing for command arguments and error handling

**Command Handler Pattern:**
Each command in `src/cli/commands/` follows a consistent pattern:
```typescript
export async function handleXCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean
): Promise<void> {
  // 1. Customer selection (single or multi)
  // 2. Authentication (getValidAccessToken)
  // 3. API client creation (makeClient)
  // 4. Business logic execution
  // 5. Error handling with meaningful messages
}
```

**API Layer (`src/api.ts`)**
- HTTP client factory with automatic token refresh and proper Axios typing
- NEWO API endpoint wrappers with strict response type definitions
- Comprehensive error handling with typed error responses

**Authentication (`src/auth.ts`)**
- Multi-strategy auth with strongly typed token interfaces
- Automatic token refresh with proper environment variable typing
- Type-safe token persistence and validation

**Sync Engine (`src/sync.ts`)**
- Bidirectional sync with comprehensive type definitions for project structure
- Type-safe change detection using SHA256 hashes and metadata mapping
- Strongly typed project data with backward compatibility support
- Customer attributes pull/push with YAML format compliance

**File System (`src/fsutil.ts`)**
- Atomic file operations with TypeScript path validation
- Type-safe utilities for project structure management
- Proper error handling with typed exceptions

**Hashing (`src/hash.ts`)**
- SHA256 content hashing with type-safe hash storage interfaces
- Typed persistence and loading utilities

**AKB Import (`src/akb.ts`)**
- Type-safe parser for structured AKB text files with comprehensive interfaces
- Strongly typed article extraction and API formatting
- Full validation of parsed data structures

**Conversations (`src/sync.ts` - pullConversations)**
- Multi-customer conversation data extraction with pagination support
- Chat History API integration with fallback to conversations acts API
- Type-safe conversation processing with chronological ordering
- Clean YAML output with phone number extraction and persona management

**Sandbox Chat (`src/sandbox/chat.ts`, `src/cli/commands/sandbox.ts`)** (NEW v3.1.0)
- Real-time agent testing in sandbox mode with conversation context
- Automatic persona/actor creation with unique naming (`newo-cli-{guid}`)
- Chat History API polling with intelligent message filtering
- Multi-turn conversation support with actor ID-based continuation
- Debug information extraction (flow_idn, skill_idn, session_id, runtime_context_id)
- Single-command mode for automated testing workflows

**Type Definitions (`src/types.ts`)**
- Comprehensive type definitions for all API responses and data structures
- Interface definitions for configuration, authentication, and project management
- Type-safe enums for runner types, skill selectors, and state scopes
- Conversation-specific types for personas, acts, and chat history
- Sandbox chat types: Integration, Connector, SandboxChatSession, ChatDebugInfo

### Data Flow

**Pull Operation:**
1. Fetch agents list from NEWO API → `listAgents()`
2. For each agent/flow, fetch skills → `listFlowSkills()`
3. Download skill content → `getSkill()` (from `/api/v1/designer/skills/{skillId}`)
4. Write to `./project/{agent}/{flow}/{skill}.guidance` or `{skill}.jinja` based on runner_type
5. Generate `flows.yaml` with complete project structure including events and state fields
6. Build ID mapping (`.newo/map.json`) with complete skill metadata and hash tracking files (`.newo/hashes.json`)

**Push Operation:**
1. Load existing ID mappings (`.newo/map.json`) and hashes (`.newo/hashes.json`)
2. Calculate current SHA256 hashes for all .guidance/.jinja files
3. Compare with stored hashes to find changes
4. For changed files, create complete skill object with metadata (id, title, idn, model, parameters, path)
5. Upload modified content → `updateSkill()` (to `/api/v1/designer/flows/skills/{skillId}`)
6. Update hash tracking to prevent unnecessary re-uploads

**Customer Attributes Operation:**
1. Fetch customer attributes → `getCustomerAttributes()` (from `/api/v1/bff/customer/attributes?include_hidden=true`)
2. Transform to reference YAML format (literal blocks, enum types, no ID fields)
3. Save to `newo_customers/{customerIdn}/attributes.yaml` in customer root directory
4. Store ID mappings separately in `.newo/{customerIdn}/attributes-map.json` for push operations
5. During push, load YAML + ID mapping and update changed attributes → `updateCustomerAttribute()` (to `/api/v1/customer/attributes/{attributeId}`)

**AKB Import Operation:**
1. Parse structured text file with article sections (separated by `---`)
2. Extract article metadata: ID, category/subcategory, summary, keywords, pricing data
3. Format articles for NEWO API with proper field mapping:
   - `topic_name`: Descriptive category title
   - `source`: Article ID (e.g., "r001")
   - `topic_summary`: Full category content with pricing
   - `topic_facts`: Array with category, summary, keywords
4. Import articles to specified persona → `importAkbArticle()` (to `/api/v1/akb/append-manual`)
5. Provide progress feedback and success/failure counts

**Conversations Operation:**
1. Fetch user personas → `listUserPersonas()` (from `/api/v1/bff/conversations/user-personas`)
2. Extract phone numbers from persona actors (newo_voice connectors)
3. For each persona, fetch conversation history → `getChatHistory()` (from `/api/v1/chat/history`)
4. Fallback to conversations acts API for accounts with proper permissions
5. Sort personas by most recent activity, acts by chronological order (ascending)
6. Process and clean conversation data (remove redundant fields)
7. Save to `newo_customers/{customerIdn}/conversations.yaml` with structured persona/acts format

**Sandbox Chat Operation:** (v3.1.0)
1. Find sandbox integration → `listIntegrations()` → filter by `idn === 'sandbox'`
2. Get sandbox connectors → `listConnectors(integrationId)` → filter by `status === 'running'`
3. Create unique user persona → `createSandboxPersona()` with name `newo-cli-{guid}`
4. Create actor tied to sandbox connector → `createActor()` (actor_id becomes chat ID)
5. Send message → `sendChatMessage()` (to `/api/v1/chat/user/{actorId}`)
6. Poll for response → `getChatHistory()` with 1-second intervals, 60-second timeout
7. Filter for agent messages → return when `is_agent === true` messages appear
8. Extract debug info → flow_idn, skill_idn, session_id, runtime_context_id
9. For continuation → reuse existing actor_id, track last message_id to filter new messages

**Integration Management Operation:** (NEW v3.2.0)
1. **Pull:** Fetch all integrations → `listIntegrations()` → for each integration:
   - Fetch integration settings → `getIntegrationSettings()` (if available)
   - Fetch connectors → `listConnectors(integrationId)`
   - Save combined file: `{integration_idn}.yaml` (metadata + settings)
   - For each connector: save to `connectors/{connector_idn}/{connector_idn}.yaml`
2. **Webhooks:** Fetch outgoing/incoming webhooks, group by connector_idn, save to `connectors/{connector}/webhooks/`
3. **Push:** Compare local YAML files with remote connectors
   - Create: New connector YAML → POST `/api/v1/integrations/{id}/connectors`
   - Update: Modified connector → PUT `/api/v1/integrations/connectors/{id}`
   - Delete: Removed YAML → DELETE `/api/v1/integrations/connectors/{id}`

**AKB Knowledge Base Operation:** (NEW v3.2.0)
1. **Pull:** Search personas linked to agents → `searchPersonas(is_linked_to_agent=true)`
   - For each persona: fetch AKB topics with pagination → `getAkbTopics(persona_id, page, per)`
   - Save to `akb/{agent.idn}.yaml` format
   - Include: topic_name, topic_facts, confidence, source, labels, topic_summary, timestamps
2. **Push:** Read YAML files from akb/ directory
   - Map agent IDN to persona ID
   - For each article: import via `importAkbArticle()` → POST `/api/v1/akb/append-manual`

**Project Attributes Operation:** (NEW v3.2.0)
1. **Pull:** For each project → `getProjectAttributes(project_id, include_hidden=true)`
   - Transform to YAML format (same as customer attributes)
   - Save to `projects/{project_idn}/attributes.yaml`
   - Store ID mapping in `.newo/{customer}/project_{project}_attributes-map.json`
2. **Push:** Compare local vs. remote project attributes (integrated into main push command)
   - Load YAML + ID mapping
   - Detect changed values
   - Update via `updateProjectAttribute()` → PUT `/api/v1/designer/projects/{project_id}/attributes/{attribute_id}`

**Project Registry Operation:** (NEW v3.4.0)
1. **List Registries:** Fetch available registries → `listRegistries()` (from `/api/v1/designer/registries`)
   - Returns: id, idn, account_id, is_public for each registry (production, staging, development, etc.)
2. **List Registry Items:** Fetch project templates → `listRegistryItems(registryId)` (from `/api/v1/designer/registries/{id}/items`)
   - Returns: id, idn, version, project_image, active_project_count, published_at
   - Items grouped by idn with multiple versions available
   - Sorted by published_at descending (newest first)
3. **Add Project from Registry:** Install template → `addProjectFromRegistry()` (POST `/api/v1/designer/projects`)
   - Uses same endpoint as create-project but with registry fields:
     - registry_idn: Target registry (e.g., "production")
     - registry_item_idn: Template project IDN (e.g., "cal_com_integration")
     - registry_item_version: Specific version or null for latest
     - is_auto_update_enabled: Auto-update when new versions published
   - Creates fully configured project with agents, flows, skills from template

### File Structure

**cli_v1 format** (default - full feature support):
```
newo_customers/{CustomerIdn}/
  attributes.yaml              # Customer attributes
  conversations.yaml           # User conversations
  akb/{AgentIdn}.yaml          # AKB knowledge base
  integrations/                # Integration configurations
  projects/{ProjectIdn}/
    metadata.yaml              # Project metadata
    flows.yaml                 # Auto-generated structure
    attributes.yaml            # Project attributes
    libraries/{LibraryIdn}/    # Shared skill libraries (NEW v3.6.0)
      metadata.yaml
      {SkillIdn}/{skill}.guidance|.jinja
    {AgentIdn}/
      metadata.yaml
      {FlowIdn}/
        metadata.yaml
        {SkillIdn}/
          {skill}.guidance|.jinja
          metadata.yaml
```

**newo_v2 format** (NEW v3.6.0 - platform import/export compatible):
```
newo_customers/{CustomerIdn}/
  import_version.txt           # Format marker (v2.0.0)
  attributes.yaml              # Customer attributes (sorted, !enum ValueType.X)
  akb/{AgentIdn}.yaml          # AKB stubs for all agents
  {ProjectIdn}/
    {project_idn}.yaml         # Project metadata (version, registry)
    attributes.yaml            # Project attributes
    libraries/{LibraryIdn}/    # Shared skill libraries
      {lib_idn}.yaml           # Library + inline skill definitions
      skills/{skill}.nsl|.nslg
    agents/{AgentIdn}/
      agent.yaml               # Agent metadata
      flows/{FlowIdn}/
        {flow_idn}.yaml        # Flow + inline skills + events + states
        skills/{skill}.nsl|.nslg
```

**Format auto-detection**: `import_version.txt` = newo_v2, `projects/` dir = cli_v1.
Multiple formats can coexist in the same `newo_customers/` folder.

```
.newo/{CustomerIdn}/           # CLI state (shared by both formats)
  map.json                     # NEWO ID mappings
  hashes.json                  # SHA256 hashes for change detection
  tokens.json                  # Authentication token cache
```

### API Endpoints Used

**Core Endpoints:**
- `POST /api/v1/auth/api-key/token` - Exchange API key for access/refresh tokens
- `GET /api/v1/designer/projects` - List all projects
- `GET /api/v1/bff/agents/list?project_id=...` - List project agents
- `GET /api/v1/designer/flows/{flowId}/skills` - List flow skills
- `GET /api/v1/designer/skills/{skillId}` - Get skill content
- `PUT /api/v1/designer/flows/skills/{skillId}` - Update skill content
- `GET /api/v1/designer/flows/{flowId}/events` - List flow events
- `GET /api/v1/designer/flows/{flowId}/states` - List flow state fields
- `GET /api/v1/designer/projects/by-id/{projectId}` - Get project metadata

**Attribute Endpoints:**
- `GET /api/v1/bff/customer/attributes?include_hidden=true` - Get customer attributes (v1.7.0)
- `PUT /api/v1/customer/attributes/{attributeId}` - Update customer attribute (v1.7.0)
- `GET /api/v1/bff/projects/{projectId}/attributes` - Get project attributes (NEW v3.2.0)
- `PUT /api/v1/designer/projects/{projectId}/attributes/{attributeId}` - Update project attribute (NEW v3.2.0)
- `POST /api/v1/designer/projects/{projectId}/attributes` - Create project attribute (NEW v3.2.0)
- `DELETE /api/v1/designer/projects/{projectId}/attributes/{attributeId}` - Delete project attribute (NEW v3.2.0)

**Integration Endpoints (NEW v3.2.0):**
- `GET /api/v1/integrations` - List all integrations
- `GET /api/v1/integrations/{id}/connectors` - List integration connectors
- `GET /api/v1/integrations/{id}/settings` - Get integration-level settings
- `POST /api/v1/integrations/{id}/connectors` - Create new connector
- `PUT /api/v1/integrations/connectors/{id}` - Update connector
- `DELETE /api/v1/integrations/connectors/{id}` - Delete connector
- `GET /api/v1/webhooks` - List outgoing webhooks
- `GET /api/v1/webhooks/incoming` - List incoming webhooks

**AKB Endpoints (NEW v3.2.0):**
- `GET /api/v1/bff/personas/search` - Search personas linked to agents
- `GET /api/v1/akb/topics` - Get AKB topics for persona
- `POST /api/v1/akb/append-manual` - Import AKB articles

**Developer Tool Endpoints (NEW v3.2.0):**
- `GET /api/v1/script/actions` - List all NSL/Jinja script actions
- `GET /api/v1/customer/profile` - Get customer profile information

**Conversation Endpoints (v1.9.0):**
- `GET /api/v1/bff/conversations/user-personas` - List user personas
- `GET /api/v1/chat/history` - Get conversation history

**Sandbox Endpoints (v3.1.0):**
- `POST /api/v1/customer/personas` - Create user persona for sandbox testing
- `POST /api/v1/customer/personas/{id}/actors` - Create actor/chat session
- `POST /api/v1/chat/user/{actorId}` - Send sandbox chat message

**Registry Endpoints (NEW v3.4.0):**
- `GET /api/v1/designer/registries` - List available registries (production, staging, etc.)
- `GET /api/v1/designer/registries/{id}/items` - List project templates in a registry
- `POST /api/v1/designer/projects` - Create project from registry template (with registry_idn, registry_item_idn fields)

**Analytics Endpoints (NEW v3.5.0):**
- `GET /api/v1/analytics/logs` - Fetch analytics logs with filters
  - Query params: `page`, `per`, `from_datetime`, `to_datetime`
  - Filters: `levels` (info, warning, error), `log_types` (system, operation, call)
  - Entity filters: `project_idn`, `flow_idn`, `skill_idn`, `message`
  - Context filters: `external_event_id`, `runtime_context_id`, `user_persona_ids`, `user_actor_ids`

**Customer Management Endpoints (NEW v3.5.0):**
- `POST /api/v3/customer` - Create new NEWO customer account
  - Requires: `secret`, `customer.organization_name`, `customer.tenant`, `customer.members`, `customer.contact_email`
  - Optional: `customer.contact_phone`, `customer.organization_status` (temporal/permanent)
  - Optional: `projects[]` with registry template configuration

**Library Endpoints (NEW v3.6.0):**
- `GET /api/v1/designer/projects/{projectId}/libraries` - List libraries (includes skills inline)
- `GET /api/v1/designer/projects/{projectId}/libraries/{libraryId}` - Get single library
- `POST /api/v1/designer/projects/{projectId}/libraries` - Create library
- `DELETE /api/v1/designer/projects/{projectId}/libraries/{libraryId}` - Delete library
- `GET /api/v1/designer/libraries/{libraryId}/skills` - List library skills
- `POST /api/v1/designer/libraries/{libraryId}/skills` - Create library skill
- `PATCH /api/v1/designer/libraries/{libraryId}/skills/{skillId}` - Update library skill

**V2 Bulk Export/Import Endpoints (NEW v3.6.0):**
- `POST /api/v2/designer/customer/export?customer_id={id}` - Bulk export organization as ZIP
- `POST /api/v2/designer/customer/import` - Bulk import organization from ZIP

## Environment Configuration

Required environment variables in `.env`:
- `NEWO_BASE_URL` - NEWO API base URL (default: https://app.newo.ai)
- `NEWO_PROJECT_ID` - Target project UUID
- `NEWO_API_KEY` - API key for token exchange (recommended)
- `NEWO_FORMAT` - Default format for new pulls: `cli_v1` (default) or `newo_v2` (only for new customers, existing ones auto-detect)

Alternative auth (if API key unavailable):
- `NEWO_ACCESS_TOKEN` - Direct access token
- `NEWO_REFRESH_TOKEN` - Refresh token
- `NEWO_REFRESH_URL` - Custom refresh endpoint

## CI/CD Integration

The project includes GitHub Actions workflow (`.github/workflows/deploy.yml`) that:
- Triggers on pushes to main branch affecting `project/**/*.guidance` or `project/**/*.jinja` files
- Uses Node.js 20 and runs `npm ci` to install dependencies including TypeScript toolchain
- Compiles TypeScript using `npm run build` for production deployment
- Executes `node ./dist/cli.js push` to deploy changes from compiled JavaScript
- Includes type checking and linting as part of the build process
- Requires `NEWO_API_KEY` in GitHub secrets
- Optionally supports `NEWO_REFRESH_URL` for custom token refresh endpoints

## Development Patterns

### TypeScript Strict Mode Configuration
This project uses **extremely strict TypeScript configuration** (tsconfig.json):
- `exactOptionalPropertyTypes: true` - Optional properties cannot be `undefined`
- `noUncheckedIndexedAccess: true` - Index signatures return `T | undefined`
- `verbatimModuleSyntax: true` - Explicit type-only imports with `type` keyword
- `useUnknownInCatchVariables: true` - Catch variables are `unknown`, not `any`
- All standard strict flags: noImplicitAny, noImplicitReturns, noUnusedLocals, etc.

### Key Architectural Patterns

**Command Handler Pattern:**
- Each command is isolated in `src/cli/commands/`
- Consistent function signature: `(customerConfig, args, verbose) => Promise<void>`
- Centralized error handling via `handleCliError()`
- Customer selection logic reused via `selectSingleCustomer()` and `interactiveCustomerSelection()`

**Multi-Customer Support:**
- Customer config can be: single object, array, or JSON string
- Environment variables: `NEWO_CUSTOMER_IDN` / `NEWO_CUSTOMERS` / `NEWO_DEFAULT_CUSTOMER`
- Commands support `--customer <idn>` flag for explicit selection
- Interactive prompts when multiple customers exist without default

**Type Safety:**
- All API responses typed in `src/types.ts`
- Discriminated unions for customer configs (SingleCustomerConfig | MultiCustomerConfig)
- Strict nullability checking throughout
- Type guards for runtime validation

**File Operations:**
- Always use absolute paths (no relative paths)
- Atomic writes via fs-extra
- IDN-based file naming (v2.0+): `{skillIdn}.jinja` instead of `skill.jinja`
- Hierarchical directory structure: Project → Agent → Flow → Skill

**Change Detection:**
- SHA256 hashes stored in `.newo/{customerIdn}/hashes.json`
- LCS-based diff algorithm in `src/sync/diff-utils.ts` for accurate change detection
- Hash tracking for all file types: scripts, metadata, attributes, flows.yaml

**Error Handling:**
- Try/catch at command level with `handleCliError()`
- User-friendly error messages via `src/cli/errors.ts`
- Verbose mode for detailed debugging output
- Typed errors: `NewoApiError`, `AuthenticationError`, etc.

**Temporary Files Policy:**
- **IMPORTANT:** All temporary, debug, or experimental scripts must be placed in `temp/` folder
- This folder is gitignored and will NOT be committed to the repository
- Use `temp/` for: API testing scripts, data exploration, one-off migrations, debug utilities, temporary reports
- Use `backup/` for: Data backups, old exports, archived customer data
- Scripts with long-term value should go in `scripts/` folder (tracked by git)
- Example: `temp/test-api-endpoint.ts` for quick API testing
- When a temporary script proves useful, refactor it into a proper CLI command or move to `scripts/`

When modifying this codebase:
- **Use strict TypeScript** - All code must pass strict type checking
- **Follow command handler pattern** - New commands go in `src/cli/commands/`
- **Type everything** - Add types to `src/types.ts` for shared definitions
- **Handle multi-customer** - Use customer selection utilities
- **Use absolute paths** - Never use relative file paths
- **Test thoroughly** - Add tests in `test/` directory
- **Development tooling**: TypeScript compiler, source maps, and comprehensive build system
- **IDE support**: Full IntelliSense, type checking, and refactoring capabilities

## Security Requirements & Best Practices

**Token Security:**
- Tokens stored in `.newo/tokens.json` (local directory, not global)
- Automatic token refresh before expiry
- All API requests over HTTPS with Bearer token authentication
- Support for environment variables in CI/CD: `NEWO_API_KEY`, `NEWO_ACCESS_TOKEN`, `NEWO_REFRESH_TOKEN`

**Development Security:**
- Never hardcode API keys in repositories
- Use `.env` files for local development (excluded from Git)
- Store secrets in CI/CD environment variables or secrets management
- All authentication flows include proper error handling and retry logic

## Testing

### Test Structure
Tests are located in `test/` directory using Node.js native test runner:
- `api.test.js` - API client and endpoint tests
- `sync.test.js` - Sync engine and push/pull operations
- `auth.test.js` - Authentication and token management
- `hash.test.js` - SHA256 hashing and change detection
- `fsutil.test.js` - File system utilities
- `akb.test.js` - AKB article parsing and import
- `integration.test.js` - End-to-end integration tests

### Running Tests
```bash
npm test                    # All tests
npm run test:unit           # Unit tests only
npm run test:integration    # Integration tests only
npm run test:coverage       # Coverage report (HTML + text)
```

### Test Utilities
- `test/test-utils.js` - Shared mocks and helpers
- Mock HTTP client, file system, and logger
- Test data generators for agents, flows, skills
- Environment setup and cleanup utilities

## Future Roadmap & Planned Features

**Phase 2 (Planned):**
- `newo diff` - Compare local scripts with remote versions
- `newo watch` - Automatically push changes when files are saved
- Enhanced token refresh automation
- Better error handling & logging
- Multi-agent workspace support

**Phase 3 (Future):**
- Unit testing of scripts before push
- Plugin system for code linters & formatters
- Full project scaffolding and templates
- Advanced CI/CD integration patterns

**Extensibility Points:**
- API layer designed for additional endpoints (already includes events and states)
- Sync engine supports different skill types (.guidance for AI prompts, .jinja for NSL/templating)
- Authentication system ready for additional auth methods (supports API key, direct tokens, refresh)
- Command system easily extensible for new operations (meta command demonstrates pattern)
- flows.yaml export ready for external tooling integration (CI/CD, documentation, analysis)

---

## Release Checklist

**CRITICAL:** Every time we cut a new version (any `npm publish`), the following MUST all happen together in the same change. Skipping any step leaves the repo in an inconsistent state — `npm` shows one version, GitHub another, the README a third.

### Order of operations

Branch first. Never bump and publish straight from `main`.

```bash
git checkout -b release/v<MAJOR>.<MINOR>.<PATCH>
```

Then update **all** of the following in a single commit:

1. **`package.json`** — bump `"version"` to the new semver
2. **`package-lock.json`** — bump BOTH `"version"` fields (top-level + `packages.""`). `npm install --package-lock-only` regenerates this cleanly if there's drift
3. **`CHANGELOG.md`** — three edits:
   - Move whatever was under `## [Unreleased]` into a new `## [X.Y.Z] - YYYY-MM-DD` section (use today's date in `Today's date is YYYY-MM-DD` format from your system context)
   - Leave `## [Unreleased]` as an empty heading right above it (so the next change has somewhere to land)
   - Append the link reference at the bottom: `[X.Y.Z]: https://github.com/sabbah13/newo-cli/compare/v<prev>...vX.Y.Z` AND update the `[Unreleased]` link to `compare/vX.Y.Z...HEAD`
4. **`README.md`** — if the release adds or changes a user-visible feature:
   - Add a bullet to the "Sync NEWO ... structure to local files with:" list near the top (the 🆕 / 🚀 bullets at lines 10-28). Order is newest-first
   - Add a dedicated subsection under `## Commands` if it's a new command surface (model after "Lint, Format, Check (NEW v3.7.0)" / "Flow Metadata Sync (NEW v3.7.2)")
   - Update any command tables that mention the changed behavior
5. **`CLAUDE.md` (this file)** — two edits:
   - Add a `✅ **<Feature Name>** (NEW vX.Y.Z) - <one-line summary>` bullet under "Current Implementation Status" (keep it newest-last so the chronological order survives)
   - Update the `src/<module>/` line in the architecture sections if the release adds or substantially changes a module (e.g. v3.7.2 added `flow-metadata.ts`)
6. **`docs/USAGE_GUIDE.md`** — only if the release changes user workflow (new command, behavior change, new prerequisite). Existing scenarios may need an inline note like "(v3.7.2+: …)". Skip for pure refactors or internal fixes
7. **Any feature-specific docs** the release touches: `docs/V2_IMPLEMENTATION_REPORT.md`, `docs/FEATURE_ANALYSIS.md`, `newo-docs/guides/*`, etc. Search before assuming none exist:
   ```bash
   grep -rln "<thing-the-release-touches>" --include='*.md' \
     --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=newo_customers \
     --exclude-dir=temp --exclude-dir=backup --exclude-dir=.newo
   ```
8. **Commit** with a `feat:` or `fix:` Conventional Commit subject ending in `(vX.Y.Z)`. Body must list the doc files touched so reviewers can verify nothing was missed
9. **Open PR** against `main` with `gh pr create`. PR body should link the GitHub issue (if any) and quote any reproduction steps
10. **Verify CI is green and `mergeable` is `MERGEABLE`** before merging:
    ```bash
    gh pr view <num> --json mergeable,mergeStateStatus,statusCheckRollup
    ```
    If `CONFLICTING`, rebase on `origin/main` and force-push with `--force-with-lease`
11. **Squash-merge** with `gh pr merge <num> --squash --delete-branch`
12. **Pull `main`** locally and `git checkout main && git pull --ff-only`
13. **Tag and push**:
    ```bash
    git tag -a vX.Y.Z -m "vX.Y.Z — <short summary>"
    git push origin vX.Y.Z
    ```
14. **Publish to npm** (you must be `npm whoami` = `sabbah13`):
    ```bash
    npm publish --access public
    ```
    `prepublishOnly` runs `clean` + `build` automatically, so the published tarball is always built from the merged commit
15. **Wait for the npm registry to propagate** (~30-60s on average, sometimes longer). Use `Monitor` with an `until-loop`, not chained sleeps:
    ```bash
    until npm view newo@<X.Y.Z> version 2>/dev/null | grep -q "<X.Y.Z>"; do sleep 3; done
    npm view newo dist-tags    # confirm { latest: 'X.Y.Z' }
    ```
16. **If the release fixes a reported GitHub issue:** add a follow-up comment with the npm install command and a smoke-check, but do not close the issue — let the reporter validate

### What goes in `## [Unreleased]` vs `## [X.Y.Z]`

While work is in progress, accumulate `### Added` / `### Fixed` / `### Changed` / `### Removed` blocks under `## [Unreleased]`. At release time, change the heading from `[Unreleased]` to `[X.Y.Z] - <date>` and add a fresh empty `## [Unreleased]` above it. Don't write directly under a versioned heading mid-flight — release dates lie if you do.

### When NOT to bump version

- Pure documentation edits (README / CHANGELOG / CLAUDE.md typo, link fix)
- Comment-only refactors
- Adding tests for existing behavior

For these, commit straight to `main` (or via a small PR) without touching `package.json`. The changelog can stay at `[Unreleased]` or omit the change entirely if it's user-invisible.

### Quick reference — files that must move together on a version bump

```
package.json              ← "version"
package-lock.json         ← TWO "version" fields (top + packages."")
CHANGELOG.md              ← [Unreleased] → [X.Y.Z] + link refs at bottom
README.md                 ← feature bullet + (maybe) command subsection
CLAUDE.md                 ← Implementation Status bullet + (maybe) module list
docs/USAGE_GUIDE.md       ← only if user-facing workflow changed
```

Use this Bash one-liner to sanity-check nothing was missed before opening the release PR:

```bash
grep -l "$(node -p 'require(\"./package.json\").version')" \
  package.json package-lock.json CHANGELOG.md README.md CLAUDE.md 2>/dev/null
```

All five should print. If any are missing, the release is incomplete.