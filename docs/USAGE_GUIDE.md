# NEWO CLI Usage Guide

## Overview

The NEWO CLI enables developers to work with NEWO AI Agent skills locally, syncing between your IDE and the NEWO platform. This guide covers the main usage scenarios and explains the V2 architecture improvements.

---

## Quick Start

### Installation

```bash
# Global installation (recommended)
npm install -g newo@latest

# Or local project installation
npm install newo
```

### Configuration

```bash
# Single customer setup
export NEWO_API_KEY=your_api_key_here

# Multi-customer setup (JSON array)
export NEWO_API_KEYS='["api_key_1", "api_key_2"]'
```

---

## Main Usage Scenarios

### Scenario 1: Daily Development Workflow

The most common workflow for developing NEWO AI skills:

```bash
# 1. Pull latest changes from NEWO platform
newo pull

# 2. Edit skills in your IDE
#    - .guidance files (AI prompts)
#    - .jinja files (NSL templates)

# 3. Check what you've changed
newo status

# 4. Push your changes back
newo push
```

**File locations:**
```
newo_customers/
└── YOUR_CUSTOMER_IDN/
    └── projects/
        └── YourProject/
            └── YourAgent/
                └── YourFlow/
                    └── YourSkill/
                        ├── your_skill.guidance  # Edit this
                        └── metadata.yaml
```

---

### Scenario 2: Working with Multiple Resources

The CLI manages 5 resource types. Here's how to work with each:

#### Projects, Agents, Flows, Skills (Core)
```bash
newo pull                    # Downloads everything
newo push                    # Uploads changed .guidance/.jinja files
newo status                  # Shows what would be pushed
```

#### Customer & Project Attributes
```bash
newo pull-attributes         # Downloads attributes.yaml files
# Edit newo_customers/{idn}/attributes.yaml
# Edit newo_customers/{idn}/projects/{project}/attributes.yaml
newo push                    # Uploads attribute changes
```

#### Integrations & Connectors
```bash
newo pull-integrations       # Downloads integrations/connectors/webhooks
# Edit files in newo_customers/{idn}/integrations/
newo push-integrations       # Uploads connector changes
```

#### Knowledge Base (AKB)
```bash
newo pull-akb                # Downloads AKB articles per agent
# Edit files in newo_customers/{idn}/akb/
newo push-akb                # Uploads AKB articles
```

#### Conversations (Read-Only)
```bash
newo conversations           # Downloads conversation history
# View in newo_customers/{idn}/conversations.yaml
```

---

### Scenario 3: Creating New Entities

Create new agents, flows, and skills locally, then push to the platform:

```bash
# Create a new agent
newo create-agent MyNewBot --project my_project --title "My New Bot"

# Create a flow for the agent
newo create-flow MainFlow --agent MyNewBot --project my_project --runner guidance

# Create a skill in the flow
newo create-skill GreetingSkill --flow MainFlow --agent MyNewBot --project my_project

# Push to platform
newo push

# Pull to get IDs and sync
newo pull
```

**Available create commands:**
- `create-project` - Create new project on platform
- `create-agent` - Create agent locally
- `create-flow` - Create flow locally
- `create-skill` - Create skill locally
- `create-event` - Create flow event (NSL)
- `create-state` - Create flow state (NSL)
- `create-parameter` - Create skill parameter
- `create-persona` - Create agent persona
- `create-attribute` - Create customer attribute

---

### Scenario 4: Account Migration

Migrate an entire account from one NEWO instance to another:

```bash
# Fully automated migration
newo migrate-account --source SOURCE_IDN --dest DEST_IDN --yes

# Verify migration succeeded
newo verify --source SOURCE_IDN --dest DEST_IDN
```

**What gets migrated:**
- All projects, agents, flows, skills
- All attributes (customer + project)
- All AKB articles
- All integrations and connectors
- All webhooks

---

### Scenario 5: Testing Agents

Test your agents in sandbox mode:

```bash
# Single message test
newo sandbox "Hello, I want to order a pizza"

# Continue conversation with same chat
newo sandbox --actor <chat-id> "I want 2 large pepperoni"

# With debug output
newo sandbox "Test message" --verbose
```

---

### Scenario 6: Multi-Customer Workflow

Work with multiple NEWO accounts:

```bash
# List all configured customers
newo list-customers

# Pull from specific customer
newo pull --customer CUSTOMER_A

# Push to specific customer
newo push --customer CUSTOMER_B

# Pull from ALL customers (no default set)
newo pull
```

---

## V2 Architecture: New Capabilities

The V2 architecture introduces a **unified sync engine** with **strategy pattern** for all resources.

### What's New in V2

#### 1. Unified Resource Model

All 5 resource types now use the same interface:

| Resource | Strategy | Operations |
|----------|----------|------------|
| Projects | `ProjectSyncStrategy` | pull, push, status |
| Attributes | `AttributeSyncStrategy` | pull, push, status |
| Integrations | `IntegrationSyncStrategy` | pull, push, status |
| AKB | `AkbSyncStrategy` | pull, push, status |
| Conversations | `ConversationSyncStrategy` | pull only |

#### 2. Selective Sync (Coming Soon)

The V2 SyncEngine supports selective resource sync:

```typescript
// In code (for integration)
await syncEngine.pullSelected(customer, ['projects', 'attributes']);
await syncEngine.pushSelected(customer, ['integrations']);
```

Future CLI enhancement:
```bash
# Pull only specific resources
newo pull --only projects,attributes

# Exclude certain resources
newo pull --exclude conversations
```

#### 3. Improved Migration

