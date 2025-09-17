/**
 * Status checking module
 */
import fs from 'fs-extra';
import yaml from 'js-yaml';
import { sha256, loadHashes } from '../hash.js';
import {
  ensureState,
  mapPath,
  skillScriptPath,
  skillPath,
  skillMetadataPath,
  customerAttributesPath,
  customerAttributesBackupPath,
  flowsYamlPath
} from '../fsutil.js';
import type {
  CustomerConfig,
  ProjectMap,
  LegacyProjectMap,
  ProjectData
} from '../types.js';

// Type guards for project map formats
function isProjectMap(x: unknown): x is ProjectMap {
  return typeof x === 'object' && x !== null && 'projects' in x;
}

function isLegacyProjectMap(x: unknown): x is LegacyProjectMap {
  return typeof x === 'object' && x !== null && 'projectId' in x && 'agents' in x;
}

/**
 * Check status of files for a customer
 */
export async function status(customer: CustomerConfig, verbose: boolean = false): Promise<void> {
  await ensureState(customer.idn);
  if (!(await fs.pathExists(mapPath(customer.idn)))) {
    console.log(`No map for customer ${customer.idn}. Run \`newo pull --customer ${customer.idn}\` first.`);
    return;
  }

  if (verbose) console.log(`📋 Loading project mapping and hashes for customer ${customer.idn}...`);
  const idMapData = await fs.readJson(mapPath(customer.idn)) as unknown;
  const hashes = await loadHashes(customer.idn);
  let dirty = 0;

  // Handle both old single-project format and new multi-project format with type guards
  const projects = isProjectMap(idMapData) && idMapData.projects
    ? idMapData.projects
    : isLegacyProjectMap(idMapData)
    ? { '': idMapData as ProjectData }
    : (() => { throw new Error('Invalid project map format'); })();

  for (const [projectIdn, projectData] of Object.entries(projects)) {
    if (verbose && projectIdn) console.log(`📁 Checking project: ${projectIdn}`);

    for (const [agentIdn, agentObj] of Object.entries(projectData.agents)) {
      if (verbose) console.log(`  📁 Checking agent: ${agentIdn}`);
      for (const [flowIdn, flowObj] of Object.entries(agentObj.flows)) {
        if (verbose) console.log(`    📁 Checking flow: ${flowIdn}`);
        for (const [skillIdn, skillMeta] of Object.entries(flowObj.skills)) {
          // Try new folder structure first
          const newPath = projectIdn ?
            skillScriptPath(customer.idn, projectIdn, agentIdn, flowIdn, skillIdn, skillMeta.runner_type) :
            skillScriptPath(customer.idn, '', agentIdn, flowIdn, skillIdn, skillMeta.runner_type);

          // Fallback to legacy structure
          const legacyPath = projectIdn ?
            skillPath(customer.idn, projectIdn, agentIdn, flowIdn, skillIdn, skillMeta.runner_type) :
            skillPath(customer.idn, '', agentIdn, flowIdn, skillIdn, skillMeta.runner_type);

          let currentPath = newPath;
          let exists = await fs.pathExists(newPath);

          // If new structure doesn't exist, try legacy structure
          if (!exists) {
            exists = await fs.pathExists(legacyPath);
            currentPath = legacyPath;
          }

          if (!exists) {
            console.log(`D  ${currentPath}`);
            dirty++;
            if (verbose) console.log(`      ❌ Deleted: ${currentPath}`);
            continue;
          }

          const content = await fs.readFile(currentPath, 'utf8');
          const h = sha256(content);
          const oldHash = hashes[currentPath];

          if (verbose) {
            console.log(`      📄 ${currentPath}`);
            console.log(`        Old hash: ${oldHash || 'none'}`);
            console.log(`        New hash: ${h}`);
          }

          if (oldHash !== h) {
            console.log(`M  ${currentPath}`);
            dirty++;
            if (verbose) console.log(`      🔄 Modified: ${currentPath}`);
          } else if (verbose) {
            console.log(`      ✓ Unchanged: ${currentPath}`);
          }
        }

        // Check metadata.yaml files for changes
        for (const [skillIdn] of Object.entries(flowObj.skills)) {
          const metadataPath = projectIdn ?
            skillMetadataPath(customer.idn, projectIdn, agentIdn, flowIdn, skillIdn) :
            skillMetadataPath(customer.idn, '', agentIdn, flowIdn, skillIdn);

          if (await fs.pathExists(metadataPath)) {
            const metadataContent = await fs.readFile(metadataPath, 'utf8');
            const h = sha256(metadataContent);
            const oldHash = hashes[metadataPath];

            if (verbose) {
              console.log(`      📄 ${metadataPath}`);
              console.log(`        Old hash: ${oldHash || 'none'}`);
              console.log(`        New hash: ${h}`);
            }

            if (oldHash !== h) {
              console.log(`M  ${metadataPath}`);
              dirty++;

              // Show which metadata fields changed
              try {
                const newMetadata = yaml.load(metadataContent) as any;
                console.log(`      📊 Metadata changed for skill: ${skillIdn}`);
                if (newMetadata?.title) {
                  console.log(`        • Title: ${newMetadata.title}`);
                }
                if (newMetadata?.runner_type) {
                  console.log(`        • Runner: ${newMetadata.runner_type}`);
                }
                if (newMetadata?.model) {
                  console.log(`        • Model: ${newMetadata.model.provider_idn}/${newMetadata.model.model_idn}`);
                }
              } catch (e) {
                if (verbose) console.log(`      🔄 Modified: metadata.yaml`);
              }
            } else if (verbose) {
              console.log(`      ✓ Unchanged: ${metadataPath}`);
            }
          }
        }
      }
    }
  }

  // Check attributes file for changes
  try {
    const attributesFile = customerAttributesPath(customer.idn);
    if (await fs.pathExists(attributesFile)) {
      const content = await fs.readFile(attributesFile, 'utf8');
      const h = sha256(content);
      const oldHash = hashes[attributesFile];

      if (verbose) {
        console.log(`📄 ${attributesFile}`);
        console.log(`  Old hash: ${oldHash || 'none'}`);
        console.log(`  New hash: ${h}`);
      }

      if (oldHash !== h) {
        console.log(`M  ${attributesFile}`);
        dirty++;

        // Show which attributes changed by comparing with backup
        try {
          const attributesBackupFile = customerAttributesBackupPath(customer.idn);
          if (await fs.pathExists(attributesBackupFile)) {
            const backupContent = await fs.readFile(attributesBackupFile, 'utf8');

            const parseYaml = (content: string) => {
              let yamlContent = content.replace(/!enum "([^"]+)"/g, '"$1"');
              return yaml.load(yamlContent) as { attributes: any[] };
            };

            const currentData = parseYaml(content);
            const backupData = parseYaml(backupContent);

            if (currentData?.attributes && backupData?.attributes) {
              const currentAttrs = new Map(currentData.attributes.map(attr => [attr.idn, attr]));
              const backupAttrs = new Map(backupData.attributes.map(attr => [attr.idn, attr]));

              const changedAttributes: string[] = [];

              for (const [idn, currentAttr] of currentAttrs) {
                const backupAttr = backupAttrs.get(idn);
                const hasChanged = !backupAttr ||
                  currentAttr.value !== backupAttr.value ||
                  currentAttr.title !== backupAttr.title ||
                  currentAttr.description !== backupAttr.description ||
                  currentAttr.group !== backupAttr.group ||
                  currentAttr.is_hidden !== backupAttr.is_hidden;

                if (hasChanged) {
                  changedAttributes.push(idn);
                }
              }

              if (changedAttributes.length > 0) {
                console.log(`  📊 Changed attributes (${changedAttributes.length}):`);
                changedAttributes.slice(0, 5).forEach(idn => {
                  const current = currentAttrs.get(idn);
                  console.log(`    • ${idn}: ${current?.title || 'No title'}`);
                });
                if (changedAttributes.length > 5) {
                  console.log(`    ... and ${changedAttributes.length - 5} more`);
                }
              }
            }
          }
        } catch (e) {
          // Fallback to simple message if diff analysis fails
        }

        if (verbose) console.log(`  🔄 Modified: attributes.yaml`);
      } else if (verbose) {
        console.log(`  ✓ Unchanged: attributes.yaml`);
      }
    }
  } catch (error) {
    if (verbose) console.log(`⚠️  Error checking attributes: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Check flows.yaml file for changes
  const flowsFile = flowsYamlPath(customer.idn);
  if (await fs.pathExists(flowsFile)) {
    try {
      const flowsContent = await fs.readFile(flowsFile, 'utf8');
      const h = sha256(flowsContent);
      const oldHash = hashes[flowsFile];

      if (verbose) {
        console.log(`📄 flows.yaml`);
        console.log(`  Old hash: ${oldHash || 'none'}`);
        console.log(`  New hash: ${h}`);
      }

      if (oldHash !== h) {
        console.log(`M  ${flowsFile}`);
        dirty++;
        if (verbose) {
          const flowsStats = await fs.stat(flowsFile);
          console.log(`  🔄 Modified: flows.yaml`);
          console.log(`  📊 Size: ${(flowsStats.size / 1024).toFixed(1)}KB`);
          console.log(`  📅 Last modified: ${flowsStats.mtime.toISOString()}`);
        }
      } else if (verbose) {
        const flowsStats = await fs.stat(flowsFile);
        console.log(`  ✓ Unchanged: flows.yaml`);
        console.log(`  📅 Last modified: ${flowsStats.mtime.toISOString()}`);
        console.log(`  📊 Size: ${(flowsStats.size / 1024).toFixed(1)}KB`);
      }
    } catch (error) {
      if (verbose) console.log(`⚠️  Error checking flows.yaml: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(dirty ? `${dirty} changed file(s).` : 'Clean.');
}