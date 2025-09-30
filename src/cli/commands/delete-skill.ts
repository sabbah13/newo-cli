/**
 * Delete Skill Command Handler - Removes local folder structure
 */
import { requireSingleCustomer } from '../customer-selection.js';
import {
  ensureState,
  skillFolderPath,
  projectDir
} from '../../fsutil.js';
import fs from 'fs-extra';
import type { MultiCustomerConfig, CliArgs } from '../../types.js';

export async function handleDeleteSkillCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean = false
): Promise<void> {
  try {
    const selectedCustomer = requireSingleCustomer(customerConfig, args.customer as string | undefined);

    // Parse arguments
    const skillIdn = args._[1] as string;
    const flowIdn = args.flow as string;
    const agentIdn = args.agent as string;
    const projectIdn = args.project as string;
    const confirm = args.confirm || args.y;

    if (!skillIdn) {
      console.error('Error: Skill IDN is required');
      console.error('Usage: newo delete-skill <skill-idn> --flow <flow-idn> --agent <agent-idn> --project <project-idn> [--confirm]');
      process.exit(1);
    }

    if (!flowIdn) {
      console.error('Error: Flow IDN is required');
      console.error('Usage: newo delete-skill <skill-idn> --flow <flow-idn> --agent <agent-idn> --project <project-idn> [--confirm]');
      process.exit(1);
    }

    if (!agentIdn) {
      console.error('Error: Agent IDN is required');
      console.error('Usage: newo delete-skill <skill-idn> --flow <flow-idn> --agent <agent-idn> --project <project-idn> [--confirm]');
      process.exit(1);
    }

    if (!projectIdn) {
      console.error('Error: Project IDN is required');
      console.error('Usage: newo delete-skill <skill-idn> --flow <flow-idn> --agent <agent-idn> --project <project-idn> [--confirm]');
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

    // Check if skill exists locally
    const skillDir = skillFolderPath(selectedCustomer.idn, projectIdn, agentIdn, flowIdn, skillIdn);
    if (!(await fs.pathExists(skillDir))) {
      console.error(`❌ Skill '${skillIdn}' not found in flow '${flowIdn}'. Check skill IDN.`);
      process.exit(1);
    }

    if (verbose) {
      console.log(`🗑️  Deleting skill locally: ${skillIdn}`);
      console.log(`   Project: ${projectIdn}`);
      console.log(`   Agent: ${agentIdn}`);
      console.log(`   Flow: ${flowIdn}`);
    }

    // Safety confirmation
    if (!confirm) {
      console.log('⚠️  This will permanently delete the skill locally.');
      console.log('⚠️  Use --confirm flag to proceed with deletion.');
      console.log('⚠️  Run "newo push" after deletion to remove from NEWO platform.');
      process.exit(1);
    }

    // Remove skill directory
    await fs.remove(skillDir);

    console.log(`✅ Skill deleted locally`);
    console.log(`   IDN: ${skillIdn}`);
    console.log(`   Path: ${skillDir}`);
    console.log(`   Run 'newo push' to delete from NEWO platform`);

  } catch (error: unknown) {
    console.error('❌ Failed to delete skill locally:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}