# NEWO CLI Feature Analysis & Improvement Plan

## Current Feature Inventory

### CLI Commands (36 total)

| Category | Command | Lines | Description |
|----------|---------|-------|-------------|
| **Core Sync** | `pull` | 43 | Pull projects + project attributes |
| | `push` | 64 | Push changed skills + project attributes |
| | `status` | 29 | Show modified files |
| **Resource-Specific** | `pull-integrations` | 28 | Pull integrations/connectors/webhooks |
| | `push-integrations` | 27 | Push connector changes |
| | `pull-akb` | 28 | Pull AKB articles |
| | `push-akb` | 27 | Push AKB articles |
| | `pull-attributes` | 42 | Pull customer+project attributes |
| | `conversations` | 59 | Pull conversation history |
| **Entity Create** | `create-project` | 75 | Create new project |
| | `create-agent` | 99 | Create new agent |
| | `create-flow` | 131 | Create new flow |
| | `create-skill` | 156 | Create new skill |
| | `create-event` | 89 | Create flow event |
| | `create-state` | 73 | Create flow state |
| | `create-parameter` | 67 | Create skill parameter |
| | `create-persona` | 57 | Create persona |
| | `create-attribute` | 83 | Create customer attribute |
| **Entity Delete** | `delete-agent` | 90 | Delete agent |
| | `delete-flow` | 108 | Delete flow |
| | `delete-skill` | 116 | Delete skill |
| **Migration** | `migrate-account` | 109 | Full account migration |
| | `verify` | 93 | Verify migration |
| | `create-webhooks` | 101 | Create webhooks from YAML |
| **Registry** | `list-registries` | 60 | List available registries |
| | `list-registry-items` | 169 | List registry items |
| | `add-project` | 200 | Add project from registry |
| **Utility** | `help` | 355 | Show help |
| | `list-customers` | 16 | List configured customers |
| | `profile` | 80 | Show customer profile |
| | `list-actions` | 91 | List NSL script actions |
| | `meta` | 31 | Show project metadata |
| | `sandbox` | 365 | Test agent in sandbox |
| | `import-akb` | 78 | Import AKB from file |

---

## Issues Identified

### 1. Inconsistent Command Naming

| Current | Problem | Suggested |
|---------|---------|-----------|
| `conversations` | Not prefixed with `pull-` | `pull-conversations` |
| `import-akb` | Different pattern from `pull-akb`/`push-akb` | Keep for file import, clarify purpose |
| `meta` | Unclear purpose | `show-metadata` or integrate into `help` |
| `verify` | Also aliased as `verify-migration` | Consolidate to one |

### 2. Fragmented Pull/Push Operations

**Current behavior:**
```bash
newo pull                    # Pulls: projects, project attributes
newo pull-integrations       # Pulls: integrations, connectors, webhooks
newo pull-akb                # Pulls: AKB articles
newo pull-attributes         # Pulls: customer + project attributes
newo conversations           # Pulls: conversation history
```

**User confusion:** What does `newo pull` actually pull?

**Suggested unified approach:**
```bash
newo pull                     # Pulls ALL resources
newo pull --only projects,attributes  # Selective pull
newo pull --exclude akb       # Pull everything except AKB
```

### 3. Duplicate Sync Logic

| File | Lines | Duplicated Logic |
|------|-------|------------------|
| `sync/migrate.ts` | 746 | Duplicates pull/push from projects, attributes, integrations, akb |
| `sync/projects.ts` | 625 | Project pull logic (also in migrate) |
| `sync/attributes.ts` | 414 | Attribute pull logic (also in migrate) |
| `sync/integrations.ts` | 463 | Integration pull logic (also in migrate) |
| `sync/akb.ts` | 199 | AKB pull logic (also in migrate) |

**Total duplicated code:** ~1000+ lines

### 4. Inconsistent Entity Commands

**Create commands (9):**
- create-project, create-agent, create-flow, create-skill
- create-event, create-state, create-parameter
- create-persona, create-attribute

**Delete commands (3):**
- delete-agent, delete-flow, delete-skill

**Missing delete commands:**
- delete-project, delete-event, delete-state, delete-parameter
- delete-persona, delete-attribute

### 5. No Unified Resource Model

Each resource type has its own implementation pattern:
- Projects: Pull via `pullAll()`, push via custom logic
- Integrations: Pull via `pullIntegrations()`, push via `pushIntegrations()`
- AKB: Pull via `pullAkb()`, push via `pushAkb()`
- Attributes: Pull via `pullAttributes()`, push via `pushAttributes()`

---

## Improvement Plan

### Phase 1: Complete V2 Sync Strategies

Implement remaining strategies to complete the V2 architecture:

1. **IntegrationSyncStrategy** - Handle integrations, connectors, webhooks
2. **AkbSyncStrategy** - Handle AKB articles
3. **ConversationSyncStrategy** - Handle conversation history (pull-only)

### Phase 2: Unified Pull/Push

Update SyncEngine to support resource selection:

```typescript
// New SyncEngine methods
async pullAll(customer, options?: { only?: string[], exclude?: string[] })
async pushAll(customer, options?: { only?: string[], exclude?: string[] })
```

### Phase 3: Unified Entity Commands

Create EntityManager pattern:

```typescript
// Single create command routing
newo create <type> <idn> [options]

// Maps to appropriate strategy
EntityManager.create('agent', 'myAgent', { project: 'p1' })
```

### Phase 4: Update CLI Commands

Keep backward compatibility while adding unified commands:

```bash
# New unified commands (preferred)
newo sync pull [--only <resources>]
newo sync push [--only <resources>]
newo entity create <type> <idn>
newo entity delete <type> <idn>

# Legacy commands (still work)
newo pull
newo pull-integrations
newo create-agent
```

---

## V2 Architecture Benefits

### Code Reduction

| Component | Current | V2 | Savings |
|-----------|---------|-----|---------|
| Sync logic | ~2500 lines (duplicated) | ~1500 lines (shared) | 40% |
| Migration | 746 lines | 100 lines (composition) | 87% |
| Entity commands | 9 × 100 = 900 lines | 300 lines (unified) | 67% |
| **Total** | ~4000+ lines | ~1900 lines | **52%** |

### Maintenance

| Task | Current | V2 |
|------|---------|-----|
| Add new resource | 4 files, 500+ lines | 1 strategy, 100 lines |
| Fix sync bug | Find in 5+ places | Fix once in SyncEngine |
| Add validation | Modify each command | Add to strategy interface |

### Developer Experience

| Aspect | Current | V2 |
|--------|---------|-----|
| Understanding | "What does pull do?" | "pull gets all resources" |
| Learning curve | Memorize 36 commands | Learn 5 patterns |
| Extension | Copy/paste from existing | Implement strategy interface |

---

## Implementation Priority

1. **High Priority (This Sprint)**
   - Complete IntegrationSyncStrategy
   - Complete AkbSyncStrategy
   - Update SyncEngine for selective sync
   - Wire adapters for backward compatibility

2. **Medium Priority (Next Sprint)**
   - Unified entity commands
   - ConversationSyncStrategy
   - Legacy command aliases

3. **Low Priority (Future)**
   - Command deprecation notices
   - Migration to new CLI structure
   - Documentation update

---

## Metrics to Track

1. **Code Quality**
   - Lines of code reduction
   - Cyclomatic complexity
   - Test coverage

2. **User Experience**
   - Command learning curve
   - Error message clarity
   - Operation predictability

3. **Maintainability**
   - Time to add new resource type
   - Bug fix propagation
   - Code duplication ratio
