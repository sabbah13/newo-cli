/**
 * Update Project Command Handler - Set a customer project's displayed version
 * (and other registry-sync metadata) directly on the platform.
 *
 * Usage:
 *   newo update-project <project-idn> [--version <semver>] \
 *       [--force-update] \
 *       [--auto-update <true|false>] \
 *       [--registry-item-version <semver|null>] \
 *       [--title <text>] [--description <text>] \
 *       [--customer <idn>] [--json]
 *
 * --force-update fires the Builder's "Force Update Project" action
 * (POST .../by-id/{id}/force-update), re-syncing the project's content from its
 * registry. It runs BEFORE the version PATCH, so an explicit --version still wins
 * the displayed label. At least one of --version (/other fields) or --force-update
 * must be passed.
 *
 * The displayed project `version` in the Builder is governed by the `version`
 * field on the project object, NOT by content push (`newo push` never writes it)
 * and NOT by `registry_item_version`. This command sets it via a full-object
 * PATCH to `/api/v1/designer/projects/by-id/{id}`.
 *
 * IMPORTANT: that PATCH is NOT a true partial — omitting a field resets it to a
 * default (an empty body flips is_auto_update_enabled to false). So we GET the
 * current meta, overlay only the requested changes, and PATCH the full object
 * back — exactly what the Builder's "Manage → update to <version>" does.
 */
import type { AxiosInstance } from 'axios';
import { makeClient, getProjectMeta, listProjects, updateProject, forceUpdateProject, listRegistryItems, listRegistries } from '../../api.js';
import { getValidAccessToken } from '../../auth.js';
import { requireSingleCustomer } from '../customer-selection.js';
import type { MultiCustomerConfig, CliArgs, ProjectMeta, Registry, RegistryItem } from '../../types.js';

const USAGE = 'Usage: newo update-project <project-idn> [--version <semver>] [--force-update] [--auto-update <true|false>] [--registry-item-version <semver|null>] [--title <text>] [--description <text>] [--customer <idn>] [--json]';

/** The full mutable field set the PATCH endpoint accepts. */
export interface ProjectUpdateBody {
  idn: string;
  title: string;
  description: string | null;
  version: string | null;
  is_auto_update_enabled: boolean;
  registry_idn: string;
  registry_item_idn: string | null;
  registry_item_version: string | null;
}

/** Overrides the caller wants applied on top of the current project meta. */
export interface ProjectUpdateOverrides {
  version?: string;
  is_auto_update_enabled?: boolean;
  registry_item_version?: string | null;
  title?: string;
  description?: string | null;
}

/**
 * Pure merge: take the current project meta and overlay the requested changes,
 * producing the FULL body the PATCH endpoint requires. Untouched fields are
 * carried over verbatim so the PATCH does not reset them to defaults.
 */
export function buildProjectUpdateBody(meta: ProjectMeta, overrides: ProjectUpdateOverrides): ProjectUpdateBody {
  return {
    idn: meta.idn,
    title: overrides.title !== undefined ? overrides.title : meta.title,
    description: overrides.description !== undefined ? overrides.description : (meta.description ?? null),
    version: overrides.version !== undefined ? overrides.version : (meta.version ?? null),
    is_auto_update_enabled:
      overrides.is_auto_update_enabled !== undefined
        ? overrides.is_auto_update_enabled
        : (meta.is_auto_update_enabled ?? false),
    registry_idn: meta.registry_idn ?? '',
    registry_item_idn: meta.registry_item_idn ?? null,
    registry_item_version:
      overrides.registry_item_version !== undefined
        ? overrides.registry_item_version
        : (meta.registry_item_version ?? null)
  };
}

/**
 * GET the current project meta, overlay the overrides, PATCH the full object,
 * then re-GET and return the effective meta. Single PATCH call → never partial.
 */
export async function applyProjectUpdate(
  client: AxiosInstance,
  projectId: string,
  overrides: ProjectUpdateOverrides
): Promise<{ before: ProjectMeta; body: ProjectUpdateBody; after: ProjectMeta }> {
  const before = await getProjectMeta(client, projectId);
  const body = buildProjectUpdateBody(before, overrides);
  await updateProject(client, projectId, body);
  const after = await getProjectMeta(client, projectId);
  return { before, body, after };
}

/** Parse a tri-state boolean flag: undefined = unset, else true/false. */
function parseBooleanFlag(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  const s = String(value).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  return undefined;
}

