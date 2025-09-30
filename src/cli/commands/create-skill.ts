/**
 * Create Skill Command Handler - Creates local folder structure
 */
import { requireSingleCustomer } from '../customer-selection.js';
import {
  ensureState,
  skillMetadataPath,
  skillScriptPath,
  skillFolderPath,
  writeFileSafe,
  projectDir
} from '../../fsutil.js';
import fs from 'fs-extra';
import yaml from 'js-yaml';
import type { MultiCustomerConfig, CliArgs, SkillMetadata, RunnerType, ModelConfig } from '../../types.js';

export async function handleCreateSkillCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean = false
): Promise<void> {
  try {
    const selectedCustomer = requireSingleCustomer(customerConfig, args.customer as string | undefined);

    // Parse arguments
    const idn = args._[1] as string;
    const flowIdn = args.flow as string;
    const agentIdn = args.agent as string;
    const projectIdn = args.project as string;
    const title = args.title as string || idn;
    const promptScript = args.script as string || '# Add your skill logic here';
    const runnerType = (args.runner || 'guidance') as RunnerType;
    const providerIdn = args.provider as string || 'openai';
    const modelIdn = args.model as string || 'gpt4o';

    if (!idn) {
      console.error('Error: Skill IDN is required');
      console.error('Usage: newo create-skill <idn> --flow <flow-idn> --agent <agent-idn> --project <project-idn> [--title <title>] [--script <script>] [--runner <guidance|nsl>] [--provider <provider>] [--model <model>]');
      process.exit(1);
    }

    if (!flowIdn) {
      console.error('Error: Flow IDN is required');
      console.error('Usage: newo create-skill <idn> --flow <flow-idn> --agent <agent-idn> --project <project-idn> [--title <title>] [--script <script>] [--runner <guidance|nsl>] [--provider <provider>] [--model <model>]');
      process.exit(1);
    }

    if (!agentIdn) {
      console.error('Error: Agent IDN is required');
      console.error('Usage: newo create-skill <idn> --flow <flow-idn> --agent <agent-idn> --project <project-idn> [--title <title>] [--script <script>] [--runner <guidance|nsl>] [--provider <provider>] [--model <model>]');
      process.exit(1);
    }

    if (!projectIdn) {
      console.error('Error: Project IDN is required');
      console.error('Usage: newo create-skill <idn> --flow <flow-idn> --agent <agent-idn> --project <project-idn> [--title <title>] [--script <script>] [--runner <guidance|nsl>] [--provider <provider>] [--model <model>]');
      process.exit(1);
    }

    if (!['guidance', 'nsl'].includes(runnerType)) {
      console.error('Error: Runner type must be "guidance" or "nsl"');
      process.exit(1);
    }

    // Ensure state directory exists
    await ensureState(selectedCustomer.idn);

    // Check if project exists locally
    const projDir = projectDir(selectedCustomer.idn, projectIdn);
    if (!(await fs.pathExists(projDir))) {
      console.error(`❌ Project '${projectIdn}' not found locally. Run 'newo pull' first or check project IDN.`);
      process.exit(1);
    }

    // Check if agent exists locally
    const agentDir = `${projDir}/${agentIdn}`;
    if (!(await fs.pathExists(agentDir))) {
      console.error(`❌ Agent '${agentIdn}' not found in project '${projectIdn}'. Create agent first or check agent IDN.`);
      process.exit(1);
    }

    // Check if flow exists locally
    const flowDir = `${agentDir}/${flowIdn}`;
    if (!(await fs.pathExists(flowDir))) {
      console.error(`❌ Flow '${flowIdn}' not found in agent '${agentIdn}'. Create flow first or check flow IDN.`);
      process.exit(1);
    }

    // Check if skill already exists
    const skillDir = skillFolderPath(selectedCustomer.idn, projectIdn, agentIdn, flowIdn, idn);
    if (await fs.pathExists(skillDir)) {
      console.error(`❌ Skill '${idn}' already exists in flow '${flowIdn}'`);
      process.exit(1);
    }

    if (verbose) {
      console.log(`📝 Creating skill locally: ${idn}`);
      console.log(`   Project: ${projectIdn}`);
      console.log(`   Agent: ${agentIdn}`);
      console.log(`   Flow: ${flowIdn}`);
      console.log(`   Title: ${title}`);
      console.log(`   Runner Type: ${runnerType}`);
    }

    // Create skill directory
    await fs.ensureDir(skillDir);

    // Create skill script file
    const scriptPath = skillScriptPath(selectedCustomer.idn, projectIdn, agentIdn, flowIdn, idn, runnerType);
    await writeFileSafe(scriptPath, promptScript);

    // Create skill metadata
    const skillMetadata: SkillMetadata = {
      id: '', // Will be set during push
      idn,
      title,
      runner_type: runnerType,
      model: {
        provider_idn: providerIdn,
        model_idn: modelIdn
      } as ModelConfig,
      parameters: [],
      path: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Save skill metadata
    const metadataPath = skillMetadataPath(selectedCustomer.idn, projectIdn, agentIdn, flowIdn, idn);
    const metadataYaml = yaml.dump(skillMetadata, { indent: 2, quotingType: '"', forceQuotes: false });
    await writeFileSafe(metadataPath, metadataYaml);

    console.log(`✅ Skill created locally`);
    console.log(`   IDN: ${idn}`);
    console.log(`   Title: ${title}`);
    console.log(`   Path: ${skillDir}`);
    console.log(`   Script: ${scriptPath}`);
    console.log(`   Run 'newo push' to create on NEWO platform`);

  } catch (error: unknown) {
    console.error('❌ Failed to create skill locally:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}