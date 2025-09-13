#!/bin/bash

# GitHub Publishing Script for NEWO CLI
# This script publishes the project to GitHub with proper versioning and release management

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    print_error "Not in a git repository. Initialize git first."
    exit 1
fi

# Check if origin remote exists
if ! git remote get-url origin > /dev/null 2>&1; then
    print_error "No 'origin' remote found. Add GitHub remote first:"
    print_error "  git remote add origin https://github.com/sabbah13/newo-cli.git"
    exit 1
fi

# Get current version from package.json
CURRENT_VERSION=$(node -p "require('./package.json').version")
print_status "Current version: $CURRENT_VERSION"

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
    print_warning "You have uncommitted changes. Commit them first or stash them."
    git status --short
    echo
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Build the project
print_status "Building project..."
npm run build

# Run tests
print_status "Running tests..."
npm test

# Check if we need to bump version
echo
print_status "Version bump options:"
echo "1) patch (1.5.2 → 1.5.3) - Bug fixes"
echo "2) minor (1.5.2 → 1.6.0) - New features"
echo "3) major (1.5.2 → 2.0.0) - Breaking changes"
echo "4) no bump - Use current version"
echo

read -p "Select version bump (1-4): " -n 1 -r VERSION_CHOICE
echo

case $VERSION_CHOICE in
    1)
        print_status "Bumping patch version..."
        npm version patch --no-git-tag-version
        ;;
    2)
        print_status "Bumping minor version..."
        npm version minor --no-git-tag-version
        ;;
    3)
        print_status "Bumping major version..."
        npm version major --no-git-tag-version
        ;;
    4)
        print_status "Using current version $CURRENT_VERSION"
        ;;
    *)
        print_error "Invalid choice. Exiting."
        exit 1
        ;;
esac

# Get the new version
NEW_VERSION=$(node -p "require('./package.json').version")
print_status "Publishing version: $NEW_VERSION"

# Create commit message
COMMIT_MESSAGE="release: v$NEW_VERSION

- Multi-customer auto-pull functionality
- Enhanced local testing documentation
- Improved CLI error handling and user experience"

# Add and commit all changes
print_status "Committing changes..."
git add .
git commit -m "$COMMIT_MESSAGE" || print_warning "No changes to commit"

# Create and push tag
print_status "Creating and pushing tag v$NEW_VERSION..."
git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION

🚀 NEWO CLI v$NEW_VERSION

## New Features
- Multi-customer auto-pull: \`newo pull\` now automatically pulls from all customers when no default is set
- Enhanced local testing documentation with comprehensive workflows
- Improved CLI error handling and user experience

## Changes
- Added \`tryGetDefaultCustomer()\` and \`getAllCustomers()\` functions
- Updated CLI logic for automatic multi-customer operations
- Enhanced help documentation and usage examples
- Added detailed local testing instructions in README

## Installation
\`\`\`bash
npm install -g newo@$NEW_VERSION
\`\`\`

## Quick Start
\`\`\`bash
newo pull    # Now automatically pulls from all customers if no default set
\`\`\`
"

# Push to GitHub
print_status "Pushing to GitHub..."
git push origin main
git push origin "v$NEW_VERSION"

# Create GitHub release (requires gh CLI)
if command -v gh &> /dev/null; then
    print_status "Creating GitHub release..."
    gh release create "v$NEW_VERSION" \
        --title "🚀 NEWO CLI v$NEW_VERSION" \
        --notes "## New Features
- **Multi-customer auto-pull**: \`newo pull\` now automatically pulls from all customers when no default is set
- **Enhanced local testing documentation** with comprehensive workflows
- **Improved CLI error handling** and user experience

## Changes
- Added \`tryGetDefaultCustomer()\` and \`getAllCustomers()\` functions
- Updated CLI logic for automatic multi-customer operations
- Enhanced help documentation and usage examples
- Added detailed local testing instructions in README

## Installation
\`\`\`bash
npm install -g newo@$NEW_VERSION
\`\`\`

## Quick Start
\`\`\`bash
newo pull    # Now automatically pulls from all customers if no default set
\`\`\`

---

**Full Changelog**: https://github.com/sabbah13/newo-cli/compare/v$CURRENT_VERSION...v$NEW_VERSION" \
        --latest

    print_success "GitHub release created successfully!"
else
    print_warning "GitHub CLI (gh) not found. Manual release creation required."
    print_status "Go to: https://github.com/sabbah13/newo-cli/releases/new"
    print_status "Tag: v$NEW_VERSION"
fi

print_success "Successfully published v$NEW_VERSION to GitHub!"
print_status "Repository: https://github.com/sabbah13/newo-cli"
print_status "Releases: https://github.com/sabbah13/newo-cli/releases"