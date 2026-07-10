/**
 * Push operations for changed files
 */
import { updateSkill, createAgent, createFlow, createSkill, createSkillParameter, deleteSkillById, deleteAgent, deleteFlow, publishFlow, getFlow } from '../api.js';
import {
  ensureState,
  mapPath,
  skillMetadataPath,
  skillFolderPath,
  projectDir,
  agentMetadataPath,
  flowMetadataPath
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
import { isProjectMap, isLegacyProjectMap, askForDeletion } from './projects.js';
import { flowsYamlPath } from '../fsutil.js';
import { pushAllProjectAttributes } from './attributes.js';
import {
  syncFlowMetadata,
  emptyFlowSyncCounts,
  totalFlowSyncOps,
  describeFlowSyncCounts
} from './flow-metadata.js';
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
  PublishFlowRequest,
  SkillParameter
} from '../types.js';

/**
 * Detect "resource already exists" API errors, matching only the precise phrases the
 * platform actually returns. Mirrors V2ProjectSyncStrategy.isAlreadyExistsApiError, plus
 * "already in use" — confirmed directly against a live re-push: the parameter-creation
 * endpoint's 409 reads "Parameter name X is already in use for Skill Y", not "already
 * exists"/"duplicate key", so those two phrases alone let a harmless retry (re-pushing a
 * skill whose parameters were already created) surface as a scary but meaningless error.
 */
function isAlreadyExistsApiError(error: unknown): boolean {
  const response = (error as { response?: { status?: number; data?: unknown } } | null | undefined)?.response;
  const status = response?.status;
  if (status !== 400 && status !== 409 && status !== 422) {
    return false;
  }

  const haystack = JSON.stringify(
    response?.data ?? (error instanceof Error ? error.message : String(error))
  ).toLowerCase();

  return haystack.includes('already exists') || haystack.includes('duplicate key') || haystack.includes('already in use');
}

/**
 * Neither create-skill (POST .../flows/{flowId}/skills) nor update-skill
 * (PUT .../flows/skills/{id}) persist an inline `parameters` array — confirmed against
 * the live platform: both accept a request with a non-empty `parameters` array (2xx) but
 * the skill comes back from a subsequent read with `parameters: []`. V2ProjectSyncStrategy
 * already works around the identical platform behavior for the newo_v2 path
 * (createMissingSkillParameters); this mirrors that fix for the default cli_v1 path, which
 * otherwise silently drops every parameter on both skill creation and skill/metadata
 * updates alike.
 */
