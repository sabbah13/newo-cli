/**
 * Push operations for changed files
 */
import { updateSkill } from '../api.js';
import {
  ensureState,
  skillPath,
  skillScriptPath,
  mapPath,
  skillMetadataPath
} from '../fsutil.js';
import fs from 'fs-extra';
import { sha256, loadHashes, saveHashes } from '../hash.js';
import yaml from 'js-yaml';
import { generateFlowsYaml } from './metadata.js';
import { isProjectMap, isLegacyProjectMap } from './projects.js';
import type { AxiosInstance } from 'axios';
import type {
  ProjectData,
  ProjectMap,
  CustomerConfig,
  SkillMetadata
} from '../types.js';

/**
 * Push changed files to NEWO platform
 */
export async function pushChanged(client: AxiosInstance, customer: CustomerConfig, verbose: boolean = false): Promise<void> {
  await ensureState(customer.idn);
  if (!(await fs.pathExists(mapPath(customer.idn)))) {
    console.log(`No map for customer ${customer.idn}. Run \`newo pull --customer ${customer.idn}\` first.`);
    return;
  }

  if (verbose) console.log(`📋 Loading project mapping and hashes for customer ${customer.idn}...`);
  const idMapData = await fs.readJson(mapPath(customer.idn)) as unknown;
  const hashes = await loadHashes(customer.idn);
  const newHashes = { ...hashes };
  let pushed = 0;
  let scanned = 0;
  let metadataChanged = false;

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
          scanned++;

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
            if (verbose) console.log(`      ❌ Script not found, skipping: ${currentPath}`);
            continue;
          }

          const content = await fs.readFile(currentPath, 'utf8');
          const h = sha256(content);
          const oldHash = hashes[currentPath];

          if (oldHash !== h) {
            if (verbose) console.log(`🔄 Script changed, updating: ${skillIdn}`);

            try {
              // Create skill object for update
              const skillObject = {
                id: skillMeta.id,
                title: skillMeta.title,
                idn: skillMeta.idn,
                prompt_script: content,
                runner_type: skillMeta.runner_type,
                model: skillMeta.model,
                parameters: skillMeta.parameters,
                path: skillMeta.path || undefined
              };

              await updateSkill(client, skillObject);
              console.log(`↑ Pushed: ${skillIdn} (${skillMeta.title})`);

              newHashes[currentPath] = h;
              pushed++;
            } catch (error) {
              console.error(`❌ Failed to push ${skillIdn}: ${error instanceof Error ? error.message : String(error)}`);
            }
          } else if (verbose) {
            console.log(`      ✓ No changes: ${skillIdn}`);
          }
        }

        // Check for metadata-only changes and push them separately
        for (const [skillIdn, skillMeta] of Object.entries(flowObj.skills)) {
          const metadataPath = projectIdn ?
            skillMetadataPath(customer.idn, projectIdn, agentIdn, flowIdn, skillIdn) :
            skillMetadataPath(customer.idn, '', agentIdn, flowIdn, skillIdn);

          if (await fs.pathExists(metadataPath)) {
            const metadataContent = await fs.readFile(metadataPath, 'utf8');
            const h = sha256(metadataContent);
            const oldHash = hashes[metadataPath];

            if (oldHash !== h) {
              if (verbose) console.log(`🔄 Metadata-only change detected for ${skillIdn}, updating skill...`);

              try {
                // Load updated metadata
                const updatedMetadata = yaml.load(metadataContent) as SkillMetadata;

                // Get current script content
                const scriptPath = projectIdn ?
                  skillScriptPath(customer.idn, projectIdn, agentIdn, flowIdn, skillIdn, skillMeta.runner_type) :
                  skillScriptPath(customer.idn, '', agentIdn, flowIdn, skillIdn, skillMeta.runner_type);

                let scriptContent = '';
                if (await fs.pathExists(scriptPath)) {
                  scriptContent = await fs.readFile(scriptPath, 'utf8');
                }

                // Create skill object with updated metadata
                const skillObject = {
                  id: updatedMetadata.id,
                  title: updatedMetadata.title,
                  idn: updatedMetadata.idn,
                  prompt_script: scriptContent,
                  runner_type: updatedMetadata.runner_type,
                  model: updatedMetadata.model,
                  parameters: updatedMetadata.parameters,
                  path: updatedMetadata.path || undefined
                };

                await updateSkill(client, skillObject);
                console.log(`↑ Pushed metadata update for skill: ${skillIdn} (${updatedMetadata.title})`);

                newHashes[metadataPath] = h;
                pushed++;
                metadataChanged = true;

              } catch (error) {
                console.error(`❌ Failed to push metadata for ${skillIdn}: ${error instanceof Error ? error.message : String(error)}`);
              }
            }
          }
        }
      }
    }
  }

  if (verbose) console.log(`🔄 Scanned ${scanned} files, found ${pushed} changes`);

  // Save updated hashes
  await saveHashes(newHashes, customer.idn);

  // Regenerate flows.yaml if metadata was changed
  if (metadataChanged) {
    if (verbose) console.log(`🔄 Regenerating flows.yaml due to metadata changes...`);
    await generateFlowsYaml({ projects } as ProjectMap, customer.idn, verbose);
  }

  console.log(pushed ? `${pushed} file(s) pushed.` : 'No changes to push.');
}