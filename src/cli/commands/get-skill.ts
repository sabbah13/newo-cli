/**
 * Get Skill Command Handler - Inspect a skill's live state on the platform
 *
 * Usage:
 *   newo get-skill <skill-idn> --project <idn> --agent <idn> --flow <idn> [--json]
 *
 * Shows the skill as it currently lives on the platform (model, runner_type,
 * parameters, prompt_script) without requiring a pulled local workspace.
 */
import { requireSingleCustomer } from '../customer-selection.js';
import { makeClient } from '../../api.js';
import { getValidAccessToken } from '../../auth.js';
import { resolveRemoteSkill } from '../../sync/remote-skill.js';
import type { MultiCustomerConfig, CliArgs } from '../../types.js';

const USAGE = 'Usage: newo get-skill <skill-idn> --project <project-idn> --agent <agent-idn> --flow <flow-idn> [--json] [--customer <idn>]';

export async function handleGetSkillCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean = false
): Promise<void> {
  const skillIdn = args._[1] as string | undefined;
  const projectIdn = args.project as string | undefined;
  const agentIdn = args.agent as string | undefined;
  const flowIdn = args.flow as string | undefined;
  const asJson = Boolean(args.json);

  if (!skillIdn || !projectIdn || !agentIdn || !flowIdn) {
    console.error('Error: skill IDN, --project, --agent and --flow are required');
    console.error(USAGE);
    process.exit(1);
  }

  const selectedCustomer = requireSingleCustomer(customerConfig, args.customer as string | undefined);

  if (asJson) {
    process.env.NEWO_QUIET_MODE = 'true'; // keep stdout machine-readable for piping
  }

  const token = await getValidAccessToken(selectedCustomer);
  const client = await makeClient(verbose, token);

  if (verbose) console.log(`🔍 Resolving skill ${projectIdn}/${agentIdn}/${flowIdn}/${skillIdn}...`);

  const { project, agent, flow, skill } = await resolveRemoteSkill(client, {
    projectIdn,
    agentIdn,
    flowIdn,
    skillIdn
  });

  if (asJson) {
    console.log(JSON.stringify({
      project_idn: project.idn,
      agent_idn: agent.idn,
      flow_idn: flow.idn,
      id: skill.id,
      idn: skill.idn,
      title: skill.title,
      runner_type: skill.runner_type,
      model: skill.model,
      parameters: skill.parameters,
      prompt_script: skill.prompt_script ?? null
    }, null, 2));
    return;
  }

  console.log(`📜 Skill: ${project.idn}/${agent.idn}/${flow.idn}/${skill.idn}`);
  console.log(`   ID: ${skill.id}`);
  console.log(`   Title: ${skill.title}`);
  console.log(`   Runner type: ${skill.runner_type}`);
  console.log(`   Model: ${skill.model.provider_idn}/${skill.model.model_idn}`);
  if (skill.parameters.length > 0) {
    console.log(`   Parameters:`);
    for (const param of skill.parameters) {
      console.log(`     ${param.name}${param.default_value !== undefined ? ` = ${JSON.stringify(param.default_value)}` : ''}`);
    }
  } else {
    console.log(`   Parameters: (none)`);
  }
  console.log(`\n--- prompt_script (${(skill.prompt_script || '').length} chars) ---`);
  console.log(skill.prompt_script || '(empty)');
}
