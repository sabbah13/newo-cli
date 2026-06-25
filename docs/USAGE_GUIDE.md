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

**New V2 skills on push (v3.7.4+):** In `newo_v2` format you can add a skill inline to a flow's `{FlowIdn}.yaml`, drop its `.nsl`/`.nslg` script next to it, and `newo push` will create it on the platform (previously only updates of already-pulled skills worked). Each new skill must resolve a model - set `skill.model.*` inline or the flow's `default_model_idn` / `default_provider_idn`, or push reports a clear error for that skill (other skills still push).

#### Customer & Project Attributes
```bash
newo pull-attributes         # Downloads attributes.yaml files
# Edit newo_customers/{idn}/attributes.yaml
# Edit newo_customers/{idn}/projects/{project}/attributes.yaml
newo push                    # Uploads attribute changes
```

**JSON-typed attributes (v3.7.3+):** Attributes with `value_type: json` (e.g. the Workflow Builder canvas) are normalized on pull: invalid JSON escape sequences (like `\_` from Markdown emphasis) are stripped and the value is compacted to a single-line JSON string. This is required so that `yaml.dump` + `patchYamlToPyyaml` does not corrupt escape sequences on push and leave the Workflow Builder showing a blank canvas. The first re-pull on existing repos may produce a one-time stylistic diff (pretty → compact); subsequent pull/push cycles are stable. Change-detection compares canonical JSON on both sides, so cosmetic differences against the remote do not trigger spurious pushes.

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
newo conversations           # Downloads all conversation history
# View in newo_customers/{idn}/conversations.yaml
```

#### Inspect one session (v3.7.6+)

Use `newo session <uuid>` with the platform `session_id` (from an assessor report or the Conversations UI).

```bash
# ⭐ START HERE — dialog view (default): fast, and already includes the agent's
#    THOUGHTS reasoning + system-log lines for voice/chat personas.
newo session 30557d03-4542-41ba-9413-7d9e1a19e364     # writes conversation-<uuid>.yaml + prints the dialog
newo session <uuid> --json                            # dialog chronicle to stdout for piping
newo session <uuid> --customer <idn>                  # pick account in multi-customer setups

