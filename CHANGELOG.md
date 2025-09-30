# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.0.0] - 2025-09-29

### Added

- **Entity Creation Commands**: 12 new commands for creating NEWO entities locally
  - `newo create-project <idn>` - Create new projects on platform
  - `newo create-persona <name>` - Create agent personas
  - `newo create-attribute <idn>` - Create customer attributes
  - `newo create-agent <idn> --project <pid>` - Create agents locally with metadata
  - `newo create-flow <idn> --agent <aid>` - Create flows with guidance/NSL runner selection
  - `newo create-skill <idn> --flow <fid>` - Create skills with script content initialization
  - `newo create-event <idn> --flow <fid>` - Create flow events for integrations
  - `newo create-state <idn> --flow <fid>` - Create flow state fields (user/flow/global scope)
  - `newo create-parameter <name> --skill <sid>` - Create skill parameters
- **Entity Deletion Commands**: 3 new commands with confirmation flags
  - `newo delete-agent <aid> --confirm` - Delete agent locally
  - `newo delete-flow <fid> --confirm` - Delete flow locally
  - `newo delete-skill <sid> --confirm` - Delete skill locally
- **API Integrations**: 19 new endpoints for entity creation, deletion, and publishing
- **Documentation**: Entity Management Commands section with workflows and examples (+146 lines)
- **TypeScript Types**: 19 new type definitions for entity operations

### Changed

- **Push Command**: Now automatically detects and creates local-only entities on platform
  - Filesystem scanning for entities not yet in project map
  - Creates missing entities in correct hierarchical order (agent → flow → skill)
  - Publishes flows after creation
- **Status Command**: Enhanced with comprehensive change detection
  - Scans for local-only entities not yet on platform
  - Reports new agents/flows/skills awaiting sync
  - Hierarchical display of project structure
- **Architecture**: Added 14 new command modules in src/cli/commands/
- **Push Module**: Enhanced with local-only entity scanning (~418 lines)
- **Status Module**: Enhanced with entity detection (~184 lines)

## [2.0.6] - 2025-09-18

### Changed

- Implement proper LCS-based diff algorithm for accurate change detection
- Clean, accurate differences with proper line matching
- Improved algorithm eliminates false positives and shows precise modifications

## [2.0.5] - 2025-09-18

### Fixed

- Correct diff algorithm to show clean, accurate differences
- Improved change detection with proper context preservation

## [2.0.4] - 2025-09-18

### Changed

- Implement exact GitHub diff format with proper context lines
- GitHub-style diff with background colors and context
- Enhanced diff display with line numbers and clearer messaging

## [2.0.3] - 2025-09-18

### Changed

- Improve diff display with line numbers and clearer messaging
- Better visual distinction for changes with colored output

## [2.0.2] - 2025-09-18

### Added

- GitHub-style colored diff display for overwrite prompts
- Enhanced diff visualization with colors and formatting

## [2.0.1] - 2025-09-18

### Fixed

- Improve overwrite handling with proper 'all' option support
- Better handling of batch overwrite operations

## [1.9.3] - 2025-09-17

### Changed

- **BREAKING**: Main CLI entry point moved from `dist/cli.js` to `dist/cli/index.js`
- Split monolithic 500+ line `cli.ts` into focused modules
  - `cli/index.ts` - Main entry point and command routing
  - `cli/errors.ts` - Centralized error handling
  - `cli/customer-selection.ts` - Customer management logic
  - `cli/commands/` - Individual command handlers
- Extracted key functions from 1400+ line `sync.ts` into focused modules
  - `sync/attributes.ts` - Customer attributes synchronization
  - `sync/conversations.ts` - Conversation history management
  - `sync/status.ts` - File status checking and change detection
  - `sync/index.ts` - Unified exports with backward compatibility
- Updated CLAUDE.md with new modular architecture documentation

### Fixed

- Test imports to use compiled JavaScript from `dist/` directory
- Test utilities converted from CommonJS to ES modules
- Improved test isolation and ES module compatibility

## [2.0.0] - 2025-09-17

### Added

