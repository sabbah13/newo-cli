# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.1] - 2025-09-13

### Fixed
- **YAML Enum Formatting**: Fixed enum formatting in `flows.yaml` generation to properly handle NEWO enum types
  - Corrected enum value serialization from quoted strings to proper YAML enum format
  - Fixed issue where enum values like `!enum "RunnerType.guidance"` were incorrectly quoted
  - Ensures generated `flows.yaml` files are properly formatted for NEWO platform consumption

### Enhanced
- **ES Module Support**: Added `"type": "module"` to package.json for proper ES module handling
  - Resolves Node.js warnings about module type detection
  - Improves performance by eliminating module type guessing
  - Ensures consistent ES module behavior across all environments

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

## [1.5.2] - 2025-01-15

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

## [1.5.1] - 2025-01-14

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