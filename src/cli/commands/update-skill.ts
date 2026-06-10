/**
 * Update Skill Command Handler - Point edit of a skill directly on the platform
 *
 * Usage:
 *   newo update-skill <skill-idn> --project <idn> --agent <idn> --flow <idn> \
 *       [--model <provider_idn>/<model_idn>] \
 *       [--script <file.nsl|file.guidance>] \
 *       [--publish] [--publish-description "<text>"]
 *
 * Unlike `newo push`, this changes exactly one skill without requiring a
 * pulled workspace and without touching any other modified files. Typical
 * use: temporarily switching a skill's model for an A/B test run.
 */
import fs from 'fs-extra';
import { requireSingleCustomer } from '../customer-selection.js';
import { makeClient, updateSkill, publishFlow } from '../../api.js';
import { getValidAccessToken } from '../../auth.js';
import { resolveRemoteSkill, parseModelFlag } from '../../sync/remote-skill.js';
import { projectDir } from '../../fsutil.js';
import type { MultiCustomerConfig, CliArgs, Skill, PublishFlowRequest } from '../../types.js';

const USAGE = 'Usage: newo update-skill <skill-idn> --project <project-idn> --agent <agent-idn> --flow <flow-idn> [--model <provider>/<model>] [--script <file>] [--publish] [--publish-description "<text>"] [--customer <idn>]';

export async function handleUpdateSkillCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean = false
): Promise<void> {
  const skillIdn = args._[1] as string | undefined;
  const projectIdn = args.project as string | undefined;
  const agentIdn = args.agent as string | undefined;
  const flowIdn = args.flow as string | undefined;
  const modelFlag = args.model as string | undefined;
  const scriptFlag = args.script as string | undefined;
  const shouldPublish = Boolean(args.publish);
  const publishDescription = args['publish-description'] as string | undefined;

  if (!skillIdn || !projectIdn || !agentIdn || !flowIdn) {
    console.error('Error: skill IDN, --project, --agent and --flow are required');
    console.error(USAGE);
    process.exit(1);
  }

  if (!modelFlag && !scriptFlag) {
    console.error('Error: nothing to update — pass --model and/or --script');
    console.error(USAGE);
    process.exit(1);
  }

  const newModel = modelFlag ? parseModelFlag(String(modelFlag)) : null;

  let newScript: string | null = null;
  if (scriptFlag) {
    const scriptPath = String(scriptFlag);
    if (!(await fs.pathExists(scriptPath))) {
      console.error(`Error: script file not found: ${scriptPath}`);
      process.exit(1);
    }
    newScript = await fs.readFile(scriptPath, 'utf8');
  }

  const selectedCustomer = requireSingleCustomer(customerConfig, args.customer as string | undefined);

  const token = await getValidAccessToken(selectedCustomer);
  const client = await makeClient(verbose, token);

  if (verbose) console.log(`🔍 Resolving skill ${projectIdn}/${agentIdn}/${flowIdn}/${skillIdn}...`);

  const { project, agent, flow, skill } = await resolveRemoteSkill(client, {
    projectIdn,
    agentIdn,
    flowIdn,
    skillIdn
  });

  // Build updated skill object, preserving everything we don't change
  const updatedSkill: Skill = {
    ...skill,
    ...(newModel ? { model: newModel } : {}),
    ...(newScript !== null ? { prompt_script: newScript } : {})
  };

  console.log(`✏️  Updating skill: ${project.idn}/${agent.idn}/${flow.idn}/${skill.idn} (${skill.id})`);
  if (newModel) {
    console.log(`   Model: ${skill.model.provider_idn}/${skill.model.model_idn} → ${newModel.provider_idn}/${newModel.model_idn}`);
  }
  if (newScript !== null) {
    console.log(`   Script: ${(skill.prompt_script || '').length} chars → ${newScript.length} chars (from ${scriptFlag})`);
  }

  await updateSkill(client, updatedSkill);
  console.log('✅ Skill updated (draft)');

  // Warn when a pulled local workspace exists: it now diverges from the platform
  const localProjectDir = projectDir(selectedCustomer.idn, project.idn);
  if (await fs.pathExists(localProjectDir)) {
    console.warn(`⚠️  Local workspace exists at ${localProjectDir} and now differs from the platform.`);
    console.warn(`   Run 'newo pull' to sync it, or remember to revert this change.`);
  }

  if (shouldPublish) {
    const publishData: PublishFlowRequest = {
      version: '1.0',
      description: publishDescription || 'Published via NEWO CLI (update-skill)',
      type: 'public'
    };

    try {
      await publishFlow(client, flow.id, publishData);
      console.log(`🚀 Flow published: ${flow.idn}`);
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message || 'Unknown error';
      console.error(`❌ Failed to publish flow '${flow.idn}': ${errorMessage}`);
      const errorDetails = error.response?.data?.reasons || error.response?.data?.errors || error.response?.data?.detail;
      if (errorDetails) {
        console.error(`   Details: ${JSON.stringify(errorDetails)}`);
      }
      process.exit(1);
    }
  } else {
    console.log(`💡 Changes are draft-only. Add --publish to publish flow '${flow.idn}'.`);
  }
}