- IDN-based skill file naming for easy identification
- Real-time progress display during large operations (966+ skills)
- Percentage completion with skill counts
- Multiple file detection with clear warnings
- Force mode with `--force/-f` flag for silent operations
- Complete metadata.yaml hierarchy at all levels

### Changed

- **BREAKING**: Skills now saved as `{skillIdn}.jinja/.guidance` instead of `skill.jinja/.guidance`
- **BREAKING**: Existing files automatically renamed to IDN format during pull
- Refactored CLI module structure
  - `src/cli.ts` (124 lines) - Clean main entry using modular imports
  - `src/cli/errors.ts` - Centralized error management
  - `src/cli/customer-selection.ts` - Reusable customer selection logic
  - `src/cli/commands/` - Individual handlers for all commands
- Refactored sync module structure
  - `src/sync.ts` (13 lines) - Unified exports with re-exports
  - `src/sync/projects.ts` - Project sync with progress tracking
  - `src/sync/push.ts` - File validation and upload
  - `src/sync/status.ts` - Change detection with file validation
  - `src/sync/attributes.ts` - Customer attributes synchronization
  - `src/sync/conversations.ts` - Conversation history management
  - `src/sync/metadata.ts` - flows.yaml generation (removed prompt_script)
  - `src/sync/skill-files.ts` - IDN-based naming and validation
- Flexible file discovery (any .jinja/.guidance/.nsl file)
- Smart overwrite detection (content-based, not filename-based)
- Complete hash coverage for flows.yaml and attributes.yaml
- Zero TypeScript compilation errors with strict typing
- Modular loading with reduced memory footprint

### Fixed

- False positive change detection
- Status now shows "Clean." immediately after pull operations
- Safe push operations that skip problematic skills with multiple files

## [1.9.2] - 2025-09-16

### Added

- Max pages limit (50 pages = 5000 acts per persona) to prevent infinite pagination
- Verbose logging for pagination progress

### Changed

- Skip personas without newo_voice actors immediately for better performance
- Optimized control flow to prevent hanging during large conversation extraction

### Fixed

- Infinite loops during conversation processing
- Improved persona filtering for voice actors
- Graceful handling of personas without voice actors

## [1.9.1] - 2025-09-16

### Removed

- Conversations acts API fallback (eliminates 403 errors)
- `getConversationActs()` function (unused after chat history integration)
- `ConversationActsParams` and `ConversationActsResponse` interfaces
- Fallback logic that caused 403 errors for personas without proper permissions

### Changed

- Use only `/api/v1/chat/history` endpoint which works with current API keys

## [1.9.0] - 2025-09-16

### Added

- `newo conversations` command to download user conversations and personas
- Multi-customer conversation support with `--customer <idn>` flag
- Chat History API integration (`/api/v1/chat/history`) with fallback support
- Automatic phone number extraction from persona actors
- Comprehensive pagination handling for large conversation datasets
- Clean YAML output format in `newo_customers/{customerIdn}/conversations.yaml`
- Type-safe conversation API integration
  - `listUserPersonas()` - Get all user personas with pagination
  - `getChatHistory()` - Get conversation history for user actors
  - `getConversationActs()` - Fallback for accounts with proper permissions
  - `pullConversations()` - Complete conversation sync orchestration
- NPM scripts: `npm run conversations` and `npm run conversations:all`

### Changed

- Acts sorted by datetime ascending (chronological conversation flow)
- Personas sorted by most recent activity (descending)
- Clean persona structure: `id` → `name` → `phone` → `act_count` → `acts`
- Parallel API calls with concurrency limiting (p-limit)
- Graceful error handling with persona-level fault tolerance

### Removed

- Redundant fields (`is_agent`, `session_id: unknown`, etc.)

## [1.8.0] - 2025-09-15

### Added

- Complete metadata.yaml file synchronization with hash-based change detection
- Status command shows detailed metadata changes (title, runner_type, model)
- Push command automatically updates skills when metadata changes
- Automatic flows.yaml regeneration when metadata changes detected
- flows.yaml backup/comparison system for format preservation

### Changed

- All NEWO workspace files fully tracked
  - Skills: .guidance and .jinja script files with hash tracking
  - Metadata: metadata.yaml files with skill updates + flows.yaml regeneration
  - Attributes: attributes.yaml with diff-based sync for 233 customer attributes
  - Flows: flows.yaml with automatic regeneration and format preservation
  - Multi-customer: All file types synchronized across multiple customer workspaces
