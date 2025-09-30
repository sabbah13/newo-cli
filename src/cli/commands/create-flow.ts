/**
 * Create Flow Command Handler - Creates local folder structure
 */
import { requireSingleCustomer } from '../customer-selection.js';
import {
  ensureState,
  flowMetadataPath,
  writeFileSafe,
  projectDir
} from '../../fsutil.js';
import fs from 'fs-extra';
import yaml from 'js-yaml';
import type { MultiCustomerConfig, CliArgs, FlowMetadata, RunnerType, ModelConfig } from '../../types.js';

export async function handleCreateFlowCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean = false
): Promise<void> {
  try {
    const selectedCustomer = requireSingleCustomer(customerConfig, args.customer as string | undefined);

    // Parse arguments
    const idn = args._[1] as string;
    const agentIdn = args.agent as string;
    const projectIdn = args.project as string;
    const title = args.title as string || idn;
    const description = args.description as string || '';
    const defaultRunnerType = (args.runner || 'guidance') as RunnerType;
    const providerIdn = args.provider as string || 'openai';
    const modelIdn = args.model as string || 'gpt4o';

    if (!idn) {
      console.error('Error: Flow IDN is required');
      console.error('Usage: newo create-flow <idn> --agent <agent-idn> --project <project-idn> [--title <title>] [--description <description>] [--runner <guidance|nsl>] [--provider <provider>] [--model <model>]');
      process.exit(1);
    }

    if (!agentIdn) {
      console.error('Error: Agent IDN is required');
      console.error('Usage: newo create-flow <idn> --agent <agent-idn> --project <project-idn> [--title <title>] [--description <description>] [--runner <guidance|nsl>] [--provider <provider>] [--model <model>]');
      process.exit(1);
    }

    if (!projectIdn) {
      console.error('Error: Project IDN is required');
      console.error('Usage: newo create-flow <idn> --agent <agent-idn> --project <project-idn> [--title <title>] [--description <description>] [--runner <guidance|nsl>] [--provider <provider>] [--model <model>]');
      process.exit(1);
    }

    if (!['guidance', 'nsl'].includes(defaultRunnerType)) {
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

    // Check if flow already exists
    const flowDir = `${agentDir}/${idn}`;
    if (await fs.pathExists(flowDir)) {
      console.error(`❌ Flow '${idn}' already exists in agent '${agentIdn}'`);
      process.exit(1);
    }

    if (verbose) {
      console.log(`📝 Creating flow locally: ${idn}`);
      console.log(`   Project: ${projectIdn}`);
      console.log(`   Agent: ${agentIdn}`);
      console.log(`   Title: ${title}`);
      console.log(`   Description: ${description}`);
      console.log(`   Default Runner: ${defaultRunnerType}`);
    }

    // Create flow directory
    await fs.ensureDir(flowDir);

    // Create flow metadata
    const flowMetadata: FlowMetadata = {
      id: '', // Will be set during push
      idn,
      title,
      description,
      default_runner_type: defaultRunnerType,
      default_model: {
        provider_idn: providerIdn,
        model_idn: modelIdn
      } as ModelConfig,
      events: [], // Will be populated if needed
      state_fields: [], // Will be populated if needed
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Save flow metadata
    const metadataPath = flowMetadataPath(selectedCustomer.idn, projectIdn, agentIdn, idn);
    const metadataYaml = yaml.dump(flowMetadata, { indent: 2, quotingType: '"', forceQuotes: false });
    await writeFileSafe(metadataPath, metadataYaml);

    console.log(`✅ Flow created locally`);
    console.log(`   IDN: ${idn}`);
    console.log(`   Title: ${title}`);
    console.log(`   Path: ${flowDir}`);
    console.log(`   Run 'newo push' to create on NEWO platform`);

  } catch (error: unknown) {
    console.error('❌ Failed to create flow locally:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}