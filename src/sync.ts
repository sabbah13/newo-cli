import {
  listProjects,
  listAgents,
  listFlowSkills,
  updateSkill,
  listFlowEvents,
  listFlowStates,
  getProjectMeta,
  getCustomerAttributes,
  updateCustomerAttribute,
  listUserPersonas,
  getChatHistory
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
  customerAttributesMapPath,
  customerAttributesBackupPath
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
  CustomerAttribute,
  UserPersona,
  ConversationAct,
  ConversationOptions,
  ConversationsData,
  ProcessedPersona,
  ProcessedAct
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

    // Save all files: attributes.yaml, ID mapping, and backup for diff tracking
    await writeFileSafe(customerAttributesPath(customer.idn), yamlContent);
    await writeFileSafe(customerAttributesMapPath(customer.idn), JSON.stringify(idMapping, null, 2));
    await writeFileSafe(customerAttributesBackupPath(customer.idn), yamlContent);

    if (verbose) {
      console.log(`✓ Saved customer attributes to ${customerAttributesPath(customer.idn)}`);
      console.log(`✓ Saved attribute ID mapping to ${customerAttributesMapPath(customer.idn)}`);
      console.log(`✓ Created attributes backup for diff tracking`);
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

          // Track skill metadata.yaml file
          const metadataPath = skillMetadataPath(customer.idn, projectMeta.idn, agentIdn, flowIdn, skillIdn);
          if (await fs.pathExists(metadataPath)) {
            const metadataContent = await fs.readFile(metadataPath, 'utf8');
            hashes[metadataPath] = sha256(metadataContent);
          }

          // Also track legacy path for backwards compatibility during transition
          const legacyPath = skillPath(customer.idn, projectMeta.idn, agentIdn, flowIdn, skillIdn, skillMeta.runner_type);
          hashes[legacyPath] = sha256(content);
        }
      }
    }

    // Save customer attributes before hash tracking
    try {
      await saveCustomerAttributes(client, customer, verbose);

      // Add attributes.yaml to hash tracking
      const attributesFile = customerAttributesPath(customer.idn);
      if (await fs.pathExists(attributesFile)) {
        const attributesContent = await fs.readFile(attributesFile, 'utf8');
        hashes[attributesFile] = sha256(attributesContent);
        if (verbose) console.log(`✓ Added attributes.yaml to hash tracking`);
      }

      // Add flows.yaml to hash tracking
      const flowsFile = flowsYamlPath(customer.idn);
      if (await fs.pathExists(flowsFile)) {
        const flowsContent = await fs.readFile(flowsFile, 'utf8');
        hashes[flowsFile] = sha256(flowsContent);
        if (verbose) console.log(`✓ Added flows.yaml to hash tracking`);
      }
    } catch (error) {
      console.error(`❌ Failed to save customer attributes for ${customer.idn}:`, error);
      // Don't throw - continue with the rest of the process
    }

    await saveHashes(hashes, customer.idn);
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

          // Track skill metadata.yaml file
          const metadataPath = skillMetadataPath(customer.idn, project.idn, agentIdn, flowIdn, skillIdn);
          if (await fs.pathExists(metadataPath)) {
            const metadataContent = await fs.readFile(metadataPath, 'utf8');
            allHashes[metadataPath] = sha256(metadataContent);
          }

          // Also track legacy path for backwards compatibility during transition
          const legacyPath = skillPath(customer.idn, project.idn, agentIdn, flowIdn, skillIdn, skillMeta.runner_type);
          allHashes[legacyPath] = sha256(content);
        }
      }
    }
  }

  await fs.writeJson(mapPath(customer.idn), idMap, { spaces: 2 });

  // Save customer attributes before hash tracking
  try {
    await saveCustomerAttributes(client, customer, verbose);

    // Add attributes.yaml to hash tracking
    const attributesFile = customerAttributesPath(customer.idn);
    if (await fs.pathExists(attributesFile)) {
      const attributesContent = await fs.readFile(attributesFile, 'utf8');
      allHashes[attributesFile] = sha256(attributesContent);
      if (verbose) console.log(`✓ Added attributes.yaml to hash tracking`);
    }

    // Add flows.yaml to hash tracking
    const flowsFile = flowsYamlPath(customer.idn);
    if (await fs.pathExists(flowsFile)) {
      const flowsContent = await fs.readFile(flowsFile, 'utf8');
      allHashes[flowsFile] = sha256(flowsContent);
      if (verbose) console.log(`✓ Added flows.yaml to hash tracking`);
    }
  } catch (error) {
    console.error(`❌ Failed to save customer attributes for ${customer.idn}:`, error);
    // Don't throw - continue with the rest of the process
  }

  await saveHashes(allHashes, customer.idn);
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
  let metadataChanged = false;
  
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

  // Check for metadata-only changes (when metadata changed but script didn't)
  try {
    for (const [projectIdn, projectData] of Object.entries(projects)) {
      for (const [agentIdn, agentObj] of Object.entries(projectData.agents)) {
        for (const [flowIdn, flowObj] of Object.entries(agentObj.flows)) {
          for (const [skillIdn, skillMeta] of Object.entries(flowObj.skills)) {
            const metadataPath = projectIdn ?
              skillMetadataPath(customer.idn, projectIdn, agentIdn, flowIdn, skillIdn) :
              skillMetadataPath(customer.idn, '', agentIdn, flowIdn, skillIdn);

            if (await fs.pathExists(metadataPath)) {
              const metadataContent = await fs.readFile(metadataPath, 'utf8');
              const h = sha256(metadataContent);
              const oldHash = oldHashes[metadataPath];

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
  } catch (error) {
    if (verbose) console.log(`⚠️  Metadata push check failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (verbose) console.log(`🔄 Scanned ${scanned} files, found ${pushed} changes`);

  // Check for attributes changes and push specific changed attributes only
  try {
    const attributesFile = customerAttributesPath(customer.idn);
    const attributesMapFile = customerAttributesMapPath(customer.idn);
    const attributesBackupFile = customerAttributesBackupPath(customer.idn);

    if (await fs.pathExists(attributesFile) && await fs.pathExists(attributesMapFile)) {
      if (verbose) console.log('🔍 Checking customer attributes for changes...');

      const currentContent = await fs.readFile(attributesFile, 'utf8');

      // Check if backup exists for diff comparison
      if (await fs.pathExists(attributesBackupFile)) {
        const backupContent = await fs.readFile(attributesBackupFile, 'utf8');

        if (currentContent !== backupContent) {
          if (verbose) console.log(`🔄 Attributes file changed, analyzing differences...`);

          try {
            // Load ID mapping for push operations
            const idMapping = await fs.readJson(attributesMapFile) as Record<string, string>;

            // Parse both versions to find changed attributes
            const parseYaml = (content: string) => {
              let yamlContent = content.replace(/!enum "([^"]+)"/g, '"$1"');
              return yaml.load(yamlContent) as { attributes: any[] };
            };

            const currentData = parseYaml(currentContent);
            const backupData = parseYaml(backupContent);

            if (currentData?.attributes && backupData?.attributes) {
              // Create maps for comparison
              const currentAttrs = new Map(currentData.attributes.map(attr => [attr.idn, attr]));
              const backupAttrs = new Map(backupData.attributes.map(attr => [attr.idn, attr]));

              let attributesPushed = 0;

              // Find changed attributes
              for (const [idn, currentAttr] of currentAttrs) {
                const backupAttr = backupAttrs.get(idn);

                // Check if attribute changed (deep comparison of key fields)
                const hasChanged = !backupAttr ||
                  currentAttr.value !== backupAttr.value ||
                  currentAttr.title !== backupAttr.title ||
                  currentAttr.description !== backupAttr.description ||
                  currentAttr.group !== backupAttr.group ||
                  currentAttr.is_hidden !== backupAttr.is_hidden;

                if (hasChanged) {
                  const attributeId = idMapping[idn];
                  if (!attributeId) {
                    if (verbose) console.log(`⚠️  Skipping ${idn} - no ID mapping`);
                    continue;
                  }

                  // Create attribute object for push
                  const attributeToUpdate: CustomerAttribute = {
                    id: attributeId,
                    idn: currentAttr.idn,
                    value: currentAttr.value,
                    title: currentAttr.title || "",
                    description: currentAttr.description || "",
                    group: currentAttr.group || "",
                    is_hidden: currentAttr.is_hidden,
                    possible_values: currentAttr.possible_values || [],
                    value_type: currentAttr.value_type?.replace(/^"?AttributeValueTypes\.(.+)"?$/, '$1') || "string"
                  };

                  await updateCustomerAttribute(client, attributeToUpdate);
                  attributesPushed++;

                  if (verbose) {
                    console.log(`  ✓ Pushed changed attribute: ${idn}`);
                    console.log(`    Old value: ${backupAttr?.value || 'N/A'}`);
                    console.log(`    New value: ${currentAttr.value}`);
                  }
                }
              }

              if (attributesPushed > 0) {
                console.log(`↑ Pushed ${attributesPushed} changed customer attributes to NEWO API`);

                // Show summary of what was pushed
                console.log(`  📊 Pushed attributes:`);
                for (const [idn, currentAttr] of currentAttrs) {
                  const backupAttr = backupAttrs.get(idn);
                  const hasChanged = !backupAttr ||
                    currentAttr.value !== backupAttr.value ||
                    currentAttr.title !== backupAttr.title ||
                    currentAttr.description !== backupAttr.description ||
                    currentAttr.group !== backupAttr.group ||
                    currentAttr.is_hidden !== backupAttr.is_hidden;

                  if (hasChanged) {
                    console.log(`    • ${idn}: ${currentAttr.title || 'No title'}`);
                    console.log(`      Value: ${currentAttr.value}`);
                  }
                }

                // Update backup file after successful push
                await fs.writeFile(attributesBackupFile, currentContent, 'utf8');

                newHashes[attributesFile] = sha256(currentContent);
                pushed++;
              } else if (verbose) {
                console.log(`  ✓ No attribute value changes detected`);
              }

            } else {
              console.log(`⚠️  Failed to parse attributes for comparison`);
            }

          } catch (error) {
            console.error(`❌ Failed to push changed attributes: ${error instanceof Error ? error.message : String(error)}`);
            // Don't update hash/backup on failure so it will retry next time
          }
        } else if (verbose) {
          console.log(`  ✓ No attributes file changes`);
        }
      } else {
        // No backup exists, create initial backup
        await fs.writeFile(attributesBackupFile, currentContent, 'utf8');
        if (verbose) console.log(`✓ Created initial attributes backup for diff tracking`);
      }
    } else if (verbose) {
      console.log('ℹ️  No attributes file or ID mapping found for push checking');
    }
  } catch (error) {
    if (verbose) console.log(`⚠️  Attributes push check failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Regenerate flows.yaml if metadata changed
  if (metadataChanged) {
    try {
      if (verbose) console.log('🔄 Metadata changed, regenerating flows.yaml...');

      // Create backup of current flows.yaml for format comparison
      const flowsFile = flowsYamlPath(customer.idn);
      let flowsBackup = '';
      if (await fs.pathExists(flowsFile)) {
        flowsBackup = await fs.readFile(flowsFile, 'utf8');
        const backupPath = `${flowsFile}.backup`;
        await fs.writeFile(backupPath, flowsBackup, 'utf8');
        if (verbose) console.log(`✓ Created flows.yaml backup at ${backupPath}`);
      }

      // Re-fetch agents for flows.yaml regeneration
      const agentsForFlows: Agent[] = [];
      for (const projectData of Object.values(projects)) {
        const projectAgents = await listAgents(client, projectData.projectId);
        agentsForFlows.push(...projectAgents);
      }

      // Regenerate flows.yaml
      await generateFlowsYaml(client, customer, agentsForFlows, verbose);

      // Update flows.yaml hash
      if (await fs.pathExists(flowsFile)) {
        const newFlowsContent = await fs.readFile(flowsFile, 'utf8');
        newHashes[flowsFile] = sha256(newFlowsContent);

        // Compare format with backup
        if (flowsBackup) {
          const sizeDiff = newFlowsContent.length - flowsBackup.length;
          if (verbose) {
            console.log(`✓ Regenerated flows.yaml (size change: ${sizeDiff > 0 ? '+' : ''}${sizeDiff} chars)`);
          }
        }
      }

      console.log('↑ Regenerated flows.yaml due to metadata changes');

    } catch (error) {
      console.error(`❌ Failed to regenerate flows.yaml: ${error instanceof Error ? error.message : String(error)}`);
    }
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

        // Check metadata.yaml files for changes (after skill files)
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
                // Fallback to simple message
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
                  const backup = backupAttrs.get(idn);
                  console.log(`    • ${idn}: ${current?.title || 'No title'}`);
                  if (verbose) {
                    console.log(`      Old: ${backup?.value || 'N/A'}`);
                    console.log(`      New: ${current?.value || 'N/A'}`);
                  }
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

// Conversation sync functions

export async function pullConversations(
  client: AxiosInstance,
  customer: CustomerConfig,
  options: ConversationOptions = {},
  verbose: boolean = false
): Promise<void> {
  if (verbose) console.log(`💬 Fetching conversations for customer ${customer.idn}...`);

  try {
    // Get all user personas with pagination
    const allPersonas: UserPersona[] = [];
    let page = 1;
    const perPage = 50;
    let hasMore = true;

    while (hasMore) {
      const response = await listUserPersonas(client, page, perPage);
      allPersonas.push(...response.items);

      if (verbose) console.log(`📋 Page ${page}: Found ${response.items.length} personas (${allPersonas.length}/${response.metadata.total} total)`);

      hasMore = response.items.length === perPage && allPersonas.length < response.metadata.total;
      page++;
    }

    if (options.maxPersonas && allPersonas.length > options.maxPersonas) {
      allPersonas.splice(options.maxPersonas);
      if (verbose) console.log(`⚠️  Limited to ${options.maxPersonas} personas as requested`);
    }

    if (verbose) console.log(`👥 Processing ${allPersonas.length} personas...`);

    // Process personas concurrently with limited concurrency
    const processedPersonas: ProcessedPersona[] = [];

    await Promise.all(allPersonas.map(persona => concurrencyLimit(async () => {
      try {
        // Extract phone number from actors
        const phoneActor = persona.actors.find(actor =>
          actor.integration_idn === 'newo_voice' &&
          actor.connector_idn === 'newo_voice_connector' &&
          actor.contact_information?.startsWith('+')
        );
        const phone = phoneActor?.contact_information || null;

        // Get acts for this persona
        const allActs: ConversationAct[] = [];
        let actPage = 1;
        const actsPerPage = 100; // Higher limit for acts
        let hasMoreActs = true;

        // Get user actor IDs from persona actors first
        const userActors = persona.actors.filter(actor =>
          actor.integration_idn === 'newo_voice' &&
          actor.connector_idn === 'newo_voice_connector'
        );

        if (userActors.length === 0) {
          if (verbose) console.log(`  👤 ${persona.name}: No voice actors found, skipping`);
          // No voice actors, can't get chat history - add persona with empty acts
          processedPersonas.push({
            id: persona.id,
            name: persona.name,
            phone,
            act_count: persona.act_count,
            acts: []
          });
          if (verbose) console.log(`  ✓ Processed ${persona.name}: 0 acts (no voice actors)`);
          return; // Return from the concurrency function
        }

        // Safety mechanism to prevent infinite loops
        const maxPages = 50; // Limit to 50 pages (5000 acts max per persona)

        while (hasMoreActs && actPage <= maxPages) {
          try {
            const chatHistoryParams = {
              user_actor_id: userActors[0]!.id,
              page: actPage,
              per: actsPerPage
            };

            if (verbose) console.log(`    📄 ${persona.name}: Fetching page ${actPage}...`);
            const chatResponse = await getChatHistory(client, chatHistoryParams);

            if (chatResponse.items && chatResponse.items.length > 0) {
                // Convert chat history format to acts format - create minimal ConversationAct objects
                const convertedActs: ConversationAct[] = chatResponse.items.map((item: any) => ({
                  id: item.id || `chat_${Math.random()}`,
                  command_act_id: null,
                  external_event_id: item.external_event_id || 'chat_history',
                  arguments: [],
                  reference_idn: (item.is_agent === true) ? 'agent_message' : 'user_message',
                  runtime_context_id: item.runtime_context_id || 'chat_history',
                  source_text: item.payload?.text || item.message || item.content || item.text || '',
                  original_text: item.payload?.text || item.message || item.content || item.text || '',
                  datetime: item.datetime || item.created_at || item.timestamp || new Date().toISOString(),
                  user_actor_id: userActors[0]!.id,
                  agent_actor_id: null,
                  user_persona_id: persona.id,
                  user_persona_name: persona.name,
                  agent_persona_id: item.agent_persona_id || 'unknown',
                  external_id: item.external_id || null,
                  integration_idn: 'newo_voice',
                  connector_idn: 'newo_voice_connector',
                  to_integration_idn: null,
                  to_connector_idn: null,
                  is_agent: Boolean(item.is_agent === true),
                  project_idn: null,
                  flow_idn: item.flow_idn || 'unknown',
                  skill_idn: item.skill_idn || 'unknown',
                  session_id: item.session_id || 'unknown',
                  recordings: item.recordings || [],
                  contact_information: item.contact_information || null
                }));

                allActs.push(...convertedActs);

                if (verbose && convertedActs.length > 0) {
                  console.log(`  👤 ${persona.name}: Chat History - ${convertedActs.length} messages (${allActs.length} total)`);
                }

                // Check if we should continue paginating
                const hasMetadata = chatResponse.metadata?.total !== undefined;
                const currentTotal = chatResponse.metadata?.total || 0;

                hasMoreActs = chatResponse.items.length === actsPerPage &&
                             hasMetadata &&
                             allActs.length < currentTotal;

                actPage++;

                if (verbose) console.log(`    📊 ${persona.name}: Page ${actPage - 1} done, ${allActs.length}/${currentTotal} total acts`);
              } else {
                // No more items
                hasMoreActs = false;
                if (verbose) console.log(`    📊 ${persona.name}: No more chat history items`);
              }
          } catch (chatError) {
            if (verbose) console.log(`  ⚠️  Chat history failed for ${persona.name}: ${chatError instanceof Error ? chatError.message : String(chatError)}`);
            hasMoreActs = false;
          }
        }

        if (actPage > maxPages) {
          if (verbose) console.log(`  ⚠️  ${persona.name}: Reached max pages limit (${maxPages}), stopping pagination`);
        }

        // Sort acts by datetime ascending (chronological order)
        allActs.sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());

        // Process acts into simplified format - exclude redundant fields
        const processedActs: ProcessedAct[] = allActs.map(act => {
          const processedAct: ProcessedAct = {
            datetime: act.datetime,
            type: act.reference_idn,
            message: act.source_text
          };

          // Only include non-redundant fields
          if (act.contact_information) {
            (processedAct as any).contact_information = act.contact_information;
          }
          if (act.flow_idn && act.flow_idn !== 'unknown') {
            (processedAct as any).flow_idn = act.flow_idn;
          }
          if (act.skill_idn && act.skill_idn !== 'unknown') {
            (processedAct as any).skill_idn = act.skill_idn;
          }
          if (act.session_id && act.session_id !== 'unknown') {
            (processedAct as any).session_id = act.session_id;
          }

          return processedAct;
        });

        processedPersonas.push({
          id: persona.id,
          name: persona.name,
          phone,
          act_count: persona.act_count,
          acts: processedActs
        });

        if (verbose) console.log(`  ✓ Processed ${persona.name}: ${processedActs.length} acts`);
      } catch (error) {
        console.error(`❌ Failed to process persona ${persona.name}:`, error);
        // Continue with other personas
      }
    })));

    // Sort personas by most recent act time (descending) - use latest act from acts array
    processedPersonas.sort((a, b) => {
      const aLatestTime = a.acts.length > 0 ? a.acts[a.acts.length - 1]!.datetime : '1970-01-01T00:00:00.000Z';
      const bLatestTime = b.acts.length > 0 ? b.acts[b.acts.length - 1]!.datetime : '1970-01-01T00:00:00.000Z';
      return new Date(bLatestTime).getTime() - new Date(aLatestTime).getTime();
    });

    // Calculate totals
    const totalActs = processedPersonas.reduce((sum, persona) => sum + persona.acts.length, 0);

    // Create final conversations data
    const conversationsData: ConversationsData = {
      personas: processedPersonas,
      total_personas: processedPersonas.length,
      total_acts: totalActs,
      generated_at: new Date().toISOString()
    };

    // Save to YAML file
    const conversationsPath = `newo_customers/${customer.idn}/conversations.yaml`;
    const yamlContent = yaml.dump(conversationsData, {
      indent: 2,
      quotingType: '"',
      forceQuotes: false,
      lineWidth: 120,
      noRefs: true,
      sortKeys: false,
      flowLevel: -1
    });

    await writeFileSafe(conversationsPath, yamlContent);

    if (verbose) {
      console.log(`✓ Saved conversations to ${conversationsPath}`);
      console.log(`📊 Summary: ${processedPersonas.length} personas, ${totalActs} total acts`);
    }

  } catch (error) {
    console.error(`❌ Failed to pull conversations for ${customer.idn}:`, error);
    throw error;
  }
}