- Automatic regeneration pipeline creates backup before regeneration
- Re-fetches project data to ensure accuracy
- Maintains consistent YAML format structure

## [1.7.3] - 2025-09-15

### Added

- Full hash-based change detection for customer attributes
- Attributes.yaml files included in hash tracking during pull operations
- Status command detects and reports modifications to attributes.yaml files
- Push command handles attributes changes with proper synchronization

### Changed

- Extended file synchronization scope to all NEWO workspace file types
  - Skills: .guidance and .jinja files with full hash tracking
  - Attributes: customer attributes.yaml with change detection
  - Metadata: flows.yaml and metadata.yaml files tracked
  - Multi-customer: all file types synchronized across multiple customers

## [1.7.2] - 2025-09-15

### Added

- `attributes.yaml` file tracking with modification times and sizes
- `flows.yaml` file tracking and statistics
- Comprehensive file monitoring across entire project structure

### Fixed

- Attributes push check error with `!enum` format
- Changed from YAML parsing to file stats for change detection
- Prevents parsing errors with custom enum format in attributes.yaml

## [1.7.1] - 2025-09-15

### Changed

- `newo status` now automatically checks all customers when no default is specified
- `newo push` provides interactive customer selection dialog when multiple customers exist
- Moved customer selection logic into command-specific handlers
- Each command now handles customer selection appropriately

### Fixed

- Early exit errors for multi-customer operations
- Maintains backward compatibility with single-customer setups

## [1.7.0] - 2025-09-15

### Added

- Complete pull/push functionality for customer attributes
- `GET /api/v1/bff/customer/attributes?include_hidden=true` endpoint integration (fetches 233 attributes)
- `PUT /api/v1/customer/attributes/{attributeId}` endpoint integration
- Saves to `newo_customers/{customerIdn}/attributes.yaml` in customer root directory
- YAML format with literal blocks, enum types, and proper multi-line formatting
- Separate ID mapping in `.newo/{customerIdn}/attributes-map.json` for push operations
- Full TypeScript type safety with `CustomerAttribute` and `CustomerAttributesResponse` interfaces
- API layer functions: `updateCustomerAttribute()` and enhanced `getCustomerAttributes()`
- File system utilities: `customerAttributesPath()` and `customerAttributesMapPath()`

### Changed

- Integrated attributes handling into existing `pull` and `push` commands
- YAML format compliance with reference specification
  - Literal block scalars (`|-`) for multi-line strings
  - Proper enum format (`!enum "AttributeValueTypes.string"`)
  - Complex JSON string formatting with proper line breaks
  - No escaped quotes in output

### Removed

- Legacy JSON metadata files (YAML-only approach)
- Redundant `metadata.json` files

## [1.6.1] - 2025-09-13

### Added

- `"type": "module"` to package.json for proper ES module handling

### Fixed

- Enum formatting in `flows.yaml` generation for NEWO enum types
- Enum value serialization from quoted strings to proper YAML enum format
- Issue where enum values like `!enum "RunnerType.guidance"` were incorrectly quoted

## [1.6.0] - 2025-09-13

### Added
- **Multi-Customer Auto-Pull**: Revolutionary workflow improvement for multi-customer environments
  - `newo pull` now automatically pulls from ALL customers when no default customer is set
  - Eliminates the need to specify `--customer` flag or set `NEWO_DEFAULT_CUSTOMER` for bulk operations
  - Maintains backward compatibility - individual customer selection still works with `--customer` flag
  - Smart detection: single customer setup works as before, multi-customer setup auto-pulls all
- **Publishing Infrastructure**: Complete automated publishing system for professional releases
  - `scripts/publish-github.sh`: Automated GitHub publishing with releases, tags, and version management
  - `scripts/publish-npm.sh`: Automated NPM publishing with validation and safety checks
  - Comprehensive Makefile with 40+ commands for development and publishing workflows
  - Version bump helpers (patch/minor/major) with semantic versioning support
