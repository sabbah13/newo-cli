/**
 * Diff command handler
 *
 * Shows differences between local files and remote NEWO platform.
 * Supports selective resource diffing with --only flag.
 *
 * Usage:
 *   newo diff                      # Show all differences
 *   newo diff --only projects      # Show only project differences
 *   newo diff --detailed           # Show detailed content diff
 */
import { makeClient } from '../../api.js';
import { getValidAccessToken } from '../../auth.js';
import { selectSingleCustomer } from '../customer-selection.js';
import { ALL_RESOURCE_TYPES } from '../../cli-new/di/tokens.js';
import type { MultiCustomerConfig, CliArgs, CustomerConfig } from '../../types.js';
import type { AxiosInstance } from 'axios';
import { getSkill, listAgents, listFlowSkills, getCustomerAttributes, listProjects } from '../../api.js';
import fs from 'fs-extra';
import path from 'path';
import yaml from 'js-yaml';

/**
 * Parse resource list from comma-separated string
 */
function parseResourceList(input: string | undefined): string[] {
  if (!input) return [];
  return input.split(',').map(r => r.trim().toLowerCase()).filter(Boolean);
}

/**
 * Color codes for terminal output
 */
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

/**
 * Diff entry for display
 */
interface DiffEntry {
  path: string;
  type: 'added' | 'modified' | 'deleted' | 'unchanged';
  localContent?: string;
  remoteContent?: string;
}

/**
 * Generate unified diff output
 */
function generateUnifiedDiff(local: string, remote: string, filePath: string): string[] {
  const localLines = local.split('\n');
  const remoteLines = remote.split('\n');
  const output: string[] = [];

  output.push(`${colors.cyan}--- local: ${filePath}${colors.reset}`);
  output.push(`${colors.cyan}+++ remote: ${filePath}${colors.reset}`);

  // Simple line-by-line comparison
  const maxLines = Math.max(localLines.length, remoteLines.length);
  let diffStart = -1;
  let diffLines: string[] = [];

  for (let i = 0; i < maxLines; i++) {
    const localLine = localLines[i] ?? '';
    const remoteLine = remoteLines[i] ?? '';

    if (localLine !== remoteLine) {
      if (diffStart === -1) {
        diffStart = i + 1;
      }
      if (i < localLines.length) {
        diffLines.push(`${colors.red}- ${localLine}${colors.reset}`);
      }
      if (i < remoteLines.length) {
        diffLines.push(`${colors.green}+ ${remoteLine}${colors.reset}`);
      }
    } else {
      if (diffStart !== -1) {
        output.push(`${colors.gray}@@ -${diffStart},${diffLines.length} @@${colors.reset}`);
        output.push(...diffLines);
        diffStart = -1;
        diffLines = [];
      }
    }
  }

  if (diffLines.length > 0) {
    output.push(`${colors.gray}@@ -${diffStart},${diffLines.length} @@${colors.reset}`);
    output.push(...diffLines);
  }

  return output;
}

/**
 * Get project differences
 */
async function getProjectDiffs(
  client: AxiosInstance,
  customer: CustomerConfig,
  _verbose: boolean
): Promise<DiffEntry[]> {
  const diffs: DiffEntry[] = [];
  const customerDir = path.join(process.cwd(), 'newo_customers', customer.idn);

  // Get all projects first
  const projects = await listProjects(client);

  for (const project of projects) {
    const projectIdn = project.idn;

    // Get all agents for this project
    const agents = await listAgents(client, project.id);

    for (const agent of agents) {
      for (const flow of agent.flows || []) {
        const skills = await listFlowSkills(client, flow.id);

        for (const skill of skills) {
          // Get full skill content from API
          const remoteSkill = await getSkill(client, skill.id);
          const remoteContent = remoteSkill.prompt_script || '';

          // Determine local file path
          const extension = remoteSkill.runner_type === 'nsl' ? 'jinja' : 'guidance';
          const localPath = path.join(
            customerDir,
            'projects',
            projectIdn,
            agent.idn,
            flow.idn,
            skill.idn,
            `${skill.idn}.${extension}`
          );

          // Compare with local
          if (await fs.pathExists(localPath)) {
            const localContent = await fs.readFile(localPath, 'utf-8');

            if (localContent !== remoteContent) {
              diffs.push({
                path: path.relative(process.cwd(), localPath),
                type: 'modified',
                localContent,
                remoteContent,
              });
            }
          } else {
            // File exists remotely but not locally
            diffs.push({
              path: path.relative(process.cwd(), localPath),
              type: 'deleted',
              remoteContent,
            });
          }
        }
      }
    }
  }

  // Check for local files that don't exist remotely
  const projectsDir = path.join(customerDir, 'projects');
  if (await fs.pathExists(projectsDir)) {
    const walkDir = async (dir: string): Promise<string[]> => {
      const files: string[] = [];
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...await walkDir(fullPath));
        } else if (entry.name.endsWith('.guidance') || entry.name.endsWith('.jinja')) {
          files.push(fullPath);
        }
      }
      return files;
    };

    const localFiles = await walkDir(projectsDir);
    for (const localFile of localFiles) {
      const relativePath = path.relative(process.cwd(), localFile);
      const alreadyInDiffs = diffs.some(d => d.path === relativePath);
      if (!alreadyInDiffs) {
        const localContent = await fs.readFile(localFile, 'utf-8');
        diffs.push({
          path: relativePath,
          type: 'added',
          localContent,
        });
      }
    }
  }

  return diffs;
}

