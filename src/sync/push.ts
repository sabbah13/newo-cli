/**
 * Push operations for changed files
 */
import { updateSkill, createAgent, createFlow, createSkill, publishFlow } from '../api.js';
import {
  ensureState,
  mapPath,
  skillMetadataPath,
  projectDir,
  agentMetadataPath
} from '../fsutil.js';
import {
  validateSkillFolder,
  getSingleSkillFile,
  getExtensionForRunner
} from './skill-files.js';
import fs from 'fs-extra';
import { sha256, loadHashes, saveHashes } from '../hash.js';
import yaml from 'js-yaml';
import { generateFlowsYaml } from './metadata.js';
import { isProjectMap, isLegacyProjectMap } from './projects.js';
import { flowsYamlPath } from '../fsutil.js';
import { pushAllProjectAttributes } from './attributes.js';
import type { AxiosInstance } from 'axios';
import type {
  ProjectData,
  ProjectMap,
  CustomerConfig,
  SkillMetadata,
  AgentMetadata,
  FlowMetadata,
  CreateAgentRequest,
  CreateFlowRequest,
  CreateSkillRequest,
  PublishFlowRequest
} from '../types.js';

/**
 * Scan filesystem for local-only entities not in the project map yet
 */
async function scanForLocalOnlyEntities(customer: CustomerConfig, projects: Record<string, ProjectData>, verbose: boolean = false): Promise<{ agentCount: number; flowCount: number; skillCount: number; entities: Array<{ type: 'agent' | 'flow' | 'skill'; path: string; idn: string; projectIdn: string; agentIdn?: string; flowIdn?: string }> }> {
  const localEntities: Array<{ type: 'agent' | 'flow' | 'skill'; path: string; idn: string; projectIdn: string; agentIdn?: string; flowIdn?: string }> = [];
  let agentCount = 0;
  let flowCount = 0;
  let skillCount = 0;

  // Scan each project directory
  for (const [projectIdn] of Object.entries(projects)) {
    const projDir = projectDir(customer.idn, projectIdn);
    if (!(await fs.pathExists(projDir))) continue;

    if (verbose) console.log(`🔍 Scanning project directory: ${projDir}`);

    // Get all subdirectories in the project (these should be agents)
    const agentDirs = await fs.readdir(projDir);

    for (const agentIdn of agentDirs) {
      const agentPath = `${projDir}/${agentIdn}`;
      const agentStat = await fs.stat(agentPath);

      // Skip files, only process directories
      if (!agentStat.isDirectory()) continue;

      // Skip if it's not really an agent directory (no metadata.yaml)
      const agentMetaPath = agentMetadataPath(customer.idn, projectIdn, agentIdn);
      if (!(await fs.pathExists(agentMetaPath))) continue;

      // Check if this agent is already in the project map
      const projectData = projects[projectIdn];
      if (!projectData?.agents[agentIdn]) {
        // This is a local-only agent!
        localEntities.push({
          type: 'agent',
          path: agentMetaPath,
          idn: agentIdn,
          projectIdn
        });
        agentCount++;
        if (verbose) console.log(`  🆕 Found local-only agent: ${agentIdn}`);
      }

      // Now scan for flows within this agent (regardless of whether agent is local-only or not)
      try {
        const flowDirs = await fs.readdir(agentPath);
        for (const flowIdn of flowDirs) {
          const flowPath = `${agentPath}/${flowIdn}`;
          const flowStat = await fs.stat(flowPath);

          // Skip files, only process directories
          if (!flowStat.isDirectory()) continue;

          // Skip if it's not really a flow directory (no metadata.yaml)
          const flowMetaPath = `${flowPath}/metadata.yaml`;
          if (!(await fs.pathExists(flowMetaPath))) continue;

          // Check if this flow exists in the project map
          const agentData = projectData?.agents[agentIdn];
          if (!agentData?.flows[flowIdn]) {
            // This is a local-only flow!
            localEntities.push({
              type: 'flow',
              path: flowMetaPath,
              idn: flowIdn,
              projectIdn,
              agentIdn
            });
            flowCount++;
            if (verbose) console.log(`    🆕 Found local-only flow: ${agentIdn}/${flowIdn}`);
          }

          // Now scan for skills within this flow (regardless of whether flow is local-only or not)
          try {
            const skillDirs = await fs.readdir(flowPath);
            for (const skillIdn of skillDirs) {
              const skillPath = `${flowPath}/${skillIdn}`;
              const skillStat = await fs.stat(skillPath);

              // Skip files, only process directories
              if (!skillStat.isDirectory()) continue;

              // Skip if it's not really a skill directory (no metadata.yaml)
              const skillMetaPath = `${skillPath}/metadata.yaml`;
              if (!(await fs.pathExists(skillMetaPath))) continue;

              // Check if this skill exists in the project map
              const flowData = agentData?.flows[flowIdn];
              if (!flowData?.skills[skillIdn]) {
                // This is a local-only skill!
                localEntities.push({
                  type: 'skill',
                  path: skillMetaPath,
                  idn: skillIdn,
                  projectIdn,
                  agentIdn,
                  flowIdn
                });
                skillCount++;
                if (verbose) console.log(`      🆕 Found local-only skill: ${agentIdn}/${flowIdn}/${skillIdn}`);
              }
            }
          } catch (error) {
            // Ignore errors reading flow directory
          }
        }
      } catch (error) {
        // Ignore errors reading agent directory
      }
    }
  }

  return { agentCount, flowCount, skillCount, entities: localEntities };
}