- **Enhanced Documentation**: Professional publishing and development documentation
  - Complete "Publishing & Release Management" section with step-by-step workflows
  - "Local Testing" section with comprehensive testing procedures
  - Makefile command reference with organized development workflows
  - Troubleshooting guides for common development and publishing issues

### Enhanced
- **Customer Configuration Logic**: New functions for flexible customer handling
  - `tryGetDefaultCustomer()`: Non-throwing version that returns null for multi-customer scenarios
  - `getAllCustomers()`: Returns array of all configured customers for batch operations
  - Improved error handling and user feedback for customer selection scenarios
- **CLI User Experience**: Enhanced command behavior and help documentation
  - Updated help text to reflect auto-pull behavior: "uses default or all for pull"
  - Clear progress indicators for multi-customer operations
  - Better error messages and troubleshooting guidance
- **Development Workflow**: Professional development and publishing infrastructure
  - Makefile with color-coded output and comprehensive command organization
  - Automated validation pipelines for publishing (build, test, lint, typecheck)
  - Publishing scripts with safety checks and rollback procedures

### Changed
- **Pull Command Behavior**: Breaking change in multi-customer environments (improvement)
  - Previously: Required explicit customer selection or default customer configuration
  - Now: Automatically pulls from all customers when no default is set
  - Single customer setups: No change in behavior
  - Multi-customer setups: Significantly improved user experience
- **Help Documentation**: Updated command descriptions and examples
  - `newo pull` now shows "(all customers if no default)" in help text
  - Enhanced multi-customer examples with auto-pull scenarios
  - Updated usage patterns to reflect new workflow capabilities

### Developer Experience
- **Publishing Automation**: One-command publishing to both GitHub and NPM with full validation
- **Comprehensive Testing**: Enhanced local testing documentation with step-by-step procedures
- **Professional Infrastructure**: Industry-standard publishing pipeline with version management
- **Quality Gates**: Automated validation before publishing (TypeScript, linting, building, package validation)

## [1.5.2] - 2025-09-04

### Enhanced
- **Documentation Overhaul**: Complete README restructuring with professional presentation
  - Added npm, license, TypeScript, and Node.js badges for credibility
  - Enhanced project description highlighting multi-customer support capabilities
  - Visual feature bullets with emojis for improved readability and engagement
- **Multi-Customer Documentation**: Comprehensive guide for multi-customer workflows
  - Three flexible configuration methods: JSON arrays, individual env vars, mixed approaches
  - Clear migration path from single to multi-customer setup
  - Command examples for multi-customer operations (`--customer` flag usage)
- **Professional Documentation Structure**:
  - Table format for command reference with improved readability
  - Visual folder tree showing accurate `newo_customers/` structure
  - Enhanced CI/CD integration examples for both single and multi-customer scenarios
  - Contributing guidelines, API reference, and support channels
- **Corrected File Organization**: Updated folder structure documentation to match actual implementation
  - Fixed root folder from `projects/` to `newo_customers/` 
  - Accurate customer folder hierarchy: `newo_customers/{customerIdn}/projects/{projectIdn}/`
  - Customer-specific state management in `.newo/{customerIdn}/`

### Fixed
- **Folder Structure Documentation**: Corrected project structure examples to match actual code implementation
- **Package Description**: Updated npm package description to reflect multi-customer capabilities

### Developer Experience
- **GitHub/npm Ready**: Professional presentation suitable for public package repository
- **Clear Navigation**: Improved documentation structure with proper sectioning and examples
- **Enhanced Onboarding**: Comprehensive quick-start guide and configuration examples

## [1.5.1] - 2025-09-03

### Added
- **Comprehensive Test Coverage**: Added extensive test suites for all major modules
  - `test/auth.test.js`: 500+ lines covering authentication, token management, multi-customer support
  - `test/hash.test.js`: 400+ lines covering SHA256 hashing, hash storage, and cross-platform compatibility  
  - `test/fsutil.test.js`: 400+ lines covering file system utilities and path handling
  - `test/akb.test.js`: 600+ lines covering AKB article parsing and import workflows
  - Added missing test dependencies: `chai`, `sinon`, `c8` for coverage reporting