export async function handleUpdateProjectCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean = false
): Promise<void> {
  const projectIdn = args._[1] as string | undefined;
  const versionFlag = args.version as string | undefined;
  const autoUpdateFlag = parseBooleanFlag(args['auto-update']);
  const titleFlag = args.title as string | undefined;
  const descriptionFlag = args.description as string | undefined;
  const forceUpdate = Boolean(args['force-update']);
  const asJson = Boolean(args.json);

  // registry-item-version: literal "null" → null
  let registryItemVersionOverride: string | null | undefined;
  if (args['registry-item-version'] !== undefined) {
    const raw = String(args['registry-item-version']).trim();
    registryItemVersionOverride = raw.toLowerCase() === 'null' || raw === '' ? null : raw;
  }

  if (!projectIdn) {
    console.error('Error: project IDN is required');
    console.error(USAGE);
    process.exit(1);
  }

  const version = versionFlag !== undefined ? String(versionFlag).trim() : undefined;

  // A metadata PATCH is needed when any of these are set; --force-update is a
  // separate platform action that can run with or without a PATCH.
  const hasMetaChange =
    version !== undefined ||
    autoUpdateFlag !== undefined ||
    registryItemVersionOverride !== undefined ||
    titleFlag !== undefined ||
    descriptionFlag !== undefined;

  if (!hasMetaChange && !forceUpdate) {
    console.error('Error: nothing to do — pass --version (and/or other fields) and/or --force-update');
    console.error(USAGE);
    process.exit(1);
  }

  const selectedCustomer = requireSingleCustomer(customerConfig, args.customer as string | undefined);

  const token = await getValidAccessToken(selectedCustomer);
  const client = await makeClient(verbose, token);

  // Resolve project IDN → id
  if (verbose) console.log(`🔍 Resolving project "${projectIdn}" for customer ${selectedCustomer.idn}...`);
  const projects = await listProjects(client);
  const project = projects.find((p: ProjectMeta) => p.idn === projectIdn);
  if (!project) {
    console.error(`❌ Project "${projectIdn}" not found for customer ${selectedCustomer.idn}`);
    console.error('');
    console.error('Available projects:');
    for (const p of projects) {
      console.error(`  • ${p.idn} (version ${p.version ?? 'n/a'})`);
    }
    process.exit(1);
  }

  // Optional, non-fatal: warn if the version isn't a published registry version.
  if (version !== undefined && project.registry_idn && project.registry_item_idn) {
    try {
      const registries = await listRegistries(client);
      const registry = registries.find((r: Registry) => r.idn === project.registry_idn);
      if (registry) {
        const items = await listRegistryItems(client, registry.id);
        const published = items
          .filter((i: RegistryItem) => i.idn === project.registry_item_idn)
          .map((i: RegistryItem) => i.version);
        if (published.length > 0 && !published.includes(version)) {
          console.warn(`⚠️  Version "${version}" is not a published version of ${project.registry_idn}/${project.registry_item_idn}.`);
          console.warn(`   Proceeding anyway (you may be setting a working-copy version).`);
        }
      }
    } catch (error: unknown) {
      if (verbose) console.warn(`   (registry validation skipped: ${error instanceof Error ? error.message : String(error)})`);
    }
  }

  const overrides: ProjectUpdateOverrides = {
    ...(version !== undefined ? { version } : {}),
    ...(autoUpdateFlag !== undefined ? { is_auto_update_enabled: autoUpdateFlag } : {}),
    ...(registryItemVersionOverride !== undefined ? { registry_item_version: registryItemVersionOverride } : {}),
    ...(titleFlag !== undefined ? { title: String(titleFlag) } : {}),
    ...(descriptionFlag !== undefined ? { description: String(descriptionFlag) } : {})
  };

  try {
    const before = await getProjectMeta(client, project.id);

    // Force-update first: it re-syncs content from the registry (and may move the
    // version), so an explicit --version PATCH afterwards still wins on the label.
    if (forceUpdate) {
      if (!asJson) console.log(`🔄 Force-updating "${project.idn}" from registry...`);
      await forceUpdateProject(client, project.id);
    }

    if (hasMetaChange) {
      await applyProjectUpdate(client, project.id, overrides);
    }

    const after = await getProjectMeta(client, project.id);

    const effective = {
      idn: after.idn,
      version: after.version ?? null,
      registry_item_version: after.registry_item_version ?? null,
      is_auto_update_enabled: after.is_auto_update_enabled ?? false
    };

    if (asJson) {
      console.log(JSON.stringify({ ...effective, force_updated: forceUpdate }, null, 2));
      return;
    }

    console.log(`✅ Project "${after.idn}" updated`);
    if (forceUpdate) console.log(`   force-update: sent`);
    console.log(`   version: ${before.version ?? 'n/a'} → ${effective.version ?? 'n/a'}`);
    console.log(`   registry_item_version: ${effective.registry_item_version ?? 'null'}`);
    console.log(`   is_auto_update_enabled: ${effective.is_auto_update_enabled}`);
  } catch (error: any) {
    const status = error?.response?.status;
    const message = error?.response?.data?.message || error?.response?.data?.detail || error?.message || 'Unknown error';
    console.error(`❌ Failed to update project "${projectIdn}"${status ? ` (HTTP ${status})` : ''}: ${message}`);
    process.exit(1);
  }
}
