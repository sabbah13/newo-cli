/**
 * Meta command handler - get project metadata
 */
import { makeClient, getProjectMeta, listProjects } from '../../api.js';
import { getValidAccessToken } from '../../auth.js';
import { requireSingleCustomer } from '../customer-selection.js';
import type { MultiCustomerConfig, CliArgs, ProjectMeta } from '../../types.js';

export type MetaProjectChoice =
  | { kind: 'use'; projectId: string }
  | { kind: 'list'; projects: ProjectMeta[] }
  | { kind: 'none' };

/**
 * Decide which project's metadata to show.
 *
 * A missing configured project ID is NOT an error: if the customer has
 * exactly one project we use it, otherwise we surface the candidates. This keeps
 * `newo meta` exit 0 for scripts that previously saw a spurious exit(1).
 */
export function pickMetaProject(
  configuredProjectId: string | undefined,
  projects: readonly ProjectMeta[]
): MetaProjectChoice {
  if (configuredProjectId) return { kind: 'use', projectId: configuredProjectId };
  if (projects.length === 1 && projects[0]) return { kind: 'use', projectId: projects[0].id };
  if (projects.length === 0) return { kind: 'none' };
  return { kind: 'list', projects: [...projects] };
}

export async function handleMetaCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean
): Promise<void> {
  const selectedCustomer = requireSingleCustomer(customerConfig, args.customer as string | undefined);

  const accessToken = await getValidAccessToken(selectedCustomer);
  const client = await makeClient(verbose, accessToken);

  let projectId = selectedCustomer.projectId;

  if (!projectId) {
    // Resolve from the platform instead of exiting 1.
    const choice = pickMetaProject(undefined, await listProjects(client));
    if (choice.kind === 'use') {
      projectId = choice.projectId;
    } else if (choice.kind === 'list') {
      console.error(
        `No project ID configured for customer ${selectedCustomer.idn}; ${choice.projects.length} projects available.`
      );
      console.error(`Set NEWO_CUSTOMER_${selectedCustomer.idn.toUpperCase()}_PROJECT_ID to one of:`);
      for (const p of choice.projects) console.error(`  ${p.id}  ${p.idn}`);
      return; // exit 0 — a config hint, not a failure
    } else {
      console.error(`No projects found for customer ${selectedCustomer.idn}.`);
      return; // exit 0 — nothing to show, but the command itself succeeded
    }
  }

  const meta = await getProjectMeta(client, projectId);
  console.log(JSON.stringify(meta, null, 2));
}