- **Enhanced Authentication Validation**:
  - `validateApiKey()`: Comprehensive API key format and length validation
  - `validateTokens()`: Token format and structure validation with detailed error messages
  - `validateUrl()`: URL format validation for API endpoints
  - Sensitive data sanitization in logs (API keys and tokens masked)
- **Structured Logging System**:
  - `logAuthEvent()`: Structured authentication event logging with metadata
  - Automatic sensitive data sanitization (keys/tokens/secrets masked in logs)
  - JSON-formatted logs with timestamp, level, module, and context information
- **Enhanced Error Handling**:
  - User-friendly CLI error messages with troubleshooting tips
  - Specific error handling for authentication, network, environment, and file system errors
  - Verbose mode support for detailed debugging information
  - Context-aware error messages with suggested solutions

### Enhanced
- **Authentication Robustness** (`src/auth.ts`):
  - Added comprehensive input validation with detailed error messages
  - Enhanced network error handling with specific status code interpretation
  - Added request timeouts (30 seconds) and retry logic for reliability
  - Improved token expiry handling with 60-second buffer for refresh
  - Better handling of connection errors, timeouts, and server errors
- **CLI Error Experience** (`src/cli.ts`):
  - Added `handleCliError()` function with categorized error types
  - User-friendly error messages with emoji indicators and troubleshooting tips
  - Verbose mode toggle for detailed technical information vs. clean user messages
  - Specific guidance for common issues (API key, network, configuration)
- **Testing Infrastructure**:
  - Fixed ES module/CommonJS compatibility issues in test files
  - Enhanced `TestEnvironment` class with comprehensive cleanup and mocking
  - Added MockHttpClient, MockFileSystem, and MockLogger utilities
  - Comprehensive assertion helpers and test data generators

### Fixed
- **Module System Compatibility**: Resolved ES module/CommonJS conflicts in test environment
- **Test Dependencies**: Added missing testing dependencies that were imported but not declared
- **Integration Test Paths**: Fixed paths from `src/cli.js` to `dist/cli.js` for proper compiled code testing
- **Error Message Consistency**: Standardized error messages across authentication and CLI modules

### Technical Details
- **Validation Constants**: Added security-focused validation thresholds (API_KEY_MIN_LENGTH, TOKEN_MIN_LENGTH)
- **Request Configuration**: Added proper timeout handling (30s) and user-agent headers
- **Error Recovery**: Comprehensive fallback strategies for different failure scenarios
- **Logging Standards**: JSON-structured logs with automatic PII/sensitive data protection
- **Test Coverage**: Achieved comprehensive test coverage across all core modules with realistic scenarios

### Developer Experience
- **Enhanced Debugging**: Verbose mode provides detailed technical information for troubleshooting
- **Better Error Messages**: Clear, actionable error messages instead of generic API errors
- **Comprehensive Testing**: Full test suite covering authentication, file operations, hashing, and AKB import
- **Type Safety**: All improvements maintain strict TypeScript compliance with proper error types

## [1.5.0] - 2025-09-03

