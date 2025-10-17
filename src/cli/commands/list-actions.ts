/**
 * List actions command handler
 * Displays all available NSL/Jinja script actions
 */
import { makeClient, getScriptActions } from '../../api.js';
import { getValidAccessToken } from '../../auth.js';
import { requireSingleCustomer } from '../customer-selection.js';
import type { MultiCustomerConfig, CliArgs } from '../../types.js';

export async function handleListActionsCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean
): Promise<void> {
  const selectedCustomer = requireSingleCustomer(customerConfig, args.customer as string | undefined);

  const accessToken = await getValidAccessToken(selectedCustomer);
  const client = await makeClient(verbose, accessToken);

  console.log(`📋 Fetching available script actions...\n`);
  const actions = await getScriptActions(client);

  console.log(`✅ Found ${actions.length} script actions\n`);

  // Group actions by category
  const categories = new Map<string, typeof actions>();

  for (const action of actions) {
    // Categorize by prefix (e.g., Get, Create, Delete, Gen, etc.)
    const category = getCategoryFromActionTitle(action.title);
    if (!categories.has(category)) {
      categories.set(category, []);
    }
    categories.get(category)!.push(action);
  }

  // Display actions by category
  const sortedCategories = Array.from(categories.entries()).sort(([a], [b]) => a.localeCompare(b));

  for (const [category, categoryActions] of sortedCategories) {
    console.log(`\n${category}:`);

    for (const action of categoryActions.sort((a, b) => a.title.localeCompare(b.title))) {
      console.log(`  • ${action.title}`);

      // Show parameters if verbose
      if (verbose && Object.keys(action.arguments).length > 0) {
        console.log(`    Parameters:`);
        for (const [paramName, paramSchema] of Object.entries(action.arguments)) {
          const required = paramSchema.default === undefined && !paramSchema.anyOf ? ' (required)' : '';
          console.log(`      - ${paramName}: ${paramSchema.type}${required}`);
        }
      }
    }
  }

  console.log(`\n💡 Use --verbose flag to see parameter details\n`);
}

/**
 * Categorize action by its title prefix
 */
function getCategoryFromActionTitle(title: string): string {
  // Common prefixes
  const prefixes = [
    'Gen',
    'Get',
    'Create',
    'Delete',
    'Update',
    'Set',
    'Send',
    'Append',
    'Build',
    'Parse',
    'Validate',
    'Format',
    'Convert',
    'Filter',
    'Sort',
    'Search'
  ];

  for (const prefix of prefixes) {
    if (title.startsWith(prefix)) {
      return `${prefix} Actions`;
    }
  }

  // Special cases
  if (title.includes('Array') || title.includes('JSON')) {
    return 'Data Manipulation';
  }

  if (title.includes('Actor') || title.includes('Persona')) {
    return 'User Management';
  }

  if (title.includes('Message') || title.includes('Chat')) {
    return 'Communication';
  }

  if (title.includes('Akb') || title.includes('Knowledge')) {
    return 'Knowledge Base';
  }

  if (title.includes('Attribute')) {
    return 'Attributes';
  }

  return 'Other Actions';
}
