# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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