export async function syncSkillParameters(
  client: AxiosInstance,
  skillId: string,
  skillIdn: string,
  parameters: SkillParameter[] | undefined
): Promise<void> {
  for (const parameter of parameters || []) {
    try {
      await createSkillParameter(client, skillId, {
        name: parameter.name,
        default_value: parameter.default_value ?? ''
      });
    } catch (error) {
      if (!isAlreadyExistsApiError(error)) {
        console.error(`❌ Failed to create parameter '${parameter.name}' for skill ${skillIdn}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

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
 * Agent-level counterpart to scanForLocallyDeletedSkills — same shape, same reasoning:
 * delete-agent.ts only ever removed the local mirror, so a locally-deleted agent stayed live
 * on the platform indefinitely. Checks metadata.yaml existence (matching how
 * scanForLocalOnlyEntities checks for the same file in the creation direction), not the bare
 * folder, since a stray leftover folder with no metadata.yaml is exactly what delete-agent.ts
 * itself produces when its local removal is later restored/re-pulled partially.
 */
async function scanForLocallyDeletedAgents(
  customer: CustomerConfig,
  projects: Record<string, ProjectData>
): Promise<Array<{ id: string; idn: string; displayPath: string; projectIdn: string }>> {
  const deleted: Array<{ id: string; idn: string; displayPath: string; projectIdn: string }> = [];

  for (const [projectIdn, projectData] of Object.entries(projects)) {
    for (const [agentIdn, agentData] of Object.entries(projectData.agents)) {
      const metaPath = agentMetadataPath(customer.idn, projectIdn, agentIdn);
      if (!(await fs.pathExists(metaPath))) {
        deleted.push({ id: agentData.id, idn: agentIdn, displayPath: `${projectIdn}/${agentIdn}`, projectIdn });
      }
    }
  }

  return deleted;
}

/**
 * Confirm-and-delete for agents, mirroring deleteRemovedSkills's y/n/a/q loop. Deleting an
 * agent cascades to its flows and skills on the platform (confirmed live) — this gates behind
 * the same interactive per-item confirmation the skill case uses, deliberately: the blast
 * radius here is an entire agent's worth of flows and skills per confirmed row, not one skill.
 * Removes the whole agent entry from the in-memory map on success, so a subsequent flow/skill
 * deletion scan against the same map naturally never sees this agent's now-gone children —
 * no separate exclusion list needed.
 */
async function deleteRemovedAgents(
  client: AxiosInstance,
  toDelete: Array<{ id: string; idn: string; displayPath: string; projectIdn: string }>,
  projects: Record<string, ProjectData>
): Promise<{ deleted: number; errors: string[] }> {
  let deleted = 0;
  const errors: string[] = [];

  if (toDelete.length === 0) {
    return { deleted, errors };
  }

  console.log(`\n🔍 Found ${toDelete.length} agent(s) deleted locally that still exist on the platform:`);
  for (const entity of toDelete) {
    console.log(`   agent    : ${entity.displayPath} (deleting cascades to its flows and skills)`);
  }
  console.log('\nThese will be deleted from the NEWO platform.');

  let deleteAll = false;
  for (const entity of toDelete) {
    let shouldDelete = deleteAll;

    if (!deleteAll) {
      const choice = await askForDeletion('agent (platform, cascades to flows/skills)', entity.displayPath);
      if (choice === 'quit') {
        console.log('❌ Platform deletion cancelled by user');
        break;
      } else if (choice === 'all') {
        deleteAll = true;
        shouldDelete = true;
      } else if (choice === 'yes') {
        shouldDelete = true;
      }
    }

    if (!shouldDelete) {
      continue;
    }

    try {
      await deleteAgent(client, entity.id);
      delete projects[entity.projectIdn]!.agents[entity.idn];
      deleted++;
    } catch (error) {
      errors.push(`Failed to delete agent ${entity.displayPath} from platform: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { deleted, errors };
}

/**
 * Flow-level counterpart to scanForLocallyDeletedAgents. Run this AFTER agent deletion has
 * already mutated the map — any flow under an agent deleted above is no longer in `projects`
 * at all, so this walk never revisits it.
 */
async function scanForLocallyDeletedFlows(
  customer: CustomerConfig,
  projects: Record<string, ProjectData>
): Promise<Array<{ id: string; idn: string; displayPath: string; projectIdn: string; agentIdn: string }>> {
  const deleted: Array<{ id: string; idn: string; displayPath: string; projectIdn: string; agentIdn: string }> = [];

  for (const [projectIdn, projectData] of Object.entries(projects)) {
    for (const [agentIdn, agentData] of Object.entries(projectData.agents)) {
      for (const [flowIdn, flowData] of Object.entries(agentData.flows)) {
        const metaPath = flowMetadataPath(customer.idn, projectIdn, agentIdn, flowIdn);
        if (!(await fs.pathExists(metaPath))) {
          deleted.push({ id: flowData.id, idn: flowIdn, displayPath: `${projectIdn}/${agentIdn}/${flowIdn}`, projectIdn, agentIdn });
        }
      }
    }
  }

  return deleted;
}

/**
 * Confirm-and-delete for flows — same pattern as deleteRemovedAgents, one level down.
 * Deleting a flow cascades to its skills on the platform.
 */
async function deleteRemovedFlows(
  client: AxiosInstance,
  toDelete: Array<{ id: string; idn: string; displayPath: string; projectIdn: string; agentIdn: string }>,
  projects: Record<string, ProjectData>
): Promise<{ deleted: number; errors: string[] }> {
  let deleted = 0;
  const errors: string[] = [];

  if (toDelete.length === 0) {
    return { deleted, errors };
  }

  console.log(`\n🔍 Found ${toDelete.length} flow(s) deleted locally that still exist on the platform:`);
  for (const entity of toDelete) {
    console.log(`   flow     : ${entity.displayPath} (deleting cascades to its skills)`);
  }
  console.log('\nThese will be deleted from the NEWO platform.');

  let deleteAll = false;
  for (const entity of toDelete) {
    let shouldDelete = deleteAll;

    if (!deleteAll) {
      const choice = await askForDeletion('flow (platform, cascades to skills)', entity.displayPath);
      if (choice === 'quit') {
        console.log('❌ Platform deletion cancelled by user');
        break;
      } else if (choice === 'all') {
        deleteAll = true;
        shouldDelete = true;
      } else if (choice === 'yes') {
        shouldDelete = true;
      }
    }

    if (!shouldDelete) {
      continue;
    }

    try {
      await deleteFlow(client, entity.id);
      delete projects[entity.projectIdn]!.agents[entity.agentIdn]!.flows[entity.idn];
      deleted++;
    } catch (error) {
      errors.push(`Failed to delete flow ${entity.displayPath} from platform: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { deleted, errors };
}

/**
 * Inverse of scanForLocalOnlyEntities: find skills the project map already knows about
 * (i.e. they exist on the platform) whose local folder no longer exists. `delete-skill`
 * removes only the local mirror folder and tells the user to run `push` to finish the job on
 * the platform (`src/cli/commands/delete-skill.ts`), but nothing before this scan ever looked
 * for a locally-missing-but-platform-known skill, so that promise never held: a deleted local
 * folder was invisible to push, and the skill stayed live on the platform indefinitely.
 */
export async function scanForLocallyDeletedSkills(
  customer: CustomerConfig,
  projects: Record<string, ProjectData>
): Promise<Array<{ id: string; idn: string; displayPath: string; projectIdn: string; agentIdn: string; flowIdn: string }>> {
  const deleted: Array<{ id: string; idn: string; displayPath: string; projectIdn: string; agentIdn: string; flowIdn: string }> = [];

  for (const [projectIdn, projectData] of Object.entries(projects)) {
    for (const [agentIdn, agentData] of Object.entries(projectData.agents)) {
      for (const [flowIdn, flowData] of Object.entries(agentData.flows)) {
        for (const [skillIdn, skillMeta] of Object.entries(flowData.skills)) {
          const folderPath = skillFolderPath(customer.idn, projectIdn, agentIdn, flowIdn, skillIdn);
          if (!(await fs.pathExists(folderPath))) {
            deleted.push({
              id: skillMeta.id,
              idn: skillIdn,
              displayPath: `${projectIdn}/${agentIdn}/${flowIdn}/${skillIdn}`,
              projectIdn,
              agentIdn,
              flowIdn
            });
          }
        }
      }
    }
  }

  return deleted;
}

/**
 * Confirm and apply platform-side deletion for skills scanForLocallyDeletedSkills found.
 * Interactive, mirroring cleanupDeletedEntities's y/n/a/q pattern in projects.ts (the
 * platform-facing pull-side cleanup) — deliberately: a detection bug in "what counts as
 * deleted" must never be able to silently delete the wrong skill on the live platform, so this
 * gates on the same explicit per-item confirmation the codebase already trusts for the
 * lower-stakes local-cleanup case.
 */
export async function deleteRemovedSkills(
  client: AxiosInstance,
  toDelete: Array<{ id: string; idn: string; displayPath: string; projectIdn: string; agentIdn: string; flowIdn: string }>,
  projects: Record<string, ProjectData>
): Promise<{ deleted: number; errors: string[] }> {
  let deleted = 0;
  const errors: string[] = [];

  if (toDelete.length === 0) {
    return { deleted, errors };
  }

  console.log(`\n🔍 Found ${toDelete.length} skill(s) deleted locally that still exist on the platform:`);
  for (const entity of toDelete) {
    console.log(`   skill    : ${entity.displayPath}`);
  }
  console.log('\nThese will be deleted from the NEWO platform.');

  let deleteAll = false;
  for (const entity of toDelete) {
    let shouldDelete = deleteAll;

    if (!deleteAll) {
      const choice = await askForDeletion('skill (platform)', entity.displayPath);
      if (choice === 'quit') {
        console.log('❌ Platform deletion cancelled by user');
        break;
      } else if (choice === 'all') {
        deleteAll = true;
        shouldDelete = true;
      } else if (choice === 'yes') {
        shouldDelete = true;
      }
    }

    if (!shouldDelete) {
      continue;
    }

    try {
      await deleteSkillById(client, entity.id);
      delete projects[entity.projectIdn]!.agents[entity.agentIdn]!.flows[entity.flowIdn]!.skills[entity.idn];
      deleted++;
    } catch (error) {
      errors.push(`Failed to delete ${entity.displayPath} from platform: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { deleted, errors };
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

          await syncSkillParameters(client, createResponse.id, entity.idn, metadata.parameters);

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

              await syncSkillParameters(client, skillMeta.id, skillIdn, skillMeta.parameters);

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

                await syncSkillParameters(client, updatedMetadata.id, skillIdn, updatedMetadata.parameters);

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

  // Sync flow metadata (title, events, state_fields) for any flow whose
  // metadata.yaml hash has changed. This closes the loop on GH issue #3:
  // previously push only updated skill scripts, leaving local edits to
  // flow events and title silently un-synced.
  const flowSyncCounts = emptyFlowSyncCounts();
  for (const [projectIdn, projectData] of Object.entries(projects)) {
    for (const [agentIdn, agentObj] of Object.entries(projectData.agents)) {
      for (const [flowIdn, flowObj] of Object.entries(agentObj.flows)) {
        if (!flowObj.id) continue;

        const metaPath = flowMetadataPath(customer.idn, projectIdn, agentIdn, flowIdn);
        if (!(await fs.pathExists(metaPath))) continue;

        const metaContent = await fs.readFile(metaPath, 'utf8');
        const metaHash = sha256(metaContent);
        const oldHash = hashes[metaPath];

        if (oldHash === metaHash) {
          if (verbose) console.log(`    ✓ Flow metadata unchanged: ${flowIdn}`);
          continue;
        }

        if (verbose) console.log(`    🔄 Flow metadata changed, syncing: ${agentIdn}/${flowIdn}`);

        let localFlow: FlowMetadata;
        try {
          localFlow = yaml.load(metaContent) as FlowMetadata;
        } catch (error) {
          console.error(`❌ Failed to parse flow metadata for ${flowIdn}: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }

        let remoteFlow = null;
        try {
          remoteFlow = await getFlow(client, flowObj.id);
        } catch (error: any) {
          // 404 means the flow ID is stale; skip flow-level update but still
          // try to sync children since list endpoints may still work.
          if (verbose) {
            console.log(`    ⚠️  Could not GET flow ${flowIdn}: ${error.response?.status ?? error.message}`);
          }
        }

        const opsBefore = totalFlowSyncOps(flowSyncCounts);
        await syncFlowMetadata(client, flowObj.id, localFlow, remoteFlow, verbose, flowSyncCounts);
        const opsAfter = totalFlowSyncOps(flowSyncCounts);

        if (opsAfter > opsBefore) {
          pushed += (opsAfter - opsBefore);
          metadataChanged = true;
        }
        // Hash is updated regardless of whether ops happened, so we don't
        // re-scan the same untouched flow on the next push.
        newHashes[metaPath] = metaHash;
      }
    }
  }

  const totalFlowOps = totalFlowSyncOps(flowSyncCounts);
  if (totalFlowOps > 0) {
    console.log(`↑ Flow metadata synced: ${describeFlowSyncCounts(flowSyncCounts)}`);
  }
  if (flowSyncCounts.errors.length > 0) {
    console.warn(`⚠️  ${flowSyncCounts.errors.length} flow-metadata error(s) during push.`);
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

  // Sync local agent/flow deletions to the platform first — same gap as skills (delete-agent.ts
  // and delete-flow.ts made the identical unfulfilled promise), fixed the same way, in cascade
  // order (agent, then flow, then skill) so a deleted agent's own flows/skills are never
  // separately re-scanned once its map entry is gone.
  const locallyDeletedAgents = await scanForLocallyDeletedAgents(customer, projects);
  if (locallyDeletedAgents.length > 0) {
    const agentDeletionResult = await deleteRemovedAgents(client, locallyDeletedAgents, projects);
    if (agentDeletionResult.deleted > 0) {
      pushed += agentDeletionResult.deleted;
      metadataChanged = true;
    }
    agentDeletionResult.errors.forEach(error => console.error(`❌ ${error}`));
  }

  const locallyDeletedFlows = await scanForLocallyDeletedFlows(customer, projects);
  if (locallyDeletedFlows.length > 0) {
    const flowDeletionResult = await deleteRemovedFlows(client, locallyDeletedFlows, projects);
    if (flowDeletionResult.deleted > 0) {
      pushed += flowDeletionResult.deleted;
      metadataChanged = true;
    }
    flowDeletionResult.errors.forEach(error => console.error(`❌ ${error}`));
  }

  // Sync local skill deletions to the platform — see scanForLocallyDeletedSkills for why this
  // is necessary at all (delete-skill's own promise to do this via push never held before now).
  const locallyDeleted = await scanForLocallyDeletedSkills(customer, projects);
  if (locallyDeleted.length > 0) {
    const deletionResult = await deleteRemovedSkills(client, locallyDeleted, projects);
    if (deletionResult.deleted > 0) {
      pushed += deletionResult.deleted;
      metadataChanged = true;
    }
    deletionResult.errors.forEach(error => console.error(`❌ ${error}`));
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