/**
 * Delete Agent Command Handler - Removes local folder structure
 */
import { requireSingleCustomer } from '../customer-selection.js';
import {
  ensureState,
  projectDir
} from '../../fsutil.js';
import fs from 'fs-extra';
import type { MultiCustomerConfig, CliArgs } from '../../types.js';

export async function handleDeleteAgentCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean = false
): Promise<void> {
  try {
    const selectedCustomer = requireSingleCustomer(customerConfig, args.customer as string | undefined);

    // Parse arguments
    const agentIdn = args._[1] as string;
    const projectIdn = args.project as string;
    const confirm = args.confirm || args.y;

    if (!agentIdn) {
      console.error('Error: Agent IDN is required');
      console.error('Usage: newo delete-agent <agent-idn> --project <project-idn> [--confirm]');
      process.exit(1);
    }

    if (!projectIdn) {
      console.error('Error: Project IDN is required');
      console.error('Usage: newo delete-agent <agent-idn> --project <project-idn> [--confirm]');
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
      console.error(`❌ Agent '${agentIdn}' not found in project '${projectIdn}'. Check agent IDN.`);
      process.exit(1);
    }

    if (verbose) {
      console.log(`🗑️  Deleting agent locally: ${agentIdn}`);
      console.log(`   Project: ${projectIdn}`);
    }

    // Safety confirmation
    if (!confirm) {
      console.log('⚠️  This will permanently delete the agent and all its flows and skills locally.');
      console.log('⚠️  Use --confirm flag to proceed with deletion.');
      console.log('⚠️  This removes the local mirror only — newo push does not sync agent deletions to the platform yet.');
      process.exit(1);
    }

    // Check if agent has flows
    const flowDirs = await fs.readdir(agentDir);
    const flowCount = flowDirs.filter(async (item) => {
      const itemPath = `${agentDir}/${item}`;
      return (await fs.stat(itemPath)).isDirectory() && item !== 'metadata.yaml';
    }).length;

    if (flowCount > 0) {
      console.log(`⚠️  Agent contains ${flowCount} flows that will also be deleted.`);
    }

    // Remove agent directory
    await fs.remove(agentDir);

    console.log(`✅ Agent deleted locally`);
    console.log(`   IDN: ${agentIdn}`);
    console.log(`   Path: ${agentDir}`);
    console.log(`   Local mirror only — this agent still exists on the NEWO platform (newo push does not sync agent deletions yet)`);

  } catch (error: unknown) {
    console.error('❌ Failed to delete agent locally:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}