/**
 * Push changed files to NEWO platform
 */
export async function pushChanged(client: AxiosInstance, customer: CustomerConfig, verbose: boolean = false, shouldPublish: boolean = true): Promise<void> {
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

  // First, handle any local-only entities (created locally but not yet pushed)
  const localScan = await scanForLocalOnlyEntities(customer, projects, verbose);
  const totalLocalEntities = localScan.agentCount + localScan.flowCount + localScan.skillCount;

  if (totalLocalEntities > 0) {
    console.log(`📤 Found ${localScan.agentCount} new agent(s), ${localScan.flowCount} new flow(s), ${localScan.skillCount} new skill(s) to create...`);

    // Process in order: agents first, then flows, then skills
    const sortedEntities = localScan.entities.sort((a, b) => {
      const typeOrder = { 'agent': 0, 'flow': 1, 'skill': 2 };
      return typeOrder[a.type] - typeOrder[b.type];
    });

    for (const entity of sortedEntities) {
      if (entity.type === 'agent') {
        try {
          // Read agent metadata
          const metadataContent = await fs.readFile(entity.path, 'utf8');
          const metadata = yaml.load(metadataContent) as AgentMetadata;

          if (verbose) console.log(`📤 Creating agent: ${entity.idn}`);

          // Get project ID from the project map
          const projectData = projects[entity.projectIdn];
          if (!projectData?.projectId) {
            console.error(`❌ Project ID not found for project: ${entity.projectIdn}`);
            continue;
          }

          // Create agent on NEWO platform using project-specific v2 endpoint
          const createAgentRequest: CreateAgentRequest = {
            idn: metadata.idn,
            title: metadata.title || metadata.idn,
            description: metadata.description || null,
            persona_id: metadata.persona_id || null
          };

          const createResponse = await createAgent(client, projectData.projectId, createAgentRequest);
          console.log(`✅ Agent created: ${entity.idn} (ID: ${createResponse.id})`);
          pushed++;
          metadataChanged = true;

          // Update the metadata with the new ID
          metadata.id = createResponse.id;
          metadata.updated_at = new Date().toISOString();
          const updatedMetadataYaml = yaml.dump(metadata, { indent: 2, quotingType: '"', forceQuotes: false });
          await fs.writeFile(entity.path, updatedMetadataYaml);

          // Update the project map to include the new agent
          if (!projectData.agents[entity.idn]) {
            projectData.agents[entity.idn] = {
              id: createResponse.id,
              flows: {}
            };
          }

        } catch (error: any) {
          console.error(`❌ Failed to create agent ${entity.idn}:`, error.response?.data?.message || error.message);
        }

      } else if (entity.type === 'flow') {
        try {
          // Read flow metadata
          const metadataContent = await fs.readFile(entity.path, 'utf8');
          const metadata = yaml.load(metadataContent) as FlowMetadata;

          if (verbose) console.log(`📤 Creating flow: ${entity.agentIdn}/${entity.idn}`);

          // Get agent ID from the project map
          const projectData = projects[entity.projectIdn];
          if (!entity.agentIdn) {
            console.error(`❌ Agent IDN missing for flow: ${entity.idn}`);
            continue;
          }
          const agentData = projectData?.agents[entity.agentIdn];
          if (!agentData?.id) {
            console.error(`❌ Agent ID not found for agent: ${entity.agentIdn}`);
            continue;
          }

          // Create flow on NEWO platform
          const createFlowRequest: CreateFlowRequest = {
            idn: metadata.idn,
            title: metadata.title || metadata.idn
          };

          const createResponse = await createFlow(client, agentData.id, createFlowRequest);
          console.log(`✅ Flow created: ${entity.idn} (ID: ${createResponse.id})`);
          pushed++;
          metadataChanged = true;

          // Handle the special case where NEWO flow API returns empty response
          if (createResponse.id === 'pending-sync') {
            console.log(`✅ Flow created: ${entity.idn} (ID will be synced on next pull)`);
            // Mark flow as created but pending ID sync
            metadata.id = '';  // Keep empty until sync
            metadata.updated_at = new Date().toISOString();
            const updatedMetadataYaml = yaml.dump(metadata, { indent: 2, quotingType: '"', forceQuotes: false });
            await fs.writeFile(entity.path, updatedMetadataYaml);

            // Update the project map with empty ID (will be filled by pull)
            if (!agentData.flows[entity.idn]) {
              agentData.flows[entity.idn] = {
                id: '',  // Empty until synced
                skills: {}
              };
            }
          } else {
            // Normal case with ID returned
            metadata.id = createResponse.id;
            metadata.updated_at = new Date().toISOString();
            const updatedMetadataYaml = yaml.dump(metadata, { indent: 2, quotingType: '"', forceQuotes: false });
            await fs.writeFile(entity.path, updatedMetadataYaml);

            // Update the project map to include the new flow
            if (!agentData.flows[entity.idn]) {
              agentData.flows[entity.idn] = {
                id: createResponse.id,
                skills: {}
              };
            }
          }

        } catch (error: any) {
          console.error(`❌ Failed to create flow ${entity.idn}:`, error.response?.data?.message || error.message);
        }

      } else if (entity.type === 'skill') {
        try {
          // Read skill metadata
          const metadataContent = await fs.readFile(entity.path, 'utf8');
          const metadata = yaml.load(metadataContent) as SkillMetadata;

          if (verbose) console.log(`📤 Creating skill: ${entity.agentIdn}/${entity.flowIdn}/${entity.idn}`);

          // Get flow ID from the project map
          const projectData = projects[entity.projectIdn];
          if (!entity.agentIdn || !entity.flowIdn) {
            console.error(`❌ Agent IDN or Flow IDN missing for skill: ${entity.idn}`);
            continue;
          }
          const agentData = projectData?.agents[entity.agentIdn];
          const flowData = agentData?.flows[entity.flowIdn];
          if (!flowData?.id) {
            console.error(`❌ Flow ID not found for flow: ${entity.flowIdn}`);
            continue;
          }

          // Read the skill script content
          const skillFolderBase = entity.path.replace('/metadata.yaml', '');
          const scriptExtension = getExtensionForRunner(metadata.runner_type);
          const scriptPath = `${skillFolderBase}/${entity.idn}.${scriptExtension}`;

          let scriptContent = '';
          if (await fs.pathExists(scriptPath)) {
            scriptContent = await fs.readFile(scriptPath, 'utf8');
          }

          // Create skill on NEWO platform
          const createSkillRequest: CreateSkillRequest = {
            idn: metadata.idn,
            title: metadata.title || metadata.idn,
            prompt_script: scriptContent,
            runner_type: metadata.runner_type,
            model: metadata.model,
            path: "",  // Empty path as shown in curl example
            parameters: metadata.parameters || []
          };

          const createResponse = await createSkill(client, flowData.id, createSkillRequest);
          console.log(`✅ Skill created: ${entity.idn} (ID: ${createResponse.id})`);
          pushed++;
          metadataChanged = true;

          // Update the metadata with the new ID
          metadata.id = createResponse.id;
          metadata.updated_at = new Date().toISOString();
          const updatedMetadataYaml = yaml.dump(metadata, { indent: 2, quotingType: '"', forceQuotes: false });
          await fs.writeFile(entity.path, updatedMetadataYaml);

          // Update the project map to include the new skill
          if (!flowData.skills[entity.idn]) {
            flowData.skills[entity.idn] = {
              id: createResponse.id,
              idn: metadata.idn,
              title: metadata.title || metadata.idn,
              runner_type: metadata.runner_type,
              model: metadata.model,
              parameters: metadata.parameters || []
            };
          }

        } catch (error: any) {
          console.error(`❌ Failed to create skill ${entity.idn}:`, error.response?.data?.message || error.message);
        }
      }
    }
  }

  for (const [projectIdn, projectData] of Object.entries(projects)) {
    if (verbose && projectIdn) console.log(`📁 Checking project: ${projectIdn}`);

    for (const [agentIdn, agentObj] of Object.entries(projectData.agents)) {
      if (verbose) console.log(`  📁 Checking agent: ${agentIdn}`);
      for (const [flowIdn, flowObj] of Object.entries(agentObj.flows)) {
        if (verbose) console.log(`    📁 Checking flow: ${flowIdn}`);
        for (const [skillIdn, skillMeta] of Object.entries(flowObj.skills)) {
          scanned++;

          // Validate skill folder has exactly one script file
          const validation = await validateSkillFolder(customer.idn, projectIdn, agentIdn, flowIdn, skillIdn);

          if (!validation.isValid) {
            // Show warnings and errors
            validation.errors.forEach(error => {
              console.error(`❌ ${error}`);
            });
            validation.warnings.forEach(warning => {
              console.warn(`⚠️  ${warning}`);
            });

            if (validation.files.length > 1) {
              console.warn(`⚠️  Skipping push for skill ${skillIdn} - multiple script files found:`);
              validation.files.forEach(file => {
                console.warn(`   • ${file.fileName}`);
              });
              console.warn(`   Please keep only one script file and try again.`);
            }
            continue;
          }

          // Get the single valid script file
          const skillFile = await getSingleSkillFile(customer.idn, projectIdn, agentIdn, flowIdn, skillIdn);
          if (!skillFile) {
            if (verbose) console.log(`      ❌ No valid script file found for: ${skillIdn}`);
            continue;
          }

          const content = skillFile.content;
          const currentPath = skillFile.filePath;
          const h = sha256(content);
          const oldHash = hashes[currentPath];

          if (oldHash !== h) {
            if (verbose) console.log(`🔄 Script changed, updating: ${skillIdn} (${skillFile.fileName})`);

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
              console.log(`↑ Pushed: ${skillIdn} (${skillMeta.title}) from ${skillFile.fileName}`);

              newHashes[currentPath] = h;
              pushed++;
            } catch (error) {
              console.error(`❌ Failed to push ${skillIdn}: ${error instanceof Error ? error.message : String(error)}`);
            }
          } else if (verbose) {
            console.log(`      ✓ No changes: ${skillIdn} (${skillFile.fileName})`);
          }
        }

        // Check for metadata-only changes and push them separately
        for (const [skillIdn] of Object.entries(flowObj.skills)) {
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

                // Get current script content using file validation
                const skillFile = await getSingleSkillFile(customer.idn, projectIdn, agentIdn, flowIdn, skillIdn);
                let scriptContent = '';

                if (skillFile) {
                  scriptContent = skillFile.content;
                } else {
                  console.warn(`⚠️  No valid script file found for metadata update: ${skillIdn}`);
                  continue;
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

  // Push project attributes for all projects
  const projectsInfoMap: Record<string, { projectId: string; projectIdn: string }> = {};
  for (const [projectIdn, projectData] of Object.entries(projects)) {
    if (projectIdn && projectData.projectId) {
      projectsInfoMap[projectIdn] = {
        projectId: projectData.projectId,
        projectIdn: projectData.projectIdn || projectIdn
      };
    }
  }

  const attributesUpdated = await pushAllProjectAttributes(client, customer, projectsInfoMap, verbose);
  if (attributesUpdated > 0) {
    pushed += attributesUpdated;
  }

  // Regenerate flows.yaml if metadata was changed
  if (metadataChanged) {
    if (verbose) console.log(`🔄 Regenerating flows.yaml due to metadata changes...`);
    const flowsYamlContent = await generateFlowsYaml({ projects } as ProjectMap, customer.idn, verbose);

    // Update hash for flows.yaml
    const flowsYamlFilePath = flowsYamlPath(customer.idn);
    newHashes[flowsYamlFilePath] = sha256(flowsYamlContent);
  }

  // Save updated project map if metadata changed (new agents added)
  if (metadataChanged) {
    const updatedMapData = isProjectMap(idMapData)
      ? { projects } as ProjectMap
      : projects[''] as ProjectData; // Legacy format

    if (verbose) console.log(`💾 Saving updated project map...`);
    await fs.writeJson(mapPath(customer.idn), updatedMapData, { spaces: 2 });
  }

  // Save updated hashes
  await saveHashes(newHashes, customer.idn);

  console.log(pushed ? `${pushed} file(s) pushed.` : 'No changes to push.');

  // Publish flows if requested (default behavior)
  if (shouldPublish && pushed > 0) {
    if (verbose) console.log('\n🚀 Publishing flows...');

    let publishedFlows = 0;
    let failedFlows = 0;
    const publishErrors: Array<{ flowIdn: string; error: string; details?: any }> = [];

    for (const [, projectData] of Object.entries(projects)) {
      for (const [, agentObj] of Object.entries(projectData.agents)) {
        for (const [flowIdn, flowObj] of Object.entries(agentObj.flows)) {
          if (flowObj.id) {
            try {
              const publishData: PublishFlowRequest = {
                version: "1.0",
                description: "Published via NEWO CLI",
                type: "public"
              };

              await publishFlow(client, flowObj.id, publishData);
              if (verbose) console.log(`📤 Published flow: ${flowIdn} (${flowObj.id})`);
              publishedFlows++;
            } catch (error: any) {
              failedFlows++;

              // Extract detailed error information from API response
              const errorMessage = error.response?.data?.message || error.message || 'Unknown error';
              const errorDetails = error.response?.data?.reasons || error.response?.data?.errors || error.response?.data?.detail;

              publishErrors.push({
                flowIdn,
                error: errorMessage,
                details: errorDetails
              });

              // Always show publish errors (not just in verbose mode)
              console.error(`❌ Failed to publish flow '${flowIdn}': ${errorMessage}`);

              if (errorDetails) {
                if (Array.isArray(errorDetails)) {
                  console.error(`   Reasons:`);
                  errorDetails.forEach((reason: string) => {
                    console.error(`   • ${reason}`);
                  });
                } else if (typeof errorDetails === 'object') {
                  console.error(`   Details: ${JSON.stringify(errorDetails, null, 2)}`);
                } else {
                  console.error(`   Details: ${errorDetails}`);
                }
              }
            }
          }
        }
      }
    }

    // Summary message
    if (publishedFlows > 0 || failedFlows > 0) {
      console.log(`\n🚀 Publish summary: ${publishedFlows} succeeded, ${failedFlows} failed.`);

      if (failedFlows > 0) {
        console.log(`\n⚠️  ${failedFlows} flow(s) failed to publish due to validation errors.`);
        console.log(`   Fix the errors above and run 'npm run push' again.`);
      }
    } else if (verbose) {
      console.log('\n💡 No flows to publish.');
    }
  }

  // If we created flows, recommend a pull to sync flow IDs
  if (localScan.flowCount > 0) {
    console.log('\n💡 Tip: Run "newo pull" to sync flow IDs and enable skill creation.');
  }
}