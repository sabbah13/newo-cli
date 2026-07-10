/**
 * Update Agent Command Handler — set an agent's title/description/persona on the platform.
 *
 * Usage:
 *   newo update-agent <agent-idn> --project <project-idn> \
 *       [--title <text>] [--description <text>] [--persona-id <id|null>] \
 *       [--customer <idn>] [--json]
 *
 * The PUT endpoint's partial-vs-full-replace semantics are unconfirmed, so this
 * follows update-project.ts's own safe default regardless: GET the current
 * agent, overlay only the requested fields, PUT the full merged object back —
 * untouched fields are never at risk of being reset.
 */
import { makeClient, listProjects, listAgents, updateAgent } from '../../api.js';
import { getValidAccessToken } from '../../auth.js';
import { requireSingleCustomer } from '../customer-selection.js';
import type { MultiCustomerConfig, CliArgs, Agent } from '../../types.js';

const USAGE = 'Usage: newo update-agent <agent-idn> --project <project-idn> [--title <text>] [--description <text>] [--persona-id <id|null>] [--customer <idn>] [--json]';

export async function handleUpdateAgentCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean = false
): Promise<void> {
  const agentIdn = args._[1] as string | undefined;
  const projectIdn = args.project as string | undefined;
  const titleFlag = args.title as string | undefined;
  const descriptionFlag = args.description as string | undefined;
  const personaIdFlag = args['persona-id'] as string | undefined;
  const asJson = Boolean(args.json);

  if (!agentIdn || !projectIdn) {
    console.error('Error: agent IDN and --project are required');
    console.error(USAGE);
    process.exit(1);
  }

  const personaIdOverride =
    personaIdFlag === undefined ? undefined : personaIdFlag.trim().toLowerCase() === 'null' ? null : personaIdFlag;

  const hasChange = titleFlag !== undefined || descriptionFlag !== undefined || personaIdOverride !== undefined;
  if (!hasChange) {
    console.error('Error: nothing to do — pass --title, --description, and/or --persona-id');
    console.error(USAGE);
    process.exit(1);
  }

  const selectedCustomer = requireSingleCustomer(customerConfig, args.customer as string | undefined);
  const token = await getValidAccessToken(selectedCustomer);
  const client = await makeClient(verbose, token);

  if (verbose) console.log(`🔍 Resolving project "${projectIdn}" for customer ${selectedCustomer.idn}...`);
  const projects = await listProjects(client);
  const project = projects.find(p => p.idn === projectIdn);
  if (!project) {
    console.error(`❌ Project "${projectIdn}" not found for customer ${selectedCustomer.idn}`);
    process.exit(1);
  }

  const agents = await listAgents(client, project.id);
  const agent = agents.find((a: Agent) => a.idn === agentIdn);
  if (!agent) {
    console.error(`❌ Agent "${agentIdn}" not found in project "${projectIdn}"`);
    console.error('');
    console.error('Available agents:');
    for (const a of agents) {
      console.error(`  • ${a.idn}`);
    }
    process.exit(1);
  }

  const body = {
    title: titleFlag !== undefined ? titleFlag : (agent.title ?? agent.idn),
    description: descriptionFlag !== undefined ? descriptionFlag : (agent.description ?? ''),
    persona_id: personaIdOverride !== undefined ? personaIdOverride : (agent.persona?.id ?? null)
  };

  try {
    await updateAgent(client, agent.id, body);

    const refreshed = await listAgents(client, project.id);
    const after = refreshed.find((a: Agent) => a.idn === agentIdn) ?? agent;

    if (asJson) {
      console.log(JSON.stringify({ idn: after.idn, title: after.title, description: after.description ?? null, persona_id: after.persona?.id ?? null }, null, 2));
      return;
    }

    console.log(`✅ Agent "${agentIdn}" updated`);
    console.log(`   title: ${before(agent.title, agent.idn)} → ${after.title ?? agent.idn}`);
    console.log(`   description: ${before(agent.description, 'n/a')} → ${after.description ?? 'n/a'}`);
    console.log(`   persona_id: ${before(agent.persona?.id, 'n/a')} → ${after.persona?.id ?? 'n/a'}`);
  } catch (error: any) {
    const status = error?.response?.status;
    const message = error?.response?.data?.message || error?.response?.data?.detail || error?.message || 'Unknown error';
    console.error(`❌ Failed to update agent "${agentIdn}"${status ? ` (HTTP ${status})` : ''}: ${message}`);
    process.exit(1);
  }
}

function before(value: string | null | undefined, fallback: string): string {
  return value ?? fallback;
}
