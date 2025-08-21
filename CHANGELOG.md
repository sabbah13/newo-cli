# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2025-01-21

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

## [1.2.2] - 2025-01-20

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