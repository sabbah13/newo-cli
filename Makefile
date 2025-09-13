# NEWO CLI Makefile
# Comprehensive build and development automation

# Variables
NODE_VERSION := 18
NPM := npm
BUILD_DIR := dist
SRC_DIR := src
SCRIPTS_DIR := scripts

# Colors for output
BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[1;33m
RED := \033[0;31m
NC := \033[0m # No Color

# Default target
.PHONY: help
help: ## Show this help message
	@echo "$(BLUE)NEWO CLI Development Makefile$(NC)"
	@echo ""
	@echo "$(GREEN)Available targets:$(NC)"
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  $(YELLOW)%-20s$(NC) %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo ""
	@echo "$(GREEN)Examples:$(NC)"
	@echo "  make setup          # Initial setup and install dependencies"
	@echo "  make dev            # Start development with watch mode"
	@echo "  make test-all       # Run all tests and checks"
	@echo "  make publish        # Publish to both GitHub and NPM"

# Setup and Dependencies
.PHONY: setup
setup: ## Initial project setup and dependency installation
	@echo "$(BLUE)Setting up NEWO CLI development environment...$(NC)"
	@if ! command -v node >/dev/null 2>&1; then \
		echo "$(RED)Error: Node.js not found. Please install Node.js $(NODE_VERSION)+ first.$(NC)"; \
		exit 1; \
	fi
	@echo "$(GREEN)✓ Node.js found: $$(node --version)$(NC)"
	$(NPM) install
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "$(YELLOW)⚠ Created .env file from .env.example. Please configure your API keys.$(NC)"; \
	fi
	@echo "$(GREEN)✓ Setup complete!$(NC)"

.PHONY: install
install: ## Install dependencies
	$(NPM) install

.PHONY: install-ci
install-ci: ## Install dependencies (CI mode)
	$(NPM) ci

# Build Commands
.PHONY: build
build: ## Build TypeScript to JavaScript
	@echo "$(BLUE)Building project...$(NC)"
	$(NPM) run build
	@echo "$(GREEN)✓ Build complete$(NC)"

.PHONY: build-watch
build-watch: ## Build with watch mode for development
	@echo "$(BLUE)Starting build in watch mode...$(NC)"
	$(NPM) run build:watch

.PHONY: clean
clean: ## Remove build artifacts
	@echo "$(BLUE)Cleaning build artifacts...$(NC)"
	$(NPM) run clean
	@echo "$(GREEN)✓ Clean complete$(NC)"

# Development Commands
.PHONY: dev
dev: build ## Build and start development mode
	@echo "$(BLUE)Starting development mode...$(NC)"
	@echo "$(YELLOW)Use 'make dev-cmd CMD=pull' to run specific commands$(NC)"

.PHONY: dev-cmd
dev-cmd: build ## Run a specific CLI command in development (usage: make dev-cmd CMD=pull)
	@if [ -z "$(CMD)" ]; then \
		echo "$(RED)Error: CMD parameter required. Example: make dev-cmd CMD=pull$(NC)"; \
		exit 1; \
	fi
	@echo "$(BLUE)Running: node ./$(BUILD_DIR)/cli.js $(CMD)$(NC)"
	node ./$(BUILD_DIR)/cli.js $(CMD)

.PHONY: dev-pull
dev-pull: build ## Development pull command
	node ./$(BUILD_DIR)/cli.js pull --verbose

.PHONY: dev-push
dev-push: build ## Development push command
	node ./$(BUILD_DIR)/cli.js push --verbose

.PHONY: dev-status
dev-status: build ## Development status command
	node ./$(BUILD_DIR)/cli.js status --verbose

# Testing Commands
.PHONY: test
test: ## Run tests
	@echo "$(BLUE)Running tests...$(NC)"
	$(NPM) test

.PHONY: test-unit
test-unit: ## Run unit tests only
	$(NPM) run test:unit

.PHONY: test-integration
test-integration: ## Run integration tests only
	$(NPM) run test:integration

.PHONY: test-coverage
test-coverage: ## Run tests with coverage report
	$(NPM) run test:coverage

.PHONY: test-watch
test-watch: ## Run tests in watch mode
	$(NPM) run test:watch

# Quality Assurance
.PHONY: typecheck
typecheck: ## Run TypeScript type checking
	@echo "$(BLUE)Running type checking...$(NC)"
	$(NPM) run typecheck
	@echo "$(GREEN)✓ Type checking passed$(NC)"

.PHONY: lint
lint: ## Run linting
	@echo "$(BLUE)Running linting...$(NC)"
	$(NPM) run lint
	@echo "$(GREEN)✓ Linting passed$(NC)"

.PHONY: check-all
check-all: typecheck lint test ## Run all quality checks
	@echo "$(GREEN)✓ All quality checks passed$(NC)"

# Local Testing Commands
.PHONY: test-local
test-local: build ## Test CLI locally with comprehensive checks
	@echo "$(BLUE)Running comprehensive local tests...$(NC)"
	@echo "$(YELLOW)Testing CLI loads correctly...$(NC)"
	node ./$(BUILD_DIR)/cli.js --help > /dev/null
	@echo "$(GREEN)✓ CLI loads correctly$(NC)"
	@echo "$(YELLOW)Testing customer configuration...$(NC)"
	node ./$(BUILD_DIR)/cli.js list-customers
	@echo "$(GREEN)✓ Local testing complete$(NC)"

.PHONY: test-cli
test-cli: build ## Quick CLI functionality test
	@echo "$(BLUE)Testing CLI functionality...$(NC)"
	node ./$(BUILD_DIR)/cli.js --help
	node ./$(BUILD_DIR)/cli.js list-customers

# Package Management
.PHONY: pack
pack: build ## Create npm package (dry run)
	@echo "$(BLUE)Creating package preview...$(NC)"
	$(NPM) pack --dry-run

.PHONY: pack-real
pack-real: build test-all ## Create actual npm package file
	@echo "$(BLUE)Creating npm package...$(NC)"
	$(NPM) pack

# Version Management
.PHONY: version-patch
version-patch: ## Bump patch version (1.5.2 → 1.5.3)
	@echo "$(BLUE)Bumping patch version...$(NC)"
	$(NPM) version patch --no-git-tag-version
	@echo "$(GREEN)✓ Version bumped to $$(node -p "require('./package.json').version")$(NC)"

.PHONY: version-minor
version-minor: ## Bump minor version (1.5.2 → 1.6.0)
	@echo "$(BLUE)Bumping minor version...$(NC)"
	$(NPM) version minor --no-git-tag-version
	@echo "$(GREEN)✓ Version bumped to $$(node -p "require('./package.json').version")$(NC)"

.PHONY: version-major
version-major: ## Bump major version (1.5.2 → 2.0.0)
	@echo "$(BLUE)Bumping major version...$(NC)"
	$(NPM) version major --no-git-tag-version
	@echo "$(GREEN)✓ Version bumped to $$(node -p "require('./package.json').version")$(NC)"

# Publishing Commands
.PHONY: publish-github
publish-github: ## Publish to GitHub with release
	@echo "$(BLUE)Publishing to GitHub...$(NC)"
	@chmod +x $(SCRIPTS_DIR)/publish-github.sh
	./$(SCRIPTS_DIR)/publish-github.sh

.PHONY: publish-npm
publish-npm: ## Publish to NPM
	@echo "$(BLUE)Publishing to NPM...$(NC)"
	@chmod +x $(SCRIPTS_DIR)/publish-npm.sh
	./$(SCRIPTS_DIR)/publish-npm.sh

.PHONY: publish
publish: publish-github publish-npm ## Publish to both GitHub and NPM
	@echo "$(GREEN)✓ Published to both GitHub and NPM$(NC)"

# Pre-publish validation
.PHONY: pre-publish
pre-publish: clean install build check-all test-local pack ## Complete pre-publish validation
	@echo "$(GREEN)✓ All pre-publish checks passed. Ready to publish!$(NC)"

# Git Commands
.PHONY: git-status
git-status: ## Show git status
	git status

.PHONY: git-log
git-log: ## Show recent git commits
	git log --oneline -10

.PHONY: git-clean
git-clean: ## Clean git working directory (WARNING: removes untracked files)
	@echo "$(RED)WARNING: This will remove all untracked files!$(NC)"
	@read -p "Continue? (y/N): " confirm && [ "$$confirm" = "y" ]
	git clean -fd

# Documentation Commands
.PHONY: docs-serve
docs-serve: ## Serve documentation locally (if available)
	@if [ -f "docs/index.html" ]; then \
		echo "$(BLUE)Serving documentation...$(NC)"; \
		python3 -m http.server 8000 -d docs; \
	else \
		echo "$(YELLOW)No docs directory found. README.md is the main documentation.$(NC)"; \
		echo "$(BLUE)Opening README.md...$(NC)"; \
		cat README.md; \
	fi

# Maintenance Commands
.PHONY: deps-update
deps-update: ## Update dependencies
	@echo "$(BLUE)Updating dependencies...$(NC)"
	$(NPM) update
	@echo "$(GREEN)✓ Dependencies updated$(NC)"

.PHONY: deps-audit
deps-audit: ## Run security audit
	@echo "$(BLUE)Running security audit...$(NC)"
	$(NPM) audit
	@echo "$(GREEN)✓ Security audit complete$(NC)"

.PHONY: deps-fix
deps-fix: ## Fix security vulnerabilities
	@echo "$(BLUE)Fixing security vulnerabilities...$(NC)"
	$(NPM) audit fix
	@echo "$(GREEN)✓ Security fixes applied$(NC)"

# Environment Commands
.PHONY: env-check
env-check: ## Check environment setup
	@echo "$(BLUE)Checking environment...$(NC)"
	@echo "$(YELLOW)Node.js version:$(NC) $$(node --version)"
	@echo "$(YELLOW)NPM version:$(NC) $$(npm --version)"
	@if [ -f .env ]; then \
		echo "$(GREEN)✓ .env file exists$(NC)"; \
	else \
		echo "$(RED)✗ .env file missing$(NC)"; \
	fi
	@if [ -d node_modules ]; then \
		echo "$(GREEN)✓ node_modules installed$(NC)"; \
	else \
		echo "$(RED)✗ node_modules missing - run 'make install'$(NC)"; \
	fi
	@if [ -d $(BUILD_DIR) ]; then \
		echo "$(GREEN)✓ Build directory exists$(NC)"; \
	else \
		echo "$(YELLOW)⚠ Build directory missing - run 'make build'$(NC)"; \
	fi

# Comprehensive workflows
.PHONY: fresh-start
fresh-start: clean install build test-local ## Complete fresh start (clean + install + build + test)
	@echo "$(GREEN)✓ Fresh start complete!$(NC)"

.PHONY: quick-test
quick-test: build test-cli ## Quick build and test cycle
	@echo "$(GREEN)✓ Quick test complete!$(NC)"

.PHONY: release-prep
release-prep: pre-publish ## Prepare for release (full validation)
	@echo "$(GREEN)✓ Release preparation complete!$(NC)"
	@echo "$(BLUE)Ready to run: make publish$(NC)"

# Show current project status
.PHONY: status
status: ## Show comprehensive project status
	@echo "$(BLUE)NEWO CLI Project Status$(NC)"
	@echo "$(YELLOW)Version:$(NC) $$(node -p "require('./package.json').version")"
	@echo "$(YELLOW)Package:$(NC) $$(node -p "require('./package.json').name")"
	@echo ""
	@make env-check
	@echo ""
	@make git-status

# Development shortcuts
.PHONY: d
d: dev ## Shortcut for dev

.PHONY: b
b: build ## Shortcut for build

.PHONY: t
t: test ## Shortcut for test

.PHONY: s
s: status ## Shortcut for status

# Ensure scripts directory exists and is executable
$(SCRIPTS_DIR):
	mkdir -p $(SCRIPTS_DIR)

# Make sure build directory exists
$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)