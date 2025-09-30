/**
 * Create Agent Command Handler - Creates local folder structure
 */
import { requireSingleCustomer } from '../customer-selection.js';
import {
  ensureState,
  agentMetadataPath,
  writeFileSafe,
  projectDir
} from '../../fsutil.js';
import fs from 'fs-extra';
import yaml from 'js-yaml';
import type { MultiCustomerConfig, CliArgs, AgentMetadata } from '../../types.js';

export async function handleCreateAgentCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean = false
): Promise<void> {
  try {
    const selectedCustomer = requireSingleCustomer(customerConfig, args.customer as string | undefined);

    // Parse arguments
    const idn = args._[1] as string;
    const title = args.title as string || idn;
    const description = args.description as string || '';
    const projectIdn = args.project as string;
    const personaId = args['persona-id'] as string;

    if (!idn) {
      console.error('Error: Agent IDN is required');
      console.error('Usage: newo create-agent <idn> --project <project-idn> [--title <title>] [--description <description>] [--persona-id <persona-id>]');
      process.exit(1);
    }

    if (!projectIdn) {
      console.error('Error: Project IDN is required');
      console.error('Usage: newo create-agent <idn> --project <project-idn> [--title <title>] [--description <description>] [--persona-id <persona-id>]');
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

    // Check if agent already exists
    const agentDir = `${projDir}/${idn}`;
    if (await fs.pathExists(agentDir)) {
      console.error(`❌ Agent '${idn}' already exists in project '${projectIdn}'`);
      process.exit(1);
    }

    if (verbose) {
      console.log(`📝 Creating agent locally: ${idn}`);
      console.log(`   Project: ${projectIdn}`);
      console.log(`   Title: ${title}`);
      console.log(`   Description: ${description}`);
      console.log(`   Persona ID: ${personaId || 'none'}`);
    }

    // Create agent directory
    await fs.ensureDir(agentDir);

    // Create agent metadata
    const agentMetadata: AgentMetadata = {
      id: '', // Will be set during push
      idn,
      title,
      description,
      persona_id: personaId || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Save agent metadata
    const metadataPath = agentMetadataPath(selectedCustomer.idn, projectIdn, idn);
    const metadataYaml = yaml.dump(agentMetadata, { indent: 2, quotingType: '"', forceQuotes: false });
    await writeFileSafe(metadataPath, metadataYaml);

    console.log(`✅ Agent created locally`);
    console.log(`   IDN: ${idn}`);
    console.log(`   Title: ${title}`);
    console.log(`   Path: ${agentDir}`);
    console.log(`   Run 'newo push' to create on NEWO platform`);

  } catch (error: unknown) {
    console.error('❌ Failed to create agent locally:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}