### Changed
- **Complete TypeScript Refactoring**: Major codebase conversion from JavaScript to TypeScript
  - All source files converted to TypeScript with `.ts` extensions
  - Added comprehensive type definitions in `src/types.ts`
  - Strict TypeScript configuration with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`
  - Modern ES2022 target with ESNext modules for optimal performance
  - Enhanced IntelliSense support and developer experience

### Added
- **TypeScript Build System**: 
  - `tsconfig.json` with strict type checking and modern ES features
  - New build scripts: `npm run build`, `npm run build:watch`, `npm run typecheck`
  - Development scripts: `npm run dev`, `npm run pull`, `npm run push`, `npm run status`
  - Source map generation for debugging compiled JavaScript
- **Enhanced Type Safety**:
  - Complete type definitions for all NEWO API responses and data structures
  - Strict error handling with proper TypeScript error types
  - Optional property handling with explicit `| undefined` types
  - Enhanced Axios integration with proper TypeScript interceptor types

### Technical Details
- **Type Definitions**: Comprehensive interfaces for `ProjectMeta`, `Agent`, `Flow`, `Skill`, `FlowEvent`, `FlowState`, and all API responses
- **Build Output**: TypeScript compiles to `dist/` directory with JavaScript and declaration files
- **Import Strategy**: Uses runtime `.js` extensions in TypeScript source (required for ESModules)
- **Dependency Updates**: Added TypeScript and @types packages for full type support
- **Package.json**: Updated with TypeScript build pipeline and development scripts

### Migration for Developers
- **New Development Workflow**: `npm run build` required before running CLI commands
- **Source Files**: All development now in `src/*.ts` files instead of `src/*.js`
- **Build Artifacts**: Generated JavaScript in `dist/` directory (automatically created)
- **IDE Support**: Enhanced autocomplete, error detection, and refactoring capabilities

### Backward Compatibility
- **Runtime Behavior**: No changes to CLI command interface or functionality
- **Environment Variables**: All existing `.env` configurations continue to work
- **File Formats**: Same `.guidance` and `.jinja` file support as before
- **API Compatibility**: No changes to NEWO API integration or endpoints

## [1.4.0] - 2025-08-20

### Added
- **Multi-Project Support**: Major feature allowing users to work with multiple NEWO projects
  - Optional `NEWO_PROJECT_ID` environment variable - if not set, pulls all accessible projects
  - New API endpoint: `GET /api/v1/designer/projects` to list all accessible projects
  - Projects stored in organized folder structure: `./projects/{project-idn}/`
  - Each project folder contains `metadata.json` with complete project information
  - Project-specific `flows.yaml` files for individual project structure exports
- **Enhanced Project Structure**:
  - Changed from single `./project/` to multi-project `./projects/{project-idn}/` hierarchy
  - Backward compatibility maintained for existing single-project workflows
  - Improved organization with project-specific metadata and flows

### Changed
- **Folder Structure**: Project files now stored in `./projects/{project-idn}/` instead of `./project/`
- **CLI Behavior**: `newo pull` now downloads all projects by default (unless NEWO_PROJECT_ID specified)
- **CI/CD Paths**: GitHub Actions workflow paths updated from `project/**/*` to `projects/**/*`
- **Help Documentation**: Updated CLI help text to reflect multi-project capabilities
- **API Integration**: Enhanced sync logic to handle both single and multi-project scenarios

### Technical Details
- **New API Functions**:
  - `listProjects()`: Fetch all accessible projects from NEWO platform
  - `pullSingleProject()`: Pull individual project with metadata generation
  - `metadataPath()`: Generate project-specific metadata file paths
- **Enhanced Sync Engine**:
  - Multi-project mapping in `.newo/map.json` with backward compatibility
  - Project-specific hash tracking for efficient change detection
  - Automatic project metadata collection and storage
- **File System Updates**:
  - Updated `fsutil.js` with multi-project path utilities
  - Enhanced `skillPath()` function to include project identifier
  - New `projectDir()` and `metadataPath()` helper functions

### Migration Guide
- **Existing Users**: Single-project setups continue to work with `NEWO_PROJECT_ID` set
- **New Users**: Leave `NEWO_PROJECT_ID` unset to access all projects automatically
- **File Paths**: Update any scripts referencing `./project/` to use `./projects/{project-idn}/`
- **CI/CD**: Update workflow paths from `project/**/*` to `projects/**/*`

### Example Usage
```bash
# Pull all accessible projects (new default behavior)
npx newo pull

# Pull specific project (original behavior)
NEWO_PROJECT_ID=your-project-id npx newo pull

# Push changes from any project structure
npx newo push

