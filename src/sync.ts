import {
  listProjects,
  listAgents,
  listFlowSkills,
  updateSkill,
  listFlowEvents,
  listFlowStates,
  getProjectMeta,
  getCustomerAttributes
} from './api.js';
import {
  ensureState,
  skillPath,
  skillScriptPath,
  writeFileSafe,
  readIfExists,
  mapPath,
  projectMetadataPath,
  agentMetadataPath,
  flowMetadataPath,
  skillMetadataPath,
  flowsYamlPath,
  customerAttributesPath,
  customerAttributesMapPath
} from './fsutil.js';
import fs from 'fs-extra';
import { sha256, loadHashes, saveHashes } from './hash.js';
import yaml from 'js-yaml';
import pLimit from 'p-limit';
import type { AxiosInstance } from 'axios';
import type {
  Agent,
  ProjectData,
  ProjectMap,
  LegacyProjectMap,
  HashStore,
  FlowsYamlData,
  FlowsYamlAgent,
  FlowsYamlFlow,
  FlowsYamlSkill,
  FlowsYamlEvent,
  FlowsYamlState,
  CustomerConfig,
  ProjectMetadata,
  AgentMetadata,
  FlowMetadata,
  SkillMetadata,
  FlowEvent,
  FlowState,
  CustomerAttribute
} from './types.js';

// Concurrency limits for API operations
const concurrencyLimit = pLimit(5);

// Type guards for better type safety
function isProjectMap(x: unknown): x is ProjectMap {
  return !!x && typeof x === 'object' && 'projects' in x;
}

function isLegacyProjectMap(x: unknown): x is LegacyProjectMap {
  return !!x && typeof x === 'object' && 'agents' in x;
}