# Only if you also need the low-level skill-call trace (heavier):
newo session <uuid> --full                            # dialog + execution trace -> conversation-<uuid>-full.yaml
newo session <uuid> --full --max-logs 3000            # cap the trace fetch (default 20000); progress is printed
newo session <uuid> --full --pad-end 20               # collect logs up to 20 min past the last turn
```

**Recommendation:** reach for the plain `newo session <uuid>` (dialog) first — it is one fast fetch. For **some** sessions it also shows the THOUGHTS blocks, booking payloads, availability results and the end-of-session summary; for others it returns only the spoken turns (the richer narrative lives in the UI-only `acts` layer, which an api-key token cannot read — see below). Add `--full` only when you must see every underlying skill/NSL call; a busy session can have tens of thousands of them, so that path prints progress and is bounded by `--max-logs`.

> `newo conversations --session-id <uuid> [--full]` is the long form of `newo session <uuid> [--full]` — identical behavior.

**How it works (api-key safe):** resolves the session via `user-personas?session_id=…`, then pulls `chat/history` (dialog) and, for `--full`, `analytics/logs` scoped to the actor within the session's time window. The Builder UI's full chronicle endpoint (`acts?session_id=…`) needs a logged-in user token — its api-key token has an empty `account_id` and the endpoint hangs — so a couple of UI-only act layers and recording links are not included (see `docs/SESSION_CHRONICLE_PLATFORM_ASK.md`). The session must belong to the configured account (conversations are scoped per customer).

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

**Flow events and `newo push` (v3.7.2+):** Editing `events:` or `state_fields:` in a flow's `metadata.yaml` (V1) or `{FlowIdn}.yaml` (V2) now syncs to the platform on `newo push`. Hash-gated — only changed flows are reconciled. After `newo create-event`, run `newo pull` first to fold the new event into local metadata; otherwise the next push will treat the event as platform-only and delete it. See README → "Flow Metadata Sync".

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

**Connector selection & automation (v3.7.5+):** By default `newo sandbox` chats through the *first* running connector of the `sandbox` integration. To target a specific one (e.g. a Vibe Builder behind `vibe_agent`), and for automation:

```bash
newo sandbox --list-connectors                          # show running connectors (--json for machine output)
newo sandbox "ping" --connector vibe_agent              # chat through a specific connector
newo sandbox --file ./long-message.txt --json          # send a large message from a file, machine-readable output
cat msg.txt | newo sandbox --stdin --timeout 420 --json # from stdin, 7-minute response timeout
```

The `--json` output includes `external_event_id` (user + agent turns), which correlates a chat turn with its logs: `newo logs --event-id <id> --name Gen --json` (the turn's model is in `data.source.model`, not the actor/agent name).

**Point skill edits without a workspace (v3.7.5+):** Inspect or change a single skill on the platform by IDN path, no pull required - handy for "switch model → test → switch back":

```bash
newo get-skill <skill-idn> --project <p> --agent <a> --flow <f> [--json]
newo update-skill <skill-idn> --project <p> --agent <a> --flow <f> --model openai/gpt4o [--publish]
newo update-skill <skill-idn> --project <p> --agent <a> --flow <f> --script ./patched.nsl --publish
```

Changes are draft-only unless `--publish` is passed; if a pulled local workspace exists it warns that it now diverges (run `newo pull` to resync).

**Set the displayed project version after a deploy (v3.7.7+):** After pushing a project template into a customer account, the displayed version in the Builder (`builder.newo.ai/projects`) can stay stale. Set it so the label matches the deployed template — this is a pure metadata update (no content re-sync), so it composes after a content `newo push`:

```bash
newo update-project naf --version 4.5.2 --customer <idn>     # set the displayed version
newo update-project naf --version 4.5.2 --json               # machine-readable effective state
newo update-project naf --force-update                       # re-sync project content from its registry
newo update-project naf --force-update --version 4.5.2       # force-update, then set the label
```

The displayed value is the project's `version` field — not `registry_item_version`, and not content push (which never writes it). The command GETs the current project meta, overlays only the fields you pass, and PATCHes the full object back (the platform PATCH is not a true partial — an empty body would reset `is_auto_update_enabled`). `--force-update` fires the Builder's "Force Update Project" action and runs before the version PATCH, so an explicit `--version` still wins the label.

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

#### 2. Selective Sync

The V2 SyncEngine supports selective resource sync:

```typescript
// In code (for integration)
await syncEngine.pullSelected(customer, ['projects', 'attributes']);
await syncEngine.pushSelected(customer, ['integrations']);
```

CLI usage:
```bash
# Pull only specific resources
newo pull --only projects,attributes

# Exclude certain resources
newo pull --exclude conversations

# Push only specific resources
newo push --only projects

# Explicit all resources
newo pull --all
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
| `newo update-project` | Set displayed project version / force-update from registry (v3.7.7+) |

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

## New Features (V2 Architecture)

### Selective Sync

Sync only specific resource types:

```bash
# Pull only projects and attributes
newo pull --only projects,attributes

# Push all except integrations
newo push --exclude integrations

# Explicit all resources
newo pull --all

# Available resources: projects, attributes, integrations, akb, conversations
```

### Watch Mode

Auto-push on file changes:

```bash
# Watch all files and auto-push
newo watch

# Watch only project files
newo watch --only projects

# Custom debounce delay (default: 1000ms)
newo watch --debounce 2000

# Press Ctrl+C to stop watching
```

### Diff Command

Compare local files with remote platform:

```bash
# Show all differences
newo diff

# Show only project differences
newo diff --only projects

# Show detailed content-level diffs
newo diff --detailed
```

The diff output shows:
- **➕ Added locally** - Files that exist locally but not remotely
- **📝 Modified** - Files that differ between local and remote
- **➖ Deleted locally** - Files that exist remotely but not locally

---

## Summary

The NEWO CLI provides a complete development workflow for NEWO AI Agent skills:

1. **Pull** → Edit → **Status** → **Push** (daily workflow)
2. **Create** entities locally, then **Push** (new development)
3. **Migrate** entire accounts (enterprise)
4. **Sandbox** test agents (debugging)

The V2 architecture improves maintainability and enables future features like selective sync, while maintaining full backward compatibility with existing commands.