# Status works with both single and multi-project setups
npx newo status
```

## [1.3.0] - 2025-08-20

### Added
- **AKB Import Feature**: New `import-akb` command to import knowledge base articles from structured text files
  - Parse multi-article files with standardized format (separated by `---`)
  - Extract article metadata: ID, category, summary, keywords, and pricing data
  - Import articles to NEWO personas via `/api/v1/akb/append-manual` endpoint
  - Support for verbose logging with `--verbose` flag
  - Progress tracking with success/failure counts
- **Enhanced CLI**: Added `import-akb <file> <persona_id>` command with validation and error handling
- **New API Endpoint**: `importAkbArticle()` function for AKB article imports
- **Documentation**: Comprehensive AKB format documentation in README.md

### Changed
- Updated help text to include new `import-akb` command
- Enhanced CLI command parsing to handle AKB import arguments
- Updated project documentation with AKB import workflow and examples

### Technical Details
- **New Files**: 
  - `src/akb.js`: AKB file parser and article formatter
  - Article parsing supports category/subcategory structure with pricing data
- **API Integration**: 
  - Articles mapped with `topic_name` (descriptive title) and `source` (article ID)
  - Full category content stored in `topic_summary`
  - Structured metadata in `topic_facts` array
- **Error Handling**: Comprehensive validation for file paths, persona IDs, and API responses

### Example Usage
```bash
# Import AKB articles from file to specific persona
npx newo import-akb akb.txt da4550db-2b95-4500-91ff-fb4b60fe7be9

# With verbose logging
npx newo import-akb akb.txt da4550db-2b95-4500-91ff-fb4b60fe7be9 --verbose
```

### AKB File Format
```
---
# r001
## Category / Subcategory / Description
## Summary description of the category
## Keywords; separated; by; semicolons

<Category type="Category Name">
Item Name: $Price [Modifiers: modifier1, modifier2]
Another Item: $Price [Modifiers: modifier3]
</Category>
---
```

## [1.2.2] - 2025-08-12

### Changed
- Updated README with API key image
- Removed unused files and .DS_Store entries
- Package version bump

### Fixed
- Repository cleanup and organization

## [1.2.1] - Previous Release

### Added

- Initial NEWO CLI functionality
- Two-way sync between NEWO platform and local files
- Support for .guidance and .jinja file types
- SHA256-based change detection
- Project structure export to flows.yaml
- GitHub Actions CI/CD integration
- Robust authentication with token refresh

[Unreleased]: https://github.com/sabbah13/newo-cli/compare/v3.0.0...HEAD
[3.0.0]: https://github.com/sabbah13/newo-cli/compare/v2.0.6...v3.0.0
[2.0.6]: https://github.com/sabbah13/newo-cli/compare/v2.0.5...v2.0.6
[2.0.5]: https://github.com/sabbah13/newo-cli/compare/v2.0.4...v2.0.5
[2.0.4]: https://github.com/sabbah13/newo-cli/compare/v2.0.3...v2.0.4
[2.0.3]: https://github.com/sabbah13/newo-cli/compare/v2.0.2...v2.0.3
[2.0.2]: https://github.com/sabbah13/newo-cli/compare/v2.0.1...v2.0.2
[2.0.1]: https://github.com/sabbah13/newo-cli/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/sabbah13/newo-cli/compare/v1.8.0...v2.0.0
[1.9.3]: https://github.com/sabbah13/newo-cli/compare/v1.9.2...v1.9.3
[1.9.2]: https://github.com/sabbah13/newo-cli/compare/v1.9.1...v1.9.2
[1.9.1]: https://github.com/sabbah13/newo-cli/compare/v1.9.0...v1.9.1
[1.9.0]: https://github.com/sabbah13/newo-cli/compare/v1.8.0...v1.9.0
[1.8.0]: https://github.com/sabbah13/newo-cli/compare/v1.7.0...v1.8.0
[1.7.3]: https://github.com/sabbah13/newo-cli/compare/v1.7.2...v1.7.3
[1.7.2]: https://github.com/sabbah13/newo-cli/compare/v1.7.1...v1.7.2
[1.7.1]: https://github.com/sabbah13/newo-cli/compare/v1.7.0...v1.7.1
[1.7.0]: https://github.com/sabbah13/newo-cli/compare/v1.6.1...v1.7.0
[1.6.1]: https://github.com/sabbah13/newo-cli/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/sabbah13/newo-cli/compare/v1.5.1...v1.6.0
[1.5.2]: https://github.com/sabbah13/newo-cli/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/sabbah13/newo-cli/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/sabbah13/newo-cli/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/sabbah13/newo-cli/compare/v1.2.1...v1.4.0
[1.3.0]: https://github.com/sabbah13/newo-cli/compare/v1.2.1...v1.3.0
[1.2.2]: https://github.com/sabbah13/newo-cli/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/sabbah13/newo-cli/releases/tag/v1.2.1