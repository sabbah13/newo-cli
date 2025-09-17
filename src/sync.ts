/**
 * NEWO CLI Sync Operations - Using modular architecture
 */

// Import core dependencies for remaining functions
import {
  listProjects,
  listAgents,
  listFlowSkills,
  updateSkill,
  listFlowEvents,
  listFlowStates
} from './api.js';
import {
  ensureState,
  skillPath,
  skillScriptPath,
  writeFileSafe,
  mapPath,
  projectMetadataPath,
  agentMetadataPath,
  flowMetadataPath,
  skillMetadataPath,
  flowsYamlPath
} from './fsutil.js';
import fs from 'fs-extra';
import { sha256, loadHashes, saveHashes } from './hash.js';
import yaml from 'js-yaml';
import type { AxiosInstance } from 'axios';
import type {
  ProjectData,
  ProjectMap,
  LegacyProjectMap,
  HashStore,
  FlowsYamlData,
  FlowsYamlFlow,
  FlowsYamlSkill,
  CustomerConfig,
  ProjectMetadata,
  AgentMetadata,
  FlowMetadata,
  SkillMetadata
} from './types.js';

// Re-export from refactored modules
export { saveCustomerAttributes } from './sync/attributes.js';
export { pullConversations } from './sync/conversations.js';
export { status } from './sync/status.js';

// Remaining functions that need to be extracted later

// Type guards for project map formats
function isProjectMap(x: unknown): x is ProjectMap {
  return typeof x === 'object' && x !== null && 'projects' in x;
}

function isLegacyProjectMap(x: unknown): x is LegacyProjectMap {
  return typeof x === 'object' && x !== null && 'projectId' in x && 'agents' in x;
}

