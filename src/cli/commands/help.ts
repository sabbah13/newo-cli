/**
 * Help command handler
 */

export function handleHelpCommand(): void {
  console.log(`NEWO CLI - Multi-Customer Support
A professional command-line tool for NEWO AI Agent development with modular architecture and comprehensive multi-customer support.

Core Commands:
  newo pull [--customer <idn>]                  # download projects + attributes -> ./newo_customers/<idn>/
  newo push [--customer <idn>] [--no-publish]    # upload modified *.guidance/*.jinja + attributes back to NEWO, publish flows by default
  newo status [--customer <idn>]                # show modified files that would be pushed
  newo conversations [--customer <idn>] [--all] # download user conversations -> ./newo_customers/<idn>/conversations.yaml
  newo sandbox "<message>" [--customer <idn>]   # test agent in sandbox - single message mode (NEW v3.1.0)
  newo sandbox --actor <id> "message"           # continue existing sandbox conversation with chat ID
  newo pull-attributes [--customer <idn>]       # download customer + project attributes -> ./newo_customers/<idn>/attributes.yaml + projects/{project}/attributes.yaml
  newo list-customers                           # list available customers and their configuration
  newo meta [--customer <idn>]                  # get project metadata (debug command)
  newo import-akb <file> <persona_id> [--customer <idn>]  # import AKB articles from structured text file

Project Management:
  newo create-project <idn> [--title <title>] [--description <desc>] [--version <version>] [--auto-update]  # create project on platform ✅

Entity Management (Full Lifecycle Support):
  newo create-agent <idn> --project <project-idn> [--title <title>] [--description <desc>]    # create agent → push to platform ✅
  newo delete-agent <agent-idn> --project <project-idn> [--confirm]    # delete agent locally (requires --confirm)
  newo create-flow <idn> --agent <agent-idn> --project <project-idn> [--title <title>] [--description <desc>] [--runner <guidance|nsl>]  # create flow → push to platform ✅
  newo delete-flow <flow-idn> --agent <agent-idn> --project <project-idn> [--confirm]  # delete flow locally (requires --confirm)
  newo create-skill <idn> --flow <flow-idn> --agent <agent-idn> --project <project-idn> [--title <title>] [--script <content>] [--runner <guidance|nsl>]  # create skill → push to platform ✅
  newo delete-skill <skill-idn> --flow <flow-idn> --agent <agent-idn> --project <project-idn> [--confirm]  # delete skill locally (requires --confirm)

Identity & Configuration:
  newo create-persona <name> [--title <title>] [--description <desc>]  # create agent persona ✅
  newo create-attribute <idn> --value <value> [--title <title>] [--group <group>] [--value-type <string>]  # create customer attribute ✅

Advanced Components (NSL Focus):
  newo create-event <idn> --flow <flow-id> --skill <skill-idn> [--description <desc>] [--integration <api|system>] [--connector <webhook|system>]  # create flow event ✅
  newo create-state <idn> --flow <flow-id> [--title <title>] [--default-value <value>] [--scope <user|flow|global>]  # create flow state ✅
  newo create-parameter <name> --skill <skill-id> [--default-value <value>]  # create skill parameter (API limitations)

Enterprise Features:
  newo conversations [--customer <idn>] [--all]             # download conversation history
  newo pull-attributes [--customer <idn>]                   # sync customer attributes
  newo import-akb <file> <persona_id>                       # import knowledge base articles
  newo pull-integrations [--customer <idn>]                 # download integrations and connectors → ./newo_customers/<idn>/integrations/
  newo push-integrations [--customer <idn>]                 # upload integration and connector changes to platform
  newo list-actions [--customer <idn>]                      # list all available NSL/Jinja script actions with parameters
  newo profile [--customer <idn>]                           # display customer profile information
  newo pull-akb [--customer <idn>]                          # download AKB articles for all personas with agents → ./newo_customers/<idn>/akb/
  newo push-akb [--customer <idn>]                          # upload AKB articles from local YAML files to platform

Account Migration (NEW):
  newo migrate-account --source <idn> --dest <idn> [--yes]  # migrate complete account from source to destination
  newo verify --source <idn> --dest <idn>                    # verify migration by comparing entity counts
  newo create-webhooks [--customer <idn>]                    # create webhooks from YAML files

Flags:
  --customer <idn>             # specify customer (if not set, uses default or interactive selection)
  --all                        # include all available data (for conversations: all personas and acts)
  --force, -f                  # force overwrite without prompting (for pull command)
  --verbose, -v                # enable detailed logging and progress information
  --quiet, -q                  # minimal output for automation (sandbox only)
  --actor <id>                 # continue existing sandbox chat with actor/chat ID
  --confirm                    # confirm destructive operations without prompting
  --no-publish                 # skip automatic flow publishing during push operations

Environment Variables:
  NEWO_BASE_URL                                 # NEWO API base URL (default: https://app.newo.ai)

Single Customer:
  NEWO_API_KEY                                  # API key for single customer setup
  NEWO_PROJECT_ID                               # Optional: specific project ID

Multi-Customer:
  NEWO_API_KEYS                                 # JSON array of API keys or key+project objects
  NEWO_CUSTOMER_<IDN>_API_KEY                   # API key for specific customer <IDN>
  NEWO_CUSTOMER_<IDN>_PROJECT_ID               # Optional: specific project ID for customer
  NEWO_DEFAULT_CUSTOMER                        # Optional: default customer to use

Configuration Examples:
  # Single customer setup:
  NEWO_API_KEY=your_api_key_here

  # Multi-customer JSON array:
  NEWO_API_KEYS=["key1", "key2", "key3"]

  # Multi-customer with project IDs:
  NEWO_API_KEYS=[{"key":"key1","project_id":"uuid1"}, {"key":"key2"}]

  # Multi-customer individual variables:
  NEWO_CUSTOMER_acme_API_KEY=acme_api_key_here
  NEWO_CUSTOMER_globex_API_KEY=globex_api_key_here
  NEWO_DEFAULT_CUSTOMER=acme

Usage Examples:
  # Basic workflow:
  newo pull                                    # Download all projects and attributes
  newo status                                  # Check for local modifications
  newo push                                    # Upload changes back to NEWO

  # Multi-customer operations:
  newo pull --customer acme                    # Pull projects for Acme only
  newo push --customer globex                  # Push changes for Globex only
  newo conversations --all                     # Download all conversations with full history

  # Complete weather system workflow (FULLY WORKING - NSL Focus):
  newo create-project weather_system --title "Weather System" --description "Comprehensive weather service"
  newo create-persona weather_persona --title "Weather Persona" --description "Professional weather assistant"
  newo create-attribute weather_api_key --value "your_api_key" --group "Weather Config"
  newo pull                                    # Sync new project locally

  newo create-agent WeatherBot --project weather_system --title "Weather Bot" --persona-id <persona-id>
  newo create-flow MainFlow --agent WeatherBot --project weather_system --title "Main Flow" --runner nsl
  newo push && newo pull                       # Creates agent + flow, syncs IDs

  newo create-skill WeatherSkill --flow MainFlow --agent WeatherBot --project weather_system --title "Weather NSL Skill" --runner nsl
  newo create-event user_message --flow <flow-id> --skill WeatherSkill --integration api --connector webhook
  newo create-state user_location --flow <flow-id> --title "User Location" --scope user
  newo create-state request_count --flow <flow-id> --title "Request Count" --scope flow
  newo push                                    # Creates complete system
  newo status                                  # Should show: Clean

  # Import AKB articles:
  newo import-akb articles.txt da4550db-2b95-4500-91ff-fb4b60fe7be9

  # Sandbox testing (NEW v3.1.0):
  newo sandbox "Hello, I want to order pizza"                    # Start new conversation
  newo sandbox --actor abc123... "I want 2 large pizzas"         # Continue conversation
  newo sandbox "Test query" --verbose                            # With debug info
  newo sandbox "Test query" --quiet                              # For automation/scripts

File Structure:
  newo_customers/
  ├── <customer-idn>/
  │   ├── attributes.yaml                      # Customer attributes (pull-attributes)
  │   ├── conversations.yaml                   # User conversations and personas
  │   ├── akb/                                 # AKB knowledge base articles (pull-akb)
  │   │   └── <agent-idn>.yaml                # AKB articles per agent persona
  │   ├── integrations/                        # Integration configurations (pull-integrations)
  │   │   ├── integrations.yaml               # Master integrations list
  │   │   └── <integration-idn>/
  │   │       ├── <integration-idn>.yaml      # Integration metadata + settings (combined)
  │   │       └── connectors/
  │   │           └── <connector-idn>/        # Each connector in own directory
  │   │               ├── <connector-idn>.yaml  # Connector config
  │   │               └── webhooks/           # Webhooks subdirectory (if any)
  │   │                   ├── outgoing.yaml   # Outgoing webhooks
  │   │                   └── incoming.yaml   # Incoming webhooks
  │   └── projects/
  │       └── <project-idn>/
  │           ├── attributes.yaml              # Project attributes (pull-attributes)
  │           ├── flows.yaml                   # Auto-generated project structure
  │           ├── metadata.yaml                # Project metadata
  │           └── <agent-idn>/
  │               ├── metadata.yaml            # Agent metadata
  │               └── <flow-idn>/
  │                   ├── metadata.yaml        # Flow metadata
  │                   └── <skill-idn>/
  │                       ├── skill.guidance   # AI guidance scripts
  │                       ├── skill.jinja      # NSL/Jinja template scripts
  │                       └── metadata.yaml    # Skill metadata
  └── .newo/                                   # CLI state and mappings (auto-generated)

For more information, visit: https://github.com/sabbah13/newo-cli
`);
}