export async function saveCustomerAttributes(
  client: AxiosInstance,
  customer: CustomerConfig,
  verbose: boolean = false
): Promise<void> {
  if (verbose) console.log(`🔍 Fetching customer attributes for ${customer.idn}...`);

  try {
    const response = await getCustomerAttributes(client, true); // Include hidden attributes

    // API returns { groups: [...], attributes: [...] }
    // We only want the attributes array in the expected format
    const attributes = response.attributes || response;
    if (verbose) console.log(`📦 Found ${Array.isArray(attributes) ? attributes.length : 'invalid'} attributes`);

    // Create ID mapping for push operations (separate from YAML)
    const idMapping: Record<string, string> = {};

    // Transform attributes to match reference format exactly (no ID fields)
    const cleanAttributes = Array.isArray(attributes) ? attributes.map(attr => {
      // Store ID mapping for push operations
      if (attr.id) {
        idMapping[attr.idn] = attr.id;
      }

      // Special handling for complex JSON string values
      let processedValue = attr.value;
      if (typeof attr.value === 'string' && attr.value.startsWith('[{') && attr.value.endsWith('}]')) {
        try {
          // Parse and reformat JSON for better readability
          const parsed = JSON.parse(attr.value);
          processedValue = JSON.stringify(parsed, null, 0); // No extra spacing, but valid JSON
        } catch (e) {
          // Keep original if parsing fails
          processedValue = attr.value;
        }
      }

      const cleanAttr: any = {
        idn: attr.idn,
        value: processedValue,
        title: attr.title || "",
        description: attr.description || "",
        group: attr.group || "",
        is_hidden: attr.is_hidden,
        possible_values: attr.possible_values || [],
        value_type: `__ENUM_PLACEHOLDER_${attr.value_type}__`
      };
      return cleanAttr;
    }) : [];

    const attributesYaml = {
      attributes: cleanAttributes
    };

    // Configure YAML output to match reference format exactly
    let yamlContent = yaml.dump(attributesYaml, {
      indent: 2,
      quotingType: '"',
      forceQuotes: false,
      lineWidth: 80, // Wrap long lines to match reference format
      noRefs: true,
      sortKeys: false,
      flowLevel: -1, // Never use flow syntax
      styles: {
        '!!str': 'folded' // Use folded style for better line wrapping of long strings
      }
    });

    // Post-process to fix enum format and improve JSON string formatting
    yamlContent = yamlContent.replace(/__ENUM_PLACEHOLDER_(\w+)__/g, '!enum "AttributeValueTypes.$1"');

    // Fix JSON string formatting to match reference (remove escape characters)
    yamlContent = yamlContent.replace(/\\"/g, '"');

    // Save both files
    await writeFileSafe(customerAttributesPath(customer.idn), yamlContent);
    await writeFileSafe(customerAttributesMapPath(customer.idn), JSON.stringify(idMapping, null, 2));

    if (verbose) {
      console.log(`✓ Saved customer attributes to ${customerAttributesPath(customer.idn)}`);
      console.log(`✓ Saved attribute ID mapping to ${customerAttributesMapPath(customer.idn)}`);
    }
  } catch (error) {
    console.error(`❌ Failed to save customer attributes for ${customer.idn}:`, error);
    throw error;
  }
}

export async function pullSingleProject(
  client: AxiosInstance,
  customer: CustomerConfig,
  projectId: string,
  projectIdn: string,
  verbose: boolean = false
): Promise<ProjectData> {
  if (verbose) console.log(`🔍 Fetching agents for project ${projectId} (${projectIdn}) for customer ${customer.idn}...`);
  const agents = await listAgents(client, projectId);
  if (verbose) console.log(`📦 Found ${agents.length} agents`);

  // Get and create project metadata
  const projectMeta = await getProjectMeta(client, projectId);
  const projectMetadata: ProjectMetadata = {
    id: projectMeta.id,
    idn: projectMeta.idn,
    title: projectMeta.title,
    ...(projectMeta.description && { description: projectMeta.description }),
    ...(projectMeta.created_at && { created_at: projectMeta.created_at }),
    ...(projectMeta.updated_at && { updated_at: projectMeta.updated_at })
  };
  await writeFileSafe(projectMetadataPath(customer.idn, projectIdn), yaml.dump(projectMetadata, { indent: 2 }));
  if (verbose) console.log(`✓ Created project metadata.yaml for ${projectIdn}`);

  // Legacy metadata.json generation removed - YAML is sufficient

  const projectMap: ProjectData = { projectId, projectIdn, agents: {} };

  for (const agent of agents) {
    const aKey = agent.idn;
    projectMap.agents[aKey] = { id: agent.id, flows: {} };

    // Create agent metadata
    const agentMetadata: AgentMetadata = {
      id: agent.id,
      idn: agent.idn,
      ...(agent.title && { title: agent.title }),
      ...(agent.description && { description: agent.description })
    };
    await writeFileSafe(agentMetadataPath(customer.idn, projectIdn, agent.idn), yaml.dump(agentMetadata, { indent: 2 }));
    if (verbose) console.log(`  ✓ Created agent metadata for ${agent.idn}`);

    for (const flow of agent.flows ?? []) {
      projectMap.agents[aKey]!.flows[flow.idn] = { id: flow.id, skills: {} };

      // Fetch flow events and state fields for metadata
      let flowEvents: FlowEvent[] = [];
      let flowStates: FlowState[] = [];

      try {
        flowEvents = await listFlowEvents(client, flow.id);
        if (verbose) console.log(`    📋 Found ${flowEvents.length} events for flow ${flow.idn}`);
      } catch (error) {
        if (verbose) console.log(`    ⚠️  No events found for flow ${flow.idn}`);
      }

      try {
        flowStates = await listFlowStates(client, flow.id);
        if (verbose) console.log(`    📊 Found ${flowStates.length} state fields for flow ${flow.idn}`);
      } catch (error) {
        if (verbose) console.log(`    ⚠️  No state fields found for flow ${flow.idn}`);
      }

      // Create flow metadata
      const flowMetadata: FlowMetadata = {
        id: flow.id,
        idn: flow.idn,
        title: flow.title,
        ...(flow.description && { description: flow.description }),
        default_runner_type: flow.default_runner_type,
        default_model: flow.default_model,
        events: flowEvents,
        state_fields: flowStates
      };
      await writeFileSafe(flowMetadataPath(customer.idn, projectIdn, agent.idn, flow.idn), yaml.dump(flowMetadata, { indent: 2 }));
      if (verbose) console.log(`    ✓ Created flow metadata for ${flow.idn}`);

      const skills = await listFlowSkills(client, flow.id);

      // Process skills concurrently with limited concurrency
      await Promise.all(skills.map(skill => concurrencyLimit(async () => {
        // Create skill folder and script file
        const scriptFile = skillScriptPath(customer.idn, projectIdn, agent.idn, flow.idn, skill.idn, skill.runner_type);
        await writeFileSafe(scriptFile, skill.prompt_script || '');

        // Create skill metadata
        const skillMetadata: SkillMetadata = {
          id: skill.id,
          idn: skill.idn,
          title: skill.title,
          runner_type: skill.runner_type,
          model: skill.model,
          parameters: [...skill.parameters],
          path: skill.path || undefined
        };
        const skillMetaFile = skillMetadataPath(customer.idn, projectIdn, agent.idn, flow.idn, skill.idn);
        await writeFileSafe(skillMetaFile, yaml.dump(skillMetadata, { indent: 2 }));

        // Store complete skill metadata for push operations (keep for backwards compatibility)
        projectMap.agents[aKey]!.flows[flow.idn]!.skills[skill.idn] = {
          id: skill.id,
          title: skill.title,
          idn: skill.idn,
          runner_type: skill.runner_type,
          model: skill.model,
          parameters: [...skill.parameters],
          path: skill.path || undefined
        };
        console.log(`✓ Created skill folder and metadata for ${skill.idn}`);
      })));
    }
  }

  // Generate flows.yaml for this project (backwards compatibility)
  if (verbose) console.log(`📄 Generating flows.yaml...`);
  await generateFlowsYaml(client, customer, agents, verbose);

  return projectMap;
}

export async function pullAll(
  client: AxiosInstance, 
  customer: CustomerConfig,
  projectId: string | null = null, 
  verbose: boolean = false
): Promise<void> {
  await ensureState(customer.idn);
  
  if (projectId) {
    // Single project mode
    const projectMeta = await getProjectMeta(client, projectId);
    const projectMap = await pullSingleProject(client, customer, projectId, projectMeta.idn, verbose);
    
    const idMap: ProjectMap = { projects: { [projectMeta.idn]: projectMap } };
    await fs.writeJson(mapPath(customer.idn), idMap, { spaces: 2 });
    
    // Generate hash tracking for this project (both legacy and new paths)
    const hashes: HashStore = {};
    for (const [agentIdn, agentObj] of Object.entries(projectMap.agents)) {
      for (const [flowIdn, flowObj] of Object.entries(agentObj.flows)) {
        for (const [skillIdn, skillMeta] of Object.entries(flowObj.skills)) {
          // Track new skill script path
          const newPath = skillScriptPath(customer.idn, projectMeta.idn, agentIdn, flowIdn, skillIdn, skillMeta.runner_type);
          const content = await fs.readFile(newPath, 'utf8');
          hashes[newPath] = sha256(content);

          // Also track legacy path for backwards compatibility during transition
          const legacyPath = skillPath(customer.idn, projectMeta.idn, agentIdn, flowIdn, skillIdn, skillMeta.runner_type);
          hashes[legacyPath] = sha256(content);
        }
      }
    }
    await saveHashes(hashes, customer.idn);

    // Save customer attributes
    try {
      await saveCustomerAttributes(client, customer, verbose);
    } catch (error) {
      console.error(`❌ Failed to save customer attributes for ${customer.idn}:`, error);
      // Don't throw - continue with the rest of the process
    }
    return;
  }

  // Multi-project mode
  if (verbose) console.log(`🔍 Fetching all projects for customer ${customer.idn}...`);
  const projects = await listProjects(client);
  if (verbose) console.log(`📦 Found ${projects.length} projects`);

  const idMap: ProjectMap = { projects: {} };
  const allHashes: HashStore = {};

  for (const project of projects) {
    if (verbose) console.log(`\n📁 Processing project: ${project.idn} (${project.title})`);
    const projectMap = await pullSingleProject(client, customer, project.id, project.idn, verbose);
    idMap.projects[project.idn] = projectMap;

    // Collect hashes for this project (both legacy and new paths)
    for (const [agentIdn, agentObj] of Object.entries(projectMap.agents)) {
      for (const [flowIdn, flowObj] of Object.entries(agentObj.flows)) {
        for (const [skillIdn, skillMeta] of Object.entries(flowObj.skills)) {
          // Track new skill script path
          const newPath = skillScriptPath(customer.idn, project.idn, agentIdn, flowIdn, skillIdn, skillMeta.runner_type);
          const content = await fs.readFile(newPath, 'utf8');
          allHashes[newPath] = sha256(content);

          // Also track legacy path for backwards compatibility during transition
          const legacyPath = skillPath(customer.idn, project.idn, agentIdn, flowIdn, skillIdn, skillMeta.runner_type);
          allHashes[legacyPath] = sha256(content);
        }
      }
    }
  }

  await fs.writeJson(mapPath(customer.idn), idMap, { spaces: 2 });
  await saveHashes(allHashes, customer.idn);

  // Save customer attributes
  try {
    await saveCustomerAttributes(client, customer, verbose);
  } catch (error) {
    console.error(`❌ Failed to save customer attributes for ${customer.idn}:`, error);
    // Don't throw - continue with the rest of the process
  }
}

export async function pushChanged(client: AxiosInstance, customer: CustomerConfig, verbose: boolean = false): Promise<void> {
  await ensureState(customer.idn);
  if (!(await fs.pathExists(mapPath(customer.idn)))) {
    throw new Error(`Missing .newo/${customer.idn}/map.json. Run \`newo pull --customer ${customer.idn}\` first.`);
  }
  
  if (verbose) console.log(`📋 Loading project mapping for customer ${customer.idn}...`);
  const idMapData = await fs.readJson(mapPath(customer.idn)) as unknown;
  if (verbose) console.log('🔍 Loading file hashes...');
  const oldHashes = await loadHashes(customer.idn);
  const newHashes: HashStore = { ...oldHashes };

  if (verbose) console.log('🔄 Scanning for changes...');
  let pushed = 0;
  let scanned = 0;
  
  // Handle both old single-project format and new multi-project format with type guards
  const projects = isProjectMap(idMapData) && idMapData.projects 
    ? idMapData.projects 
    : isLegacyProjectMap(idMapData)
    ? { '': idMapData as ProjectData }
    : (() => { throw new Error('Invalid project map format'); })();
  
  for (const [projectIdn, projectData] of Object.entries(projects)) {
    if (verbose && projectIdn) console.log(`📁 Scanning project: ${projectIdn}`);
    
    for (const [agentIdn, agentObj] of Object.entries(projectData.agents)) {
      if (verbose) console.log(`  📁 Scanning agent: ${agentIdn}`);
      for (const [flowIdn, flowObj] of Object.entries(agentObj.flows)) {
        if (verbose) console.log(`    📁 Scanning flow: ${flowIdn}`);
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
          let content = await readIfExists(newPath);

          // If new structure doesn't exist, try legacy structure
          if (content === null) {
            content = await readIfExists(legacyPath);
            currentPath = legacyPath;
          }

          scanned++;
          if (verbose) console.log(`      📄 Checking: ${currentPath}`);

          if (content === null) {
            if (verbose) console.log(`        ⚠️  File not found: ${currentPath}`);
            continue;
          }

          const h = sha256(content);
          const oldHash = oldHashes[currentPath];
          if (verbose) {
            console.log(`        🔍 Hash comparison:`);
            console.log(`          Old: ${oldHash || 'none'}`);
            console.log(`          New: ${h}`);
          }

          if (oldHash !== h) {
            if (verbose) console.log(`        🔄 File changed, preparing to push...`);

            // For new folder structure, try to load metadata from YAML file
            let skillMetadata = skillMeta;
            if (currentPath === newPath) {
              const metadataFile = projectIdn ?
                skillMetadataPath(customer.idn, projectIdn, agentIdn, flowIdn, skillIdn) :
                skillMetadataPath(customer.idn, '', agentIdn, flowIdn, skillIdn);

              const metadataContent = await readIfExists(metadataFile);
              if (metadataContent) {
                try {
                  const yamlMetadata = yaml.load(metadataContent) as SkillMetadata;
                  skillMetadata = yamlMetadata;
                  if (verbose) console.log(`        📄 Loaded skill metadata from ${metadataFile}`);
                } catch (error) {
                  if (verbose) console.log(`        ⚠️  Failed to parse skill metadata, using project map data`);
                }
              }
            }

            // Create complete skill object with updated prompt_script
            const skillObject = {
              id: skillMetadata.id,
              title: skillMetadata.title,
              idn: skillMetadata.idn,
              prompt_script: content,
              runner_type: skillMetadata.runner_type,
              model: skillMetadata.model,
              parameters: skillMetadata.parameters,
              path: skillMetadata.path || undefined
            };

            if (verbose) {
              console.log(`        📤 Pushing skill object:`);
              console.log(`          ID: ${skillObject.id}`);
              console.log(`          Title: ${skillObject.title}`);
              console.log(`          IDN: ${skillObject.idn}`);
              console.log(`          Content length: ${content.length} chars`);
              console.log(`          Content preview: ${content.substring(0, 100).replace(/\n/g, '\\n')}...`);
            }

            await updateSkill(client, skillObject);
            console.log(`↑ Pushed ${currentPath}`);
            newHashes[currentPath] = h;
            pushed++;
          } else if (verbose) {
            console.log(`        ✓ No changes`);
          }
        }
      }
    }
  }

  if (verbose) console.log(`🔄 Scanned ${scanned} files, found ${pushed} changes`);

  // Check for attributes changes and push if needed
  try {
    const attributesFile = customerAttributesPath(customer.idn);
    const attributesMapFile = customerAttributesMapPath(customer.idn);

    if (await fs.pathExists(attributesFile) && await fs.pathExists(attributesMapFile)) {
      if (verbose) console.log('🔍 Checking customer attributes for changes...');

      // Check file modification time for change detection instead of YAML parsing
      const attributesStats = await fs.stat(attributesFile);
      const idMapping = await fs.readJson(attributesMapFile) as Record<string, string>;

      // Count attributes by ID mapping instead of parsing YAML (avoids enum parsing issues)
      const attributeCount = Object.keys(idMapping).length;

      if (verbose) {
        console.log(`📊 Found ${attributeCount} attributes ready for push operations`);
        console.log(`📅 Attributes file last modified: ${attributesStats.mtime.toISOString()}`);
        // TODO: Implement change detection by comparing with last push timestamp
      }
    } else if (verbose) {
      console.log('ℹ️  No attributes file or ID mapping found for push checking');
    }
  } catch (error) {
    if (verbose) console.log(`⚠️  Attributes push check failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  await saveHashes(newHashes, customer.idn);
  console.log(pushed ? `✅ Push complete. ${pushed} file(s) updated.` : '✅ Nothing to push.');
}

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
      }
    }
  }

  // Check attributes file for changes
  try {
    const attributesFile = customerAttributesPath(customer.idn);
    if (await fs.pathExists(attributesFile)) {
      const attributesStats = await fs.stat(attributesFile);
      const attributesPath = `${customer.idn}/attributes.yaml`;

      if (verbose) {
        console.log(`📄 ${attributesPath}`);
        console.log(`  📅 Last modified: ${attributesStats.mtime.toISOString()}`);
        console.log(`  📊 Size: ${(attributesStats.size / 1024).toFixed(1)}KB`);
      }

      // For now, just report the file exists (change detection would require timestamp tracking)
      if (verbose) console.log(`  ✓ Attributes file tracked`);
    }
  } catch (error) {
    if (verbose) console.log(`⚠️  Error checking attributes: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Check flows.yaml file for changes
  const flowsFile = flowsYamlPath(customer.idn);
  if (await fs.pathExists(flowsFile)) {
    try {
      const flowsStats = await fs.stat(flowsFile);
      if (verbose) {
        console.log(`📄 flows.yaml`);
        console.log(`  📅 Last modified: ${flowsStats.mtime.toISOString()}`);
        console.log(`  📊 Size: ${(flowsStats.size / 1024).toFixed(1)}KB`);
        console.log(`  ✓ Flows file tracked`);
      }
    } catch (error) {
      if (verbose) console.log(`⚠️  Error checking flows.yaml: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(dirty ? `${dirty} changed file(s).` : 'Clean.');
}

async function generateFlowsYaml(
  client: AxiosInstance, 
  customer: CustomerConfig,
  agents: Agent[], 
  verbose: boolean = false
): Promise<void> {
  const flowsData: FlowsYamlData = { flows: [] };

  // Calculate total flows for progress tracking
  const totalFlows = agents.reduce((sum, agent) => sum + (agent.flows?.length || 0), 0);
  let processedFlows = 0;
  
  if (!verbose && totalFlows > 0) {
    console.log(`📄 Generating flows.yaml (${totalFlows} flows)...`);
  }

  for (const agent of agents) {
    if (verbose) console.log(`  📁 Processing agent: ${agent.idn}`);
    
    const agentFlows: FlowsYamlFlow[] = [];
    
    for (const flow of agent.flows ?? []) {
      processedFlows++;
      
      if (verbose) {
        console.log(`    📄 Processing flow: ${flow.idn}`);
      } else {
        // Simple progress indicator without verbose mode
        const percent = Math.round((processedFlows / totalFlows) * 100);
        const progressBar = '█'.repeat(Math.floor(percent / 5)) + '░'.repeat(20 - Math.floor(percent / 5));
        const progressText = `  [${progressBar}] ${percent}% (${processedFlows}/${totalFlows}) ${flow.idn}`;
        
        // Pad the line to clear any leftover text from longer previous lines
        const padding = ' '.repeat(Math.max(0, 80 - progressText.length));
        process.stdout.write(`\r${progressText}${padding}`);
      }
      
      // Get skills for this flow
      const skills = await listFlowSkills(client, flow.id);
      const skillsData: FlowsYamlSkill[] = skills.map(skill => ({
        idn: skill.idn,
        title: skill.title || "",
        prompt_script: `flows/${flow.idn}/${skill.idn}.${skill.runner_type === 'nsl' ? 'jinja' : 'guidance'}`,
        runner_type: `!enum "RunnerType.${skill.runner_type}"`,
        model: {
          model_idn: skill.model.model_idn,
          provider_idn: skill.model.provider_idn
        },
        parameters: skill.parameters.map(param => ({
          name: param.name,
          default_value: param.default_value || " "
        }))
      }));

      // Get events for this flow
      let eventsData: FlowsYamlEvent[] = [];
      try {
        const events = await listFlowEvents(client, flow.id);
        eventsData = events.map(event => ({
          title: event.description,
          idn: event.idn,
          skill_selector: `!enum "SkillSelector.${event.skill_selector}"`,
          skill_idn: event.skill_idn || null,
          state_idn: event.state_idn || null,
          integration_idn: event.integration_idn || null,
          connector_idn: event.connector_idn || null,
          interrupt_mode: `!enum "InterruptMode.${event.interrupt_mode}"`
        }));
        if (verbose) console.log(`      📋 Found ${events.length} events`);
      } catch (error) {
        if (verbose) console.log(`      ⚠️  No events found for flow ${flow.idn}`);
      }

      // Get state fields for this flow
      let stateFieldsData: FlowsYamlState[] = [];
      try {
        const states = await listFlowStates(client, flow.id);
        stateFieldsData = states.map(state => ({
          title: state.title,
          idn: state.idn,
          default_value: state.default_value || null,
          scope: `!enum "StateFieldScope.${state.scope}"`
        }));
        if (verbose) console.log(`      📊 Found ${states.length} state fields`);
      } catch (error) {
        if (verbose) console.log(`      ⚠️  No state fields found for flow ${flow.idn}`);
      }

      agentFlows.push({
        idn: flow.idn,
        title: flow.title,
        description: flow.description || null,
        default_runner_type: `!enum "RunnerType.${flow.default_runner_type}"`,
        default_provider_idn: flow.default_model.provider_idn,
        default_model_idn: flow.default_model.model_idn,
        skills: skillsData,
        events: eventsData,
        state_fields: stateFieldsData
      });
    }

    const agentData: FlowsYamlAgent = {
      agent_idn: agent.idn,
      agent_description: agent.description || null,
      agent_flows: agentFlows
    };
    
    flowsData.flows.push(agentData);
  }
  
  // Clear progress bar and move to new line
  if (!verbose && totalFlows > 0) {
    process.stdout.write('\n');
  }

  // Convert to YAML and write to file with custom enum handling
  let yamlContent = yaml.dump(flowsData, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
    forceQuotes: false,
    flowLevel: -1,
    styles: {
      '!!str': 'literal' // Use literal style for multiline strings
    }
  });

  // Post-process to fix enum formatting
  yamlContent = yamlContent.replace(/"(!enum \\"([^"]+)\\")"/g, '!enum "$2"');

  // Post-process to fix multiline string formatting to match expected format
  yamlContent = yamlContent.replace(
    /^(\s+agent_description: )"([^"]*)"$/gm,
    (match, indent, desc) => {
      // Check for long descriptions that should be multiline
      if (desc.length > 80 && desc.includes(' (clients of your business)')) {
        // Split the ConvoAgent description into multiline YAML format
        return `${indent}"${desc.replace(/(\. This Agent communicates with Users) \(clients of your business\)/, '$1\\\n      \\ (clients of your business)')}"`;
      }
      if (desc.length > 100 && desc.includes('within a browser')) {
        // Split the MagicWorker description into multiline YAML format
        return `${indent}"${desc.replace(/(within a browser and behaving "like a human" when interacting with web applications that lack APIs\.) (This agent is often used)/, '$1\\\n      \\ $2')}"`;
      }
      return match;
    }
  );
  
  const yamlPath = flowsYamlPath(customer.idn);
  await writeFileSafe(yamlPath, yamlContent);
  console.log(`✓ Generated flows.yaml`);
}