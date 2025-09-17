/**
 * Project synchronization operations
 */
import {
  listProjects,
  listAgents,
  listFlowSkills,
  listFlowEvents,
  listFlowStates
} from '../api.js';
import {
  ensureState,
  writeFileSafe,
  mapPath,
  projectMetadataPath,
  agentMetadataPath,
  flowMetadataPath,
  skillMetadataPath,
  skillScriptPath,
  skillFolderPath
} from '../fsutil.js';
import {
  findSkillScriptFiles,
  isContentDifferent,
  askForOverwrite,
  getExtensionForRunner
} from './skill-files.js';
import fs from 'fs-extra';
import { sha256, saveHashes } from '../hash.js';
import yaml from 'js-yaml';
import { generateFlowsYaml } from './metadata.js';
import type { AxiosInstance } from 'axios';
import type {
  ProjectData,
  ProjectMap,
  LegacyProjectMap,
  HashStore,
  CustomerConfig,
  ProjectMetadata,
  AgentMetadata,
  FlowMetadata,
  SkillMetadata
} from '../types.js';

// Type guards for project map formats
export function isProjectMap(x: unknown): x is ProjectMap {
  return typeof x === 'object' && x !== null && 'projects' in x;
}

export function isLegacyProjectMap(x: unknown): x is LegacyProjectMap {
  return typeof x === 'object' && x !== null && 'projectId' in x && 'agents' in x;
}

/**
 * Pull a single project and all its data
 */
export async function pullSingleProject(
  client: AxiosInstance,
  customer: CustomerConfig,
  projectId: string | null,
  verbose: boolean = false,
  silentOverwrite: boolean = false
): Promise<void> {
  if (verbose) console.log(`📋 Loading project list for customer ${customer.idn}...`);

  const projects = projectId ?
    [{ id: projectId, idn: 'unknown', title: 'Project' }] :
    await listProjects(client);

  if (projects.length === 0) {
    console.log(`No projects found for customer ${customer.idn}`);
    return;
  }

  await ensureState(customer.idn);

  // Load existing mappings if they exist
  let existingMap: ProjectMap = { projects: {} };
  const mapFile = mapPath(customer.idn);
  if (await fs.pathExists(mapFile)) {
    const mapData = await fs.readJson(mapFile) as unknown;
    if (isProjectMap(mapData)) {
      existingMap = mapData;
    } else if (isLegacyProjectMap(mapData)) {
      // Convert legacy format to new format
      existingMap = {
        projects: {
          [mapData.projectIdn || '']: mapData as ProjectData
        }
      };
    }
  }

  const newHashes: HashStore = {};

  for (const project of projects) {
    if (verbose) console.log(`📁 Processing project: ${project.title} (${project.idn})`);

    // Create project metadata
    const projectMeta: ProjectMetadata = {
      id: project.id,
      idn: project.idn,
      title: project.title,
      description: project.description || '',
      created_at: project.created_at || '',
      updated_at: project.updated_at || ''
    };

    // Save project metadata
    const projectMetaPath = projectMetadataPath(customer.idn, project.idn);
    const projectMetaYaml = yaml.dump(projectMeta, { indent: 2, quotingType: '"', forceQuotes: false });
    await writeFileSafe(projectMetaPath, projectMetaYaml);
    newHashes[projectMetaPath] = sha256(projectMetaYaml);

    const agents = await listAgents(client, project.id);
    if (verbose) console.log(`  📋 Found ${agents.length} agents in project ${project.title}`);

    const projectData: ProjectData = {
      projectId: project.id,
      projectIdn: project.idn,
      agents: {}
    };

    for (const agent of agents) {
      if (verbose) console.log(`  📁 Processing agent: ${agent.title} (${agent.idn})`);

      // Create agent metadata
      const agentMeta: AgentMetadata = {
        id: agent.id,
        idn: agent.idn,
        title: agent.title || '',
        description: agent.description || ''
      };

      // Save agent metadata
      const agentMetaPath = agentMetadataPath(customer.idn, project.idn, agent.idn);
      const agentMetaYaml = yaml.dump(agentMeta, { indent: 2, quotingType: '"', forceQuotes: false });
      await writeFileSafe(agentMetaPath, agentMetaYaml);
      newHashes[agentMetaPath] = sha256(agentMetaYaml);

      projectData.agents[agent.idn] = {
        id: agent.id,
        flows: {}
      };

      const flows = agent.flows || [];
      if (verbose && flows.length > 0) {
        console.log(`    📋 Found ${flows.length} flows in agent ${agent.title}`);
      }

      for (const flow of flows) {
        if (verbose) console.log(`    📁 Processing flow: ${flow.title} (${flow.idn})`);

        // Get flow events and states for metadata
        const [events, states] = await Promise.all([
          listFlowEvents(client, flow.id).catch(() => []),
          listFlowStates(client, flow.id).catch(() => [])
        ]);

        // Create flow metadata
        const flowMeta: FlowMetadata = {
          id: flow.id,
          idn: flow.idn,
          title: flow.title,
          description: flow.description || '',
          default_runner_type: flow.default_runner_type,
          default_model: flow.default_model,
          events,
          state_fields: states
        };

        // Save flow metadata
        const flowMetaPath = flowMetadataPath(customer.idn, project.idn, agent.idn, flow.idn);
        const flowMetaYaml = yaml.dump(flowMeta, { indent: 2, quotingType: '"', forceQuotes: false });
        await writeFileSafe(flowMetaPath, flowMetaYaml);
        newHashes[flowMetaPath] = sha256(flowMetaYaml);

        projectData.agents[agent.idn]!.flows[flow.idn] = {
          id: flow.id,
          skills: {}
        };

        const skills = await listFlowSkills(client, flow.id);
        if (verbose) console.log(`      📋 Found ${skills.length} skills in flow ${flow.title}`);

        for (const skill of skills) {
          if (verbose) console.log(`      📄 Processing skill: ${skill.title} (${skill.idn})`);

          // Create skill metadata
          const skillMeta: SkillMetadata = {
            id: skill.id,
            idn: skill.idn,
            title: skill.title,
            runner_type: skill.runner_type,
            model: skill.model,
            parameters: [...skill.parameters],
            path: skill.path
          };

          // Save skill metadata
          const skillMetaPath = skillMetadataPath(customer.idn, project.idn, agent.idn, flow.idn, skill.idn);
          const skillMetaYaml = yaml.dump(skillMeta, { indent: 2, quotingType: '"', forceQuotes: false });
          await writeFileSafe(skillMetaPath, skillMetaYaml);
          newHashes[skillMetaPath] = sha256(skillMetaYaml);

          // Handle skill script with overwrite detection
          const scriptContent = skill.prompt_script || '';
          const scriptPath = skillScriptPath(customer.idn, project.idn, agent.idn, flow.idn, skill.idn, skill.runner_type);
          const folderPath = skillFolderPath(customer.idn, project.idn, agent.idn, flow.idn, skill.idn);

          // Check for existing script files in the skill folder
          const existingFiles = await findSkillScriptFiles(folderPath);
          let shouldWrite = true;

          if (existingFiles.length > 0) {
            // Check if any existing file has the same content
            const contentMatches = existingFiles.some(file => !isContentDifferent(file.content, scriptContent));

            if (contentMatches) {
              // Content is the same, no need to ask for overwrite
              if (verbose) console.log(`        ✓ Content unchanged for ${skill.idn}, skipping overwrite`);
              shouldWrite = false;

              // Find the matching file and use its path for hashing
              const matchingFile = existingFiles.find(file => !isContentDifferent(file.content, scriptContent));
              if (matchingFile) {
                newHashes[matchingFile.filePath] = sha256(scriptContent);
              }
            } else if (!silentOverwrite) {
              // Content is different, ask for overwrite
              const existingFile = existingFiles[0]!;
              const shouldOverwrite = await askForOverwrite(
                skill.idn,
                existingFile.fileName,
                `${skill.idn}.${getExtensionForRunner(skill.runner_type)}`
              );

              if (!shouldOverwrite) {
                shouldWrite = false;
                if (verbose) console.log(`        ⚠️  Skipped overwrite for ${skill.idn}`);
              } else {
                // Remove existing files before writing new one
                for (const file of existingFiles) {
                  await fs.remove(file.filePath);
                  if (verbose) console.log(`        🗑️  Removed ${file.fileName}`);
                }
              }
            } else {
              // Silent overwrite mode - remove existing files
              for (const file of existingFiles) {
                await fs.remove(file.filePath);
                if (verbose) console.log(`        🔄 Silent overwrite: removed ${file.fileName}`);
              }
            }
          }

          if (shouldWrite) {
            await writeFileSafe(scriptPath, scriptContent);
            newHashes[scriptPath] = sha256(scriptContent);
            if (verbose) console.log(`        ✓ Saved ${skill.idn}.${getExtensionForRunner(skill.runner_type)}`);
          }

          projectData.agents[agent.idn]!.flows[flow.idn]!.skills[skill.idn] = skillMeta;
        }
      }
    }

    // Store project data in map
    existingMap.projects[project.idn] = projectData;
  }

  // Save updated project map
  await writeFileSafe(mapFile, JSON.stringify(existingMap, null, 2));

  // Save hashes
  await saveHashes(newHashes, customer.idn);

  // Generate flows.yaml
  await generateFlowsYaml(existingMap, customer.idn, verbose);
}

/**
 * Pull all projects for a customer
 */
export async function pullAll(
  client: AxiosInstance,
  customer: CustomerConfig,
  projectId: string | null = null,
  verbose: boolean = false,
  silentOverwrite: boolean = false
): Promise<void> {
  if (verbose) console.log(`🔄 Starting pull operation for customer ${customer.idn}...`);

  await pullSingleProject(client, customer, projectId, verbose, silentOverwrite);

  if (verbose) console.log(`✅ Pull completed for customer ${customer.idn}`);
}