/**
 * Conversations command handler
 */
import path from 'path';
import yaml from 'js-yaml';
import { makeClient } from '../../api.js';
import { pullConversations, pullConversationBySession } from '../../sync.js';
import { writeFileSafe } from '../../fsutil.js';
import { getValidAccessToken } from '../../auth.js';
import { selectSingleCustomer, requireSingleCustomer } from '../customer-selection.js';
import type { MultiCustomerConfig, CliArgs } from '../../types.js';

export async function handleConversationsCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean
): Promise<void> {
  // Single-session mode: fetch just one conversation's act chronicle.
  const sessionId = args['session-id'] ? String(args['session-id']) : null;
  if (sessionId) {
    await handleSessionChronicle(customerConfig, args, sessionId, verbose);
    return;
  }

  const { selectedCustomer, allCustomers, isMultiCustomer } = selectSingleCustomer(
    customerConfig,
    args.customer as string | undefined
  );

  // Parse conversation-specific options - load all data by default
  const conversationOptions = {
    includeAll: true, // Always include all data for conversations
    maxPersonas: undefined, // No limit on personas
    maxActsPerPersona: undefined // No limit on acts per persona
  };

  if (selectedCustomer) {
    // Single customer conversations
    const accessToken = await getValidAccessToken(selectedCustomer);
    const client = await makeClient(verbose, accessToken);
    console.log(`💬 Pulling conversations for customer: ${selectedCustomer.idn} (all data)`);
    await pullConversations(client, selectedCustomer, conversationOptions, verbose);
    console.log(`✅ Conversations saved to newo_customers/${selectedCustomer.idn}/conversations.yaml`);
  } else if (isMultiCustomer) {
    // Multi-customer conversations
    if (verbose) console.log(`💬 No default customer specified, pulling conversations from all ${allCustomers.length} customers`);
    console.log(`💬 Pulling conversations from ${allCustomers.length} customers (all data)...`);

    for (const customer of allCustomers) {
      console.log(`\n💬 Pulling conversations for customer: ${customer.idn}`);
      const accessToken = await getValidAccessToken(customer);
      const client = await makeClient(verbose, accessToken);
      await pullConversations(client, customer, conversationOptions, verbose);
    }
    console.log(`\n✅ Conversations pull completed for all ${allCustomers.length} customers`);
  }
}

/**
 * Fetch and output the act chronicle (dialog) for a single conversation session.
 * Default: write a per-session YAML file. With --json: print JSON to stdout.
 */
async function handleSessionChronicle(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  sessionId: string,
  verbose: boolean
): Promise<void> {
  const asJson = Boolean(args.json);
  if (asJson) process.env.NEWO_QUIET_MODE = 'true'; // keep stdout machine-readable

  const customer = requireSingleCustomer(customerConfig, args.customer as string | undefined);
  if (!asJson) console.log(`💬 Fetching conversation session ${sessionId} for ${customer.idn}...`);

  const accessToken = await getValidAccessToken(customer);
  const client = await makeClient(verbose, accessToken);

  const chronicle = await pullConversationBySession(client, sessionId, verbose);

  if (asJson) {
    console.log(JSON.stringify(chronicle, null, 2));
    return;
  }

  if (chronicle.total_acts === 0) {
    console.log(`\nNo acts found for session ${sessionId}. The session may not exist in this account, or may have no recorded acts.`);
    return;
  }

  const outPath = path.join('newo_customers', customer.idn, `conversation-${sessionId}.yaml`);
  const yamlContent = yaml.dump(chronicle, {
    indent: 2,
    quotingType: '"',
    forceQuotes: false,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
    flowLevel: -1
  });
  await writeFileSafe(outPath, yamlContent);

  const who = chronicle.personas.map(p => p.name).join(', ') || '(none)';
  console.log(`\n📝 Session ${sessionId}: ${chronicle.total_acts} acts across ${chronicle.personas.length} persona(s) [${who}]`);
  for (const act of chronicle.acts) {
    const time = act.datetime.replace('T', ' ').replace(/\.\d+Z?$/, '');
    const tag = act.speaker === 'agent' ? '🤖 agent' : '👤 user ';
    const text = act.message.length > 200 ? `${act.message.slice(0, 200)}…` : act.message;
    console.log(`  ${time}  ${tag}  ${text}`);
  }
  console.log(`\n✅ Saved to ${outPath}`);
}