/**
 * Get attribute differences
 */
async function getAttributeDiffs(
  client: AxiosInstance,
  customer: CustomerConfig,
  _verbose: boolean
): Promise<DiffEntry[]> {
  const diffs: DiffEntry[] = [];
  const customerDir = path.join(process.cwd(), 'newo_customers', customer.idn);

  // Customer attributes
  const localAttrPath = path.join(customerDir, 'attributes.yaml');
  if (await fs.pathExists(localAttrPath)) {
    try {
      const remoteAttrsResponse = await getCustomerAttributes(client, true);
      const localContent = await fs.readFile(localAttrPath, 'utf-8');

      // Transform remote to YAML format for comparison
      const remoteYaml = yaml.dump(remoteAttrsResponse.attributes.map(attr => ({
        idn: attr.idn,
        title: attr.title,
        value: attr.value,
        value_type: attr.value_type,
        is_hidden: attr.is_hidden,
      })), { lineWidth: -1 });

      const localParsed = yaml.load(localContent);
      const localYaml = yaml.dump(localParsed, { lineWidth: -1 });

      if (localYaml !== remoteYaml) {
        diffs.push({
          path: path.relative(process.cwd(), localAttrPath),
          type: 'modified',
          localContent: localYaml,
          remoteContent: remoteYaml,
        });
      }
    } catch {
      // Error fetching remote - skip
    }
  }

  return diffs;
}

/**
 * Main diff command handler
 */
export async function handleDiffCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean
): Promise<void> {
  const { selectedCustomer } = selectSingleCustomer(
    customerConfig,
    args.customer as string | undefined
  );

  if (!selectedCustomer) {
    console.error('❌ Please specify a customer with --customer <idn> or set a default');
    process.exit(1);
  }

  // Parse options
  const onlyResources = parseResourceList(args.only as string | undefined);
  const detailed = Boolean(args.detailed || args.d);

  // Determine resources to diff
  let resourcesToDiff: string[];
  if (onlyResources.length > 0) {
    resourcesToDiff = onlyResources.filter(r => ALL_RESOURCE_TYPES.includes(r as typeof ALL_RESOURCE_TYPES[number]));
  } else {
    resourcesToDiff = ['projects', 'attributes']; // Default to main resources
  }

  console.log(`🔍 Comparing local vs remote for: ${resourcesToDiff.join(', ')}`);
  console.log(`📁 Customer: ${selectedCustomer.idn}`);
  console.log('');

  const accessToken = await getValidAccessToken(selectedCustomer);
  const client = await makeClient(verbose, accessToken);

  const allDiffs: DiffEntry[] = [];

  // Get diffs for each resource type
  for (const resource of resourcesToDiff) {
    switch (resource) {
      case 'projects':
        console.log(`📦 Checking projects...`);
        const projectDiffs = await getProjectDiffs(client, selectedCustomer, verbose);
        allDiffs.push(...projectDiffs);
        break;
      case 'attributes':
        console.log(`📋 Checking attributes...`);
        const attrDiffs = await getAttributeDiffs(client, selectedCustomer, verbose);
        allDiffs.push(...attrDiffs);
        break;
      default:
        console.log(`⏭️  Skipping ${resource} (diff not implemented yet)`);
    }
  }

  // Display results
  console.log('');

  if (allDiffs.length === 0) {
    console.log('✅ No differences found. Local and remote are in sync.');
    return;
  }

  console.log(`📊 Found ${allDiffs.length} difference(s):`);
  console.log('');

  // Group by type
  const added = allDiffs.filter(d => d.type === 'added');
  const modified = allDiffs.filter(d => d.type === 'modified');
  const deleted = allDiffs.filter(d => d.type === 'deleted');

  if (added.length > 0) {
    console.log(`${colors.green}➕ Added locally (${added.length}):${colors.reset}`);
    for (const diff of added) {
      console.log(`   ${diff.path}`);
    }
    console.log('');
  }

  if (modified.length > 0) {
    console.log(`${colors.yellow}📝 Modified (${modified.length}):${colors.reset}`);
    for (const diff of modified) {
      console.log(`   ${diff.path}`);

      if (detailed && diff.localContent && diff.remoteContent) {
        const diffOutput = generateUnifiedDiff(diff.localContent, diff.remoteContent, diff.path);
        diffOutput.forEach(line => console.log(`      ${line}`));
        console.log('');
      }
    }
    console.log('');
  }

  if (deleted.length > 0) {
    console.log(`${colors.red}➖ Deleted locally (${deleted.length}):${colors.reset}`);
    for (const diff of deleted) {
      console.log(`   ${diff.path}`);
    }
    console.log('');
  }

  // Summary
  console.log(`${colors.cyan}Summary:${colors.reset}`);
  console.log(`   Added: ${added.length}`);
  console.log(`   Modified: ${modified.length}`);
  console.log(`   Deleted: ${deleted.length}`);
  console.log('');
  console.log(`💡 Run ${colors.cyan}newo push${colors.reset} to upload local changes to remote.`);
  console.log(`💡 Run ${colors.cyan}newo pull${colors.reset} to download remote changes to local.`);
}
