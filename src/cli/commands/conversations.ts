/**
 * Conversations command handler
 */
import path from 'path';
import yaml from 'js-yaml';
import { makeClient } from '../../api.js';
import { pullConversations, pullConversationBySession, pullSessionFull } from '../../sync.js';
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
    if (args.full) {
      await handleSessionFull(customerConfig, args, sessionId, verbose);
    } else {
      await handleSessionChronicle(customerConfig, args, sessionId, verbose);
    }
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

/**
 * Fetch the fullest api-key-reachable view of a session: dialog turns
 * (chat/history) merged with the execution trace (analytics/logs). The full UI
 * chronicle (acts) is not reachable with an api-key token — see
 * docs/SESSION_CHRONICLE_PLATFORM_ASK.md.
 */
async function handleSessionFull(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  sessionId: string,
  verbose: boolean
): Promise<void> {
  const asJson = Boolean(args.json);
  if (asJson) process.env.NEWO_QUIET_MODE = 'true'; // keep stdout machine-readable

  const customer = requireSingleCustomer(customerConfig, args.customer as string | undefined);
  if (!asJson) console.log(`💬 Assembling full session ${sessionId} for ${customer.idn} (chat + logs)...`);

  const accessToken = await getValidAccessToken(customer);
  const client = await makeClient(verbose, accessToken);

  const padEnd = args['pad-end'] !== undefined ? Number(args['pad-end']) : 10;
  const maxLogs = args['max-logs'] !== undefined ? Number(args['max-logs']) : 20000;
  const chronicle = await pullSessionFull(
    client,
    sessionId,
    verbose,
    Number.isFinite(padEnd) ? padEnd : 10,
    Number.isFinite(maxLogs) && maxLogs > 0 ? maxLogs : 20000
  );

  if (asJson) {
    console.log(JSON.stringify(chronicle, null, 2));
    return;
  }

  if (chronicle.timeline.length === 0) {
    console.log(`\nNo data found for session ${sessionId}. The session may not exist in this account, or may have no dialog turns to anchor the log window.`);
    return;
  }

  const outPath = path.join('newo_customers', customer.idn, `conversation-${sessionId}-full.yaml`);
  const yamlContent = yaml.dump(chronicle, {
    indent: 2, quotingType: '"', forceQuotes: false, lineWidth: 120, noRefs: true, sortKeys: false, flowLevel: -1
  });
  await writeFileSafe(outPath, yamlContent);

  const who = chronicle.personas.map(p => p.name).join(', ') || '(none)';
  console.log(`\n📝 Session ${sessionId}: ${chronicle.total_messages} messages + ${chronicle.total_log_entries} log entries across ${chronicle.personas.length} persona(s) [${who}]`);

  // Dialog turns inline (these are the few human-readable rows).
  console.log('\nDialog:');
  for (const e of chronicle.timeline) {
    if (e.kind !== 'message') continue;
    const time = e.datetime.replace('T', ' ').replace(/\.\d+Z?$/, '');
    const tag = e.speaker === 'agent' ? '🤖 agent' : '👤 user ';
    const text = (e.text || '').length > 160 ? `${(e.text || '').slice(0, 160)}…` : (e.text || '');
    console.log(`  ${time}  ${tag}  ${text}`);
  }

  // Execution trace is large (hundreds–thousands of calls) — summarize to the
  // console; the full merged timeline is in the YAML file.
  const calls = chronicle.timeline.filter(e => e.kind !== 'message');
  if (calls.length > 0) {
    const byFlow: Record<string, number> = {};
    const byAction: Record<string, number> = {};
    const models = new Set<string>();
    for (const e of calls) {
      if (e.flow_idn) byFlow[e.flow_idn] = (byFlow[e.flow_idn] ?? 0) + 1;
      if (e.name) byAction[e.name] = (byAction[e.name] ?? 0) + 1;
      if (e.model) models.add(e.model);
    }
    const top = (rec: Record<string, number>, n: number) =>
      Object.entries(rec).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}(${v})`).join(', ');
    console.log(`\nExecution trace: ${calls.length} entries`);
    if (Object.keys(byFlow).length) console.log(`  flows:   ${top(byFlow, 8)}`);
    if (Object.keys(byAction).length) console.log(`  actions: ${top(byAction, 12)}`);
    if (models.size) console.log(`  models:  ${[...models].join(', ')}`);
  }

  if (chronicle.partial) console.log('\n⚠️  Pagination cap hit — output may be truncated.');
  console.log(`\nℹ️  Full UI chronicle (thoughts/analyze/report/recordings) needs the platform account_id fix — see docs/SESSION_CHRONICLE_PLATFORM_ASK.md`);
  console.log(`\n✅ Full timeline saved to ${outPath}`);
}