Migration now uses composition instead of duplication:

```typescript
// Internally, migration is now:
// 1. Pull from source (using strategies)
// 2. Transform data
// 3. Push to dest (using same strategies)
```

This reduced migration code from 746 lines to ~100 lines.

---

## Migration Guide: Old CLI → V2

### What Stays the Same

All existing commands continue to work exactly as before:

```bash
newo pull                    # Still works
newo push                    # Still works
newo status                  # Still works
newo pull-integrations       # Still works
newo pull-akb                # Still works
newo conversations           # Still works
```

### What's Improved

| Aspect | Old | V2 |
|--------|-----|-----|
| Resource handling | Different code per resource | Single strategy interface |
| Migration | Duplicated pull/push logic | Composed operations |
| Adding resources | ~800 lines of code | ~400 lines |
| Testing | Mock entire modules | Mock strategy interface |

### Recommended Workflow (V2)

For new users or migrating from old CLI:

1. **Use unified pull for daily work:**
   ```bash
   newo pull              # Gets projects + attributes
   newo pull-integrations # Gets integrations (if needed)
   newo pull-akb          # Gets knowledge base (if needed)
   ```

2. **Use status before push:**
   ```bash
   newo status            # Always check before pushing
   newo push              # Push all changes
   ```

3. **Use create commands for new entities:**
   ```bash
   newo create-agent ...  # Instead of manual folder creation
   newo create-flow ...
   newo create-skill ...
   newo push              # Sync to platform
   ```

4. **Use sandbox for testing:**
   ```bash
   newo sandbox "Test query"  # Quick agent testing
   ```

---

## Command Reference

### Core Commands

| Command | Description |
|---------|-------------|
| `newo pull` | Download projects + attributes |
| `newo push` | Upload all changes |
| `newo status` | Show modified files |

### Resource-Specific Commands

| Command | Description |
|---------|-------------|
| `newo pull-attributes` | Download customer + project attributes |
| `newo pull-integrations` | Download integrations/connectors |
| `newo push-integrations` | Upload connector changes |
| `newo pull-akb` | Download knowledge base |
| `newo push-akb` | Upload knowledge base |
| `newo conversations` | Download conversation history |

### Entity Commands

| Command | Description |
|---------|-------------|
| `newo create-project <idn>` | Create project on platform |
| `newo create-agent <idn>` | Create agent locally |
| `newo create-flow <idn>` | Create flow locally |
| `newo create-skill <idn>` | Create skill locally |
| `newo delete-agent <idn>` | Delete agent locally |
| `newo delete-flow <idn>` | Delete flow locally |
| `newo delete-skill <idn>` | Delete skill locally |

### Utility Commands

| Command | Description |
|---------|-------------|
| `newo help` | Show full help |
| `newo list-customers` | List configured customers |
| `newo sandbox "msg"` | Test agent in sandbox |
| `newo profile` | Show customer profile |
| `newo list-actions` | List NSL script actions |

### Migration Commands

| Command | Description |
|---------|-------------|
| `newo migrate-account` | Migrate entire account |
| `newo verify` | Verify migration |
| `newo create-webhooks` | Create webhooks from YAML |

### Registry Commands

| Command | Description |
|---------|-------------|
| `newo list-registries` | List available registries |
| `newo list-registry-items` | List templates in registry |
| `newo add-project` | Install project from registry |

---

## Best Practices

### 1. Always Pull Before Editing
```bash
newo pull                    # Get latest changes first
# Then edit your files
```

### 2. Check Status Before Push
```bash
newo status                  # Review what will be pushed
newo push                    # Then push
```

### 3. Use Verbose Mode for Debugging
```bash
newo pull --verbose          # See detailed operations
newo push -v                 # Short flag also works
```

### 4. Use Force Flag Carefully
```bash
newo pull --force            # Overwrites local changes silently
```

### 5. Specify Customer in Multi-Customer Setup
```bash
newo pull --customer ACME    # Explicit is better than implicit
```

---

## Troubleshooting

### "Multiple customers configured but no default specified"
```bash
# Solution 1: Specify customer explicitly
newo pull --customer YOUR_CUSTOMER_IDN

# Solution 2: Set default customer
export NEWO_DEFAULT_CUSTOMER=YOUR_CUSTOMER_IDN
```

### "No changes to push"
```bash
# Check if files are tracked
newo status --verbose

# Make sure you edited .guidance or .jinja files
# Metadata changes alone may not trigger push
```

### "Authentication failed"
```bash
# Verify API key is set
echo $NEWO_API_KEY

# Re-authenticate
unset NEWO_ACCESS_TOKEN
newo pull  # Will refresh token
```

---

## Future Roadmap

### Planned Features

1. **Unified Pull Command**
   ```bash
   newo pull --only projects,integrations
   newo pull --all  # Everything
   ```

2. **Unified Entity Commands**
   ```bash
   newo create agent MyBot --project proj
   newo delete skill OldSkill --confirm
   ```

3. **Watch Mode**
   ```bash
   newo watch  # Auto-push on file changes
   ```

4. **Diff Command**
   ```bash
   newo diff  # Show local vs remote differences
   ```

---

## Summary

The NEWO CLI provides a complete development workflow for NEWO AI Agent skills:

1. **Pull** → Edit → **Status** → **Push** (daily workflow)
2. **Create** entities locally, then **Push** (new development)
3. **Migrate** entire accounts (enterprise)
4. **Sandbox** test agents (debugging)

The V2 architecture improves maintainability and enables future features like selective sync, while maintaining full backward compatibility with existing commands.
