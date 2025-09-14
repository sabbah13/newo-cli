import { 
  listProjects, 
  listAgents, 
  listFlowSkills, 
  updateSkill, 
  listFlowEvents, 
  listFlowStates, 
  getProjectMeta 
} from './api.js';
import { 
  ensureState, 
  skillPath, 
  writeFileSafe, 
  readIfExists, 
  mapPath,
  metadataPath,
  flowsYamlPath 
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
  CustomerConfig
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

  // Get and save project metadata
  const projectMeta = await getProjectMeta(client, projectId);
  await writeFileSafe(metadataPath(customer.idn, projectIdn), JSON.stringify(projectMeta, null, 2));
  if (verbose) console.log(`✓ Saved metadata for ${projectIdn}`);

  const projectMap: ProjectData = { projectId, projectIdn, agents: {} };

  for (const agent of agents) {
    const aKey = agent.idn;
    projectMap.agents[aKey] = { id: agent.id, flows: {} };

    for (const flow of agent.flows ?? []) {
      projectMap.agents[aKey]!.flows[flow.idn] = { id: flow.id, skills: {} };

      const skills = await listFlowSkills(client, flow.id);
      
      // Process skills concurrently with limited concurrency
      await Promise.all(skills.map(skill => concurrencyLimit(async () => {
        const file = skillPath(customer.idn, projectIdn, agent.idn, flow.idn, skill.idn, skill.runner_type);
        await writeFileSafe(file, skill.prompt_script || '');
        
        // Store complete skill metadata for push operations
        projectMap.agents[aKey]!.flows[flow.idn]!.skills[skill.idn] = {
          id: skill.id,
          title: skill.title,
          idn: skill.idn,
          runner_type: skill.runner_type,
          model: skill.model,
          parameters: [...skill.parameters],
          path: skill.path || undefined
        };
        console.log(`✓ Pulled ${file}`);
      })));
    }
  }

  // Generate flows.yaml for this project
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
    
    // Generate hash tracking for this project
    const hashes: HashStore = {};
    for (const [agentIdn, agentObj] of Object.entries(projectMap.agents)) {
      for (const [flowIdn, flowObj] of Object.entries(agentObj.flows)) {
        for (const [skillIdn, skillMeta] of Object.entries(flowObj.skills)) {
          const p = skillPath(customer.idn, projectMeta.idn, agentIdn, flowIdn, skillIdn, skillMeta.runner_type);
          const content = await fs.readFile(p, 'utf8');
          hashes[p] = sha256(content);
        }
      }
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

    // Collect hashes for this project
    for (const [agentIdn, agentObj] of Object.entries(projectMap.agents)) {
      for (const [flowIdn, flowObj] of Object.entries(agentObj.flows)) {
        for (const [skillIdn, skillMeta] of Object.entries(flowObj.skills)) {
          const p = skillPath(customer.idn, project.idn, agentIdn, flowIdn, skillIdn, skillMeta.runner_type);
          const content = await fs.readFile(p, 'utf8');
          allHashes[p] = sha256(content);
        }
      }
    }
  }

  await fs.writeJson(mapPath(customer.idn), idMap, { spaces: 2 });
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
          const p = projectIdn ? 
            skillPath(customer.idn, projectIdn, agentIdn, flowIdn, skillIdn, skillMeta.runner_type) :
            skillPath(customer.idn, '', agentIdn, flowIdn, skillIdn, skillMeta.runner_type);
          scanned++;
          if (verbose) console.log(`      📄 Checking: ${p}`);
          
          const content = await readIfExists(p);
          if (content === null) {
            if (verbose) console.log(`        ⚠️  File not found: ${p}`);
            continue;
          }
          
          const h = sha256(content);
          const oldHash = oldHashes[p];
          if (verbose) {
            console.log(`        🔍 Hash comparison:`);
            console.log(`          Old: ${oldHash || 'none'}`);
            console.log(`          New: ${h}`);
          }
          
          if (oldHash !== h) {
            if (verbose) console.log(`        🔄 File changed, preparing to push...`);
            
            // Create complete skill object with updated prompt_script
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
            
            if (verbose) {
              console.log(`        📤 Pushing skill object:`);
              console.log(`          ID: ${skillObject.id}`);
              console.log(`          Title: ${skillObject.title}`);
              console.log(`          IDN: ${skillObject.idn}`);
              console.log(`          Content length: ${content.length} chars`);
              console.log(`          Content preview: ${content.substring(0, 100).replace(/\n/g, '\\n')}...`);
            }
            
            await updateSkill(client, skillObject);
            console.log(`↑ Pushed ${p}`);
            newHashes[p] = h;
            pushed++;
          } else if (verbose) {
            console.log(`        ✓ No changes`);
          }
        }
      }
    }
  }

  if (verbose) console.log(`🔄 Scanned ${scanned} files, found ${pushed} changes`);
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
          const p = projectIdn ? 
            skillPath(customer.idn, projectIdn, agentIdn, flowIdn, skillIdn, skillMeta.runner_type) :
            skillPath(customer.idn, '', agentIdn, flowIdn, skillIdn, skillMeta.runner_type);
          const exists = await fs.pathExists(p);
          if (!exists) { 
            console.log(`D  ${p}`); 
            dirty++; 
            if (verbose) console.log(`      ❌ Deleted: ${p}`);
            continue; 
          }
          const content = await fs.readFile(p, 'utf8');
          const h = sha256(content);
          const oldHash = hashes[p];
          if (verbose) {
            console.log(`      📄 ${p}`);
            console.log(`        Old hash: ${oldHash || 'none'}`);
            console.log(`        New hash: ${h}`);
          }
          if (oldHash !== h) { 
            console.log(`M  ${p}`); 
            dirty++; 
            if (verbose) console.log(`      🔄 Modified: ${p}`);
          } else if (verbose) {
            console.log(`      ✓ Unchanged: ${p}`);
          }
        }
      }
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