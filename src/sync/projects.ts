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
  skillFolderPath,
  flowsYamlPath,
  customerAttributesPath
} from '../fsutil.js';
import {
  findSkillScriptFiles,
  isContentDifferent,
  askForOverwrite,
  getExtensionForRunner
} from './skill-files.js';
import type { OverwriteChoice } from './skill-files.js';
import fs from 'fs-extra';
import { sha256, saveHashes } from '../hash.js';
import yaml from 'js-yaml';
import { generateFlowsYaml } from './metadata.js';
import { saveCustomerAttributes } from './attributes.js';
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

  // Progress tracking and overwrite control
  let totalSkills = 0;
  let processedSkills = 0;
  let globalOverwriteAll = silentOverwrite;

  // Count total skills for progress tracking
  for (const project of projects) {
    const agents = await listAgents(client, project.id);
    for (const agent of agents) {
      const flows = agent.flows || [];
      for (const flow of flows) {
        const skills = await listFlowSkills(client, flow.id);
        totalSkills += skills.length;
      }
    }
  }

  if (verbose) console.log(`📊 Total skills to process: ${totalSkills}`);

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
          processedSkills++;
          const progress = `[${processedSkills}/${totalSkills}]`;

          if (verbose) {
            console.log(`      📄 ${progress} Processing skill: ${skill.title} (${skill.idn})`);
          } else {
            // Show progress for non-verbose mode
            if (processedSkills % 10 === 0 || processedSkills === totalSkills) {
              process.stdout.write(`\r📄 Processing skills: ${processedSkills}/${totalSkills} (${Math.round(processedSkills/totalSkills*100)}%)`);
            }
          }

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

          // Handle skill script with IDN-based naming and overwrite detection
          const scriptContent = skill.prompt_script || '';
          const targetScriptPath = skillScriptPath(customer.idn, project.idn, agent.idn, flow.idn, skill.idn, skill.runner_type);
          const folderPath = skillFolderPath(customer.idn, project.idn, agent.idn, flow.idn, skill.idn);

          // Check for existing script files in the skill folder
          const existingFiles = await findSkillScriptFiles(folderPath);
          let shouldWrite = true;
          let hasContentMatch = false;

          if (existingFiles.length > 0) {
            // Check if any existing file has the same content
            hasContentMatch = existingFiles.some(file => !isContentDifferent(file.content, scriptContent));

            if (hasContentMatch) {
              // Content is the same - handle file naming
              const matchingFile = existingFiles.find(file => !isContentDifferent(file.content, scriptContent));
              const correctName = `${skill.idn}.${getExtensionForRunner(skill.runner_type)}`;

              if (matchingFile && matchingFile.fileName !== correctName) {
                // Remove old file and write with correct IDN-based name
                await fs.remove(matchingFile.filePath);
                if (verbose) console.log(`        🔄 Renamed ${matchingFile.fileName} → ${correctName}`);
              } else if (matchingFile && matchingFile.fileName === correctName) {
                // Already has correct name and content - skip completely
                shouldWrite = false;
                newHashes[matchingFile.filePath] = sha256(scriptContent);
                if (verbose) console.log(`        ✓ Content unchanged for ${skill.idn}, keeping existing file`);
              }
            } else if (!globalOverwriteAll) {
              // Content is different, ask for overwrite unless global override is set
              const existingFile = existingFiles[0]!;
              const overwriteChoice: OverwriteChoice = await askForOverwrite(
                skill.idn,
                existingFile.fileName,
                `${skill.idn}.${getExtensionForRunner(skill.runner_type)}`
              );

              if (overwriteChoice === 'quit') {
                console.log('❌ Pull operation cancelled by user');
                process.exit(0);
              } else if (overwriteChoice === 'all') {
                globalOverwriteAll = true;
                // Continue with overwrite
                for (const file of existingFiles) {
                  await fs.remove(file.filePath);
                  if (verbose) console.log(`        🗑️  Removed ${file.fileName}`);
                }
              } else if (overwriteChoice === 'yes') {
                // Single overwrite
                for (const file of existingFiles) {
                  await fs.remove(file.filePath);
                  if (verbose) console.log(`        🗑️  Removed ${file.fileName}`);
                }
              } else {
                // User said no
                shouldWrite = false;
                if (verbose) console.log(`        ⚠️  Skipped overwrite for ${skill.idn}`);
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
            await writeFileSafe(targetScriptPath, scriptContent);
            newHashes[targetScriptPath] = sha256(scriptContent);
            const fileName = `${skill.idn}.${getExtensionForRunner(skill.runner_type)}`;
            if (verbose) console.log(`        ✓ Saved ${fileName}`);
          }

          projectData.agents[agent.idn]!.flows[flow.idn]!.skills[skill.idn] = skillMeta;
        }
      }
    }

    // Store project data in map
    existingMap.projects[project.idn] = projectData;
  }

  // Clear progress line for non-verbose mode
  if (!verbose && totalSkills > 0) {
    console.log(`\n✅ Processed ${totalSkills} skills`);
  }

  // Save updated project map
  await writeFileSafe(mapFile, JSON.stringify(existingMap, null, 2));

  // Pull customer attributes as part of the project pull
  try {
    if (verbose) console.log(`🔍 Fetching customer attributes for ${customer.idn}...`);
    const attributesContent = await saveCustomerAttributes(client, customer, verbose);

    // Add attributes.yaml hash to the hash store
    const attributesPath = customerAttributesPath(customer.idn);
    newHashes[attributesPath] = sha256(attributesContent);

    if (verbose) console.log(`✅ Customer attributes saved to newo_customers/${customer.idn}/attributes.yaml`);
  } catch (error) {
    console.warn(`⚠️  Failed to fetch customer attributes for ${customer.idn}: ${error instanceof Error ? error.message : String(error)}`);
    if (verbose) console.warn('You can manually pull attributes using: newo pull-attributes');
  }

  // Generate flows.yaml and get its content for hashing
  const flowsYamlContent = await generateFlowsYaml(existingMap, customer.idn, verbose);

  // Add flows.yaml hash to the hash store
  const flowsYamlFilePath = flowsYamlPath(customer.idn);
  newHashes[flowsYamlFilePath] = sha256(flowsYamlContent);

  // Save hashes (now including flows.yaml and attributes.yaml)
  await saveHashes(newHashes, customer.idn);
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