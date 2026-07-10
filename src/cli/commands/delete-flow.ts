/**
 * Delete Flow Command Handler - Removes local folder structure
 */
import { requireSingleCustomer } from '../customer-selection.js';
import {
  ensureState,
  projectDir
} from '../../fsutil.js';
import fs from 'fs-extra';
import type { MultiCustomerConfig, CliArgs } from '../../types.js';

export async function handleDeleteFlowCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean = false
): Promise<void> {
  try {
    const selectedCustomer = requireSingleCustomer(customerConfig, args.customer as string | undefined);

    // Parse arguments
    const flowIdn = args._[1] as string;
    const agentIdn = args.agent as string;
    const projectIdn = args.project as string;
    const confirm = args.confirm || args.y;

    if (!flowIdn) {
      console.error('Error: Flow IDN is required');
      console.error('Usage: newo delete-flow <flow-idn> --agent <agent-idn> --project <project-idn> [--confirm]');
      process.exit(1);
    }

    if (!agentIdn) {
      console.error('Error: Agent IDN is required');
      console.error('Usage: newo delete-flow <flow-idn> --agent <agent-idn> --project <project-idn> [--confirm]');
      process.exit(1);
    }

    if (!projectIdn) {
      console.error('Error: Project IDN is required');
      console.error('Usage: newo delete-flow <flow-idn> --agent <agent-idn> --project <project-idn> [--confirm]');
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

    // Check if flow exists locally
    const flowDir = `${agentDir}/${flowIdn}`;
    if (!(await fs.pathExists(flowDir))) {
      console.error(`❌ Flow '${flowIdn}' not found in agent '${agentIdn}'. Check flow IDN.`);
      process.exit(1);
    }

    if (verbose) {
      console.log(`🗑️  Deleting flow locally: ${flowIdn}`);
      console.log(`   Project: ${projectIdn}`);
      console.log(`   Agent: ${agentIdn}`);
    }

    // Safety confirmation
    if (!confirm) {
      console.log('⚠️  This will permanently delete the flow and all its skills locally.');
      console.log('⚠️  Use --confirm flag to proceed with deletion.');
      console.log('⚠️  This removes the local mirror only — newo push does not sync flow deletions to the platform yet.');
      process.exit(1);
    }

    // Check if flow has skills
    const skillDirs = await fs.readdir(flowDir);
    const skillCount = skillDirs.filter(async (item) => {
      const itemPath = `${flowDir}/${item}`;
      return (await fs.stat(itemPath)).isDirectory() && item !== 'metadata.yaml';
    }).length;

    if (skillCount > 0) {
      console.log(`⚠️  Flow contains ${skillCount} skills that will also be deleted.`);
    }

    // Remove flow directory
    await fs.remove(flowDir);

    console.log(`✅ Flow deleted locally`);
    console.log(`   IDN: ${flowIdn}`);
    console.log(`   Path: ${flowDir}`);
    console.log(`   Local mirror only — this flow still exists on the NEWO platform (newo push does not sync flow deletions yet)`);

  } catch (error: unknown) {
    console.error('❌ Failed to delete flow locally:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}