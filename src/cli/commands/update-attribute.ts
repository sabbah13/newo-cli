/**
 * Update Attribute Command Handler - Point edit of a single attribute directly
 * on the platform.
 *
 * Usage:
 *   newo update-attribute <idn> [--value <value>] [--file <path>] \
 *       [--title <text>] [--description <text>] [--group <text>] \
 *       [--hidden] [--value-type <type>] [--possible-values <v1,v2>] \
 *       [--project <project-idn>] [--customer <idn>] [--json]
 *
 * Without --project this targets a CUSTOMER attribute
 * (PUT /api/v1/customer/attributes/{id}); with --project it targets a PROJECT
 * attribute (PUT /api/v1/designer/projects/{projectId}/attributes/{id}).
 *
 * IMPORTANT — metadata preservation: the platform PUT expects the FULL attribute
 * object, not just the changed field. Omitting a field resets it to a default
 * (this is how the Builder UI itself sends the request — see the reference
 * curl, which includes is_read_only, possible_values, value_type, etc.). So we
 * GET the current attribute, overlay only the flags the caller passed, and PUT
 * the whole object back. This is why we round-trip the RAW attribute (every
 * field the platform returned, including is_read_only) instead of projecting to
 * a fixed subset — the old implementation dropped is_read_only, silently
 * resetting it on every edit.
 *
 * JSON-typed values (value_type: json) are normalized to a canvas-safe compact
 * STRING via normalizeJsonValueForStorage so a value edit cannot blank out the
 * Workflow Builder. See src/sync/json-attr-utils.ts.
 */
import fs from 'fs-extra';
import { requireSingleCustomer } from '../customer-selection.js';
import {
  makeClient,
  getCustomerAttributes,
  getProjectAttributes,
  listProjects,
  putCustomerAttributeRaw,
  putProjectAttributeRaw
} from '../../api.js';
import { getValidAccessToken } from '../../auth.js';
import { isJsonValueType, normalizeJsonValueForStorage } from '../../sync/json-attr-utils.js';
import type { MultiCustomerConfig, CliArgs, CustomerAttribute, ProjectMeta } from '../../types.js';

const USAGE =
  'Usage: newo update-attribute <idn> [--value <value>] [--file <path>] [--title <text>] [--description <text>] [--group <text>] [--hidden] [--value-type <type>] [--possible-values <v1,v2>] [--project <project-idn>] [--customer <idn>] [--json]';

/** Fields the caller may override on top of the current attribute. */
export interface AttributeUpdateOverrides {
  value?: string;
  title?: string;
  description?: string;
  group?: string;
  is_hidden?: boolean;
  value_type?: string;
  possible_values?: string[];
}

/**
 * Pure merge: take the current attribute (as returned by the platform, with
 * every field it carries) and overlay the requested changes, producing the FULL
 * body the PUT endpoint requires. The `id` is dropped — it lives in the URL, not
 * the body (matching the Builder's request shape). JSON-typed values are
 * normalized to a canvas-safe compact STRING.
 *
 * value_type is resolved from the override first, then the current attribute, so
 * changing the type and the value in the same call normalizes against the NEW
 * type.
 */
export function buildAttributeUpdateBody(
  current: Record<string, unknown>,
  overrides: AttributeUpdateOverrides
): Record<string, unknown> {
  const { id: _id, ...rest } = current as Record<string, unknown> & { id?: string };
  const body: Record<string, unknown> = { ...rest };

  if (overrides.title !== undefined) body.title = overrides.title;
  if (overrides.description !== undefined) body.description = overrides.description;
  if (overrides.group !== undefined) body.group = overrides.group;
  if (overrides.is_hidden !== undefined) body.is_hidden = overrides.is_hidden;
  if (overrides.value_type !== undefined) body.value_type = overrides.value_type;
  if (overrides.possible_values !== undefined) body.possible_values = overrides.possible_values;

  if (overrides.value !== undefined) {
    const effectiveType = overrides.value_type ?? (current.value_type as string | undefined);
    body.value = isJsonValueType(effectiveType)
      ? normalizeJsonValueForStorage(overrides.value)
      : overrides.value;
  }

  return body;
}

export async function handleUpdateAttributeCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean = false
): Promise<void> {
  const idn = args._[1] as string | undefined;
  const projectIdn = args.project as string | undefined;
  const fileFlag = args.file as string | undefined;
  const asJson = Boolean(args.json);

  if (!idn) {
    console.error('Error: attribute IDN is required');
    console.error(USAGE);
    process.exit(1);
  }

  // Resolve the new value: --file takes precedence over --value (for large or
  // multi-line values). Use `in`/`!== undefined` so `--value 0`, `--value false`
  // and `--value ""` are all honored (the empty-string / falsy trap).
  let value: string | undefined;
  if (fileFlag !== undefined) {
    const filePath = String(fileFlag);
    if (!(await fs.pathExists(filePath))) {
      console.error(`Error: value file not found: ${filePath}`);
      process.exit(1);
    }
    value = await fs.readFile(filePath, 'utf8');
  } else if (args.value !== undefined) {
    value = String(args.value);
  }

  const overrides: AttributeUpdateOverrides = {
    ...(value !== undefined ? { value } : {}),
    ...(args.title !== undefined ? { title: String(args.title) } : {}),
    ...(args.description !== undefined ? { description: String(args.description) } : {}),
    ...(args.group !== undefined ? { group: String(args.group) } : {}),
    ...(args.hidden !== undefined ? { is_hidden: Boolean(args.hidden) } : {}),
    ...(args['value-type'] !== undefined ? { value_type: String(args['value-type']) } : {}),
    ...(args['possible-values'] !== undefined
      ? { possible_values: String(args['possible-values']).split(',').map(v => v.trim()) }
      : {})
  };

  if (Object.keys(overrides).length === 0) {
    console.error('Error: nothing to update — pass --value (or --file) and/or another field');
    console.error(USAGE);
    process.exit(1);
  }

  const selectedCustomer = requireSingleCustomer(customerConfig, args.customer as string | undefined);

  if (asJson) {
    process.env.NEWO_QUIET_MODE = 'true'; // keep stdout machine-readable for piping
  }

  const token = await getValidAccessToken(selectedCustomer);
  const client = await makeClient(verbose, token);

  // Resolve project IDN → id when targeting a project attribute.
  let projectId: string | undefined;
  let resolvedProjectIdn: string | undefined;
  if (projectIdn !== undefined) {
    if (verbose) console.log(`🔍 Resolving project "${projectIdn}" for customer ${selectedCustomer.idn}...`);
    const projects = await listProjects(client);
    const project = projects.find((p: ProjectMeta) => p.idn === projectIdn);
    if (!project) {
      console.error(`❌ Project "${projectIdn}" not found for customer ${selectedCustomer.idn}`);
      console.error('');
      console.error('Available projects:');
      for (const p of projects) console.error(`  • ${p.idn}`);
      process.exit(1);
    }
    projectId = project.id;
    resolvedProjectIdn = project.idn;
  }

  // Fetch the current attribute (include hidden — settings are often hidden).
  const scope = projectId ? `project "${resolvedProjectIdn}"` : 'customer';
  if (verbose) console.log(`🔍 Fetching ${scope} attribute "${idn}"...`);

  const response = projectId
    ? await getProjectAttributes(client, projectId, true)
    : await getCustomerAttributes(client, true);
  const attributes = (response.attributes || []) as CustomerAttribute[];

  const current = attributes.find(a => a.idn === idn) as
    | (CustomerAttribute & Record<string, unknown>)
    | undefined;

  if (!current) {
    console.error(`❌ Attribute "${idn}" not found in ${scope} scope.`);
    console.error(
      projectId
        ? "   (is it a customer attribute? re-run without --project)"
        : "   (is it a project attribute? re-run with --project <project-idn>, or 'newo create-attribute' to create it)"
    );
    process.exit(1);
  }
  if (!current.id) {
    console.error(`❌ Attribute "${idn}" has no ID — cannot update.`);
    process.exit(1);
  }

  const previousValue = current.value;
  const body = buildAttributeUpdateBody(current as Record<string, unknown>, overrides);

  if (verbose) {
    console.log(`📝 Updating ${scope} attribute: ${idn} (ID: ${current.id})`);
  }

  try {
    if (projectId) {
      await putProjectAttributeRaw(client, projectId, current.id as string, body);
    } else {
      await putCustomerAttributeRaw(client, current.id as string, body);
    }
  } catch (error: any) {
    const status = error?.response?.status;
    const message =
      error?.response?.data?.message ||
      error?.response?.data?.detail ||
      error?.message ||
      'Unknown error';
    console.error(`❌ Failed to update attribute "${idn}"${status ? ` (HTTP ${status})` : ''}: ${message}`);
    process.exit(1);
  }

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          idn: current.idn,
          id: current.id,
          scope: projectId ? 'project' : 'customer',
          project_idn: resolvedProjectIdn ?? null,
          value_type: body.value_type ?? current.value_type,
          value: body.value ?? current.value
        },
        null,
        2
      )
    );
    return;
  }

  console.log(`✅ Attribute "${current.idn}" updated (${scope})`);
  if (overrides.value !== undefined) {
    const fmt = (v: unknown): string => {
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      return s.length > 80 ? `${s.slice(0, 77)}...` : s;
    };
    console.log(`   value: ${fmt(previousValue)} → ${fmt(body.value)}`);
  }
  if (overrides.value_type !== undefined) console.log(`   value_type: ${overrides.value_type}`);
  if (overrides.title !== undefined) console.log(`   title: ${overrides.title}`);
  if (overrides.group !== undefined) console.log(`   group: ${overrides.group}`);
  if (overrides.is_hidden !== undefined) console.log(`   is_hidden: ${overrides.is_hidden}`);
  if (overrides.description !== undefined) console.log(`   description: (updated)`);
}