export async function pullSingleProject(
  client: AxiosInstance,
  customer: CustomerConfig,
  projectId: string | null,
  verbose: boolean = false
): Promise<void> {
  // Keep the original implementation here for now
  // This would be extracted to sync/projects.ts in a future refactoring

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

          // Save skill script
          const scriptPath = skillScriptPath(customer.idn, project.idn, agent.idn, flow.idn, skill.idn, skill.runner_type);
          const scriptContent = skill.prompt_script || '';
          await writeFileSafe(scriptPath, scriptContent);
          newHashes[scriptPath] = sha256(scriptContent);

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

export async function pullAll(
  client: AxiosInstance,
  customer: CustomerConfig,
  projectId: string | null = null,
  verbose: boolean = false
): Promise<void> {
  if (verbose) console.log(`🔄 Starting pull operation for customer ${customer.idn}...`);

  await pullSingleProject(client, customer, projectId, verbose);

  if (verbose) console.log(`✅ Pull completed for customer ${customer.idn}`);
}

export async function pushChanged(client: AxiosInstance, customer: CustomerConfig, verbose: boolean = false): Promise<void> {
  // Keep the original implementation here for now
  // This would be extracted to sync/push.ts in a future refactoring

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

// Helper function for flows.yaml generation
async function generateFlowsYaml(
  projectMap: ProjectMap | { [key: string]: ProjectData },
  customerIdn: string,
  verbose: boolean = false
): Promise<void> {
  if (verbose) console.log(`📊 Generating flows.yaml for customer ${customerIdn}...`);

  const flowsData: FlowsYamlData = {
    flows: []
  };

  // Handle both formats
  const projects = 'projects' in projectMap ? projectMap.projects : projectMap;

  for (const [projectIdn, projectData] of Object.entries(projects)) {
    if (verbose && projectIdn) console.log(`  📁 Processing project: ${projectIdn}`);

    for (const [agentIdn, agentData] of Object.entries(projectData.agents as Record<string, any>)) {
      if (verbose) console.log(`    📁 Processing agent: ${agentIdn}`);

      const agentFlows: FlowsYamlFlow[] = [];

      for (const [flowIdn, flowData] of Object.entries(agentData.flows as Record<string, any>)) {
        if (verbose) console.log(`      📁 Processing flow: ${flowIdn}`);

        // Load flow metadata to get comprehensive flow information
        const flowMetaPath = flowMetadataPath(customerIdn, projectIdn, agentIdn, flowIdn);
        let flowMeta: FlowMetadata | null = null;

        try {
          if (await fs.pathExists(flowMetaPath)) {
            const flowMetaContent = await fs.readFile(flowMetaPath, 'utf8');
            flowMeta = yaml.load(flowMetaContent) as FlowMetadata;
          }
        } catch (e) {
          if (verbose) console.log(`        ⚠️  Could not load flow metadata: ${flowMetaPath}`);
        }

        const skills: FlowsYamlSkill[] = [];
        for (const [skillIdn, skillMeta] of Object.entries(flowData.skills as Record<string, SkillMetadata>)) {
          // Load skill script content
          const scriptPath = skillScriptPath(customerIdn, projectIdn, agentIdn, flowIdn, skillIdn, skillMeta.runner_type);
          let scriptContent = '';

          try {
            if (await fs.pathExists(scriptPath)) {
              scriptContent = await fs.readFile(scriptPath, 'utf8');
            }
          } catch (e) {
            if (verbose) console.log(`        ⚠️  Could not load script: ${scriptPath}`);
          }

          skills.push({
            idn: skillMeta.idn,
            title: skillMeta.title,
            prompt_script: scriptContent,
            runner_type: skillMeta.runner_type,
            model: skillMeta.model,
            parameters: skillMeta.parameters.map((p: any) => ({
              name: p.name,
              default_value: p.default_value || ''
            }))
          });
        }

        // Use flow metadata if available, otherwise use basic info
        const flowYaml: FlowsYamlFlow = {
          idn: flowIdn,
          title: flowMeta?.title || 'Unknown Flow',
          description: flowMeta?.description || null,
          default_runner_type: flowMeta?.default_runner_type || 'guidance',
          default_provider_idn: flowMeta?.default_model?.provider_idn || 'openai',
          default_model_idn: flowMeta?.default_model?.model_idn || 'gpt-4',
          skills,
          events: flowMeta?.events?.map(event => ({
            title: event.description,
            idn: event.idn,
            skill_selector: event.skill_selector,
            skill_idn: event.skill_idn || null,
            state_idn: event.state_idn || null,
            integration_idn: event.integration_idn || null,
            connector_idn: event.connector_idn || null,
            interrupt_mode: event.interrupt_mode
          })) || [],
          state_fields: flowMeta?.state_fields?.map(state => ({
            title: state.title,
            idn: state.idn,
            default_value: state.default_value || null,
            scope: state.scope
          })) || []
        };

        agentFlows.push(flowYaml);
      }

      if (agentFlows.length > 0) {
        // Load agent metadata for description
        const agentMetaPath = agentMetadataPath(customerIdn, projectIdn, agentIdn);
        let agentDescription: string | null = null;

        try {
          if (await fs.pathExists(agentMetaPath)) {
            const agentMetaContent = await fs.readFile(agentMetaPath, 'utf8');
            const agentMeta = yaml.load(agentMetaContent) as AgentMetadata;
            agentDescription = agentMeta.description || null;
          }
        } catch (e) {
          if (verbose) console.log(`      ⚠️  Could not load agent metadata: ${agentMetaPath}`);
        }

        flowsData.flows.push({
          agent_idn: agentIdn,
          agent_description: agentDescription,
          agent_flows: agentFlows
        });
      }
    }
  }

  // Save flows.yaml
  const flowsYamlContent = yaml.dump(flowsData, {
    indent: 2,
    quotingType: '"',
    forceQuotes: false,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
    flowLevel: -1
  });

  const flowsFilePath = flowsYamlPath(customerIdn);
  await writeFileSafe(flowsFilePath, flowsYamlContent);

  if (verbose) console.log(`✓ Generated flows.yaml with ${flowsData.flows.length} agents`);
}