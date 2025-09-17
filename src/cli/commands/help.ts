/**
 * Help command handler
 */

export function handleHelpCommand(): void {
  console.log(`NEWO CLI - Multi-Customer Support
Usage:
  newo pull [--customer <idn>]                  # download projects -> ./newo_customers/<idn>/projects/
  newo push [--customer <idn>]                  # upload modified *.guidance/*.jinja back to NEWO
  newo status [--customer <idn>]                # show modified files
  newo conversations [--customer <idn>] [--all] # download user conversations -> ./newo_customers/<idn>/conversations.yaml
  newo list-customers                           # list available customers
  newo meta [--customer <idn>]                  # get project metadata (debug)
  newo import-akb <file> <persona_id> [--customer <idn>]  # import AKB articles from file

Flags:
  --customer <idn>             # specify customer (if not set, uses default or interactive selection)
  --all                        # include all available data (for conversations: all personas and acts)
  --force, -f                  # force overwrite without prompting (for pull command)
  --verbose, -v                # enable detailed logging

Environment Variables:
  NEWO_BASE_URL                                 # NEWO API base URL (default: https://app.newo.ai)
  NEWO_CUSTOMER_<IDN>_API_KEY                   # API key for customer <IDN>
  NEWO_CUSTOMER_<IDN>_PROJECT_ID               # Optional: specific project ID for customer
  NEWO_DEFAULT_CUSTOMER                        # Optional: default customer to use

Multi-Customer Examples:
  # Configure customers in .env:
  NEWO_CUSTOMER_acme_API_KEY=your_acme_api_key
  NEWO_CUSTOMER_globex_API_KEY=your_globex_api_key
  NEWO_DEFAULT_CUSTOMER=acme

  # Commands:
  newo pull                                    # Pull from all customers (if no default set)
  newo pull --customer acme                    # Pull projects for Acme only
  newo status                                  # Status for all customers (if no default set)
  newo push                                    # Interactive selection for multiple customers
  newo push --customer globex                  # Push changes for Globex only

File Structure:
  newo_customers/
  ├── acme/
  │   └── projects/
  │       └── project1/
  └── globex/
      └── projects/
          └── project2/
`);
}