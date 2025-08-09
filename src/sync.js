import { listAgents, listFlowSkills, updateSkill, listFlowEvents, listFlowStates } from './api.js';
import { ensureState, skillPath, writeFileAtomic, readIfExists, MAP_PATH } from './fsutil.js';
import fs from 'fs-extra';
import { sha256, loadHashes, saveHashes } from './hash.js';
import yaml from 'js-yaml';
import path from 'path';

export async function pullAll(client, projectId, verbose = false) {
  await ensureState();
  if (verbose) console.log(`🔍 Fetching agents for project ${projectId}...`);
  const agents = await listAgents(client, projectId);
  if (verbose) console.log(`📦 Found ${agents.length} agents`);

  const idMap = { projectId, agents: {} };

  for (const agent of agents) {
    const aKey = agent.idn;
    idMap.agents[aKey] = { id: agent.id, flows: {} };

    for (const flow of agent.flows ?? []) {
      idMap.agents[aKey].flows[flow.idn] = { id: flow.id, skills: {} };

      const skills = await listFlowSkills(client, flow.id);
      for (const s of skills) {
        const file = skillPath(agent.idn, flow.idn, s.idn, s.runner_type);
        await writeFileAtomic(file, s.prompt_script || '');
        // Store complete skill metadata for push operations
        idMap.agents[aKey].flows[flow.idn].skills[s.idn] = {
          id: s.id,
          title: s.title,
          idn: s.idn,
          runner_type: s.runner_type,
          model: s.model,
          parameters: s.parameters,
          path: s.path
        };
        console.log(`✓ Pulled ${file}`);
      }
    }
  }

  await fs.writeJson(MAP_PATH, idMap, { spaces: 2 });

  // Generate flows.yaml
  if (verbose) console.log('📄 Generating flows.yaml...');
  await generateFlowsYaml(client, agents, verbose);

  const hashes = {};
  for (const [agentIdn, agentObj] of Object.entries(idMap.agents)) {
    for (const [flowIdn, flowObj] of Object.entries(agentObj.flows)) {
      for (const [skillIdn, skillMeta] of Object.entries(flowObj.skills)) {
        const p = skillPath(agentIdn, flowIdn, skillIdn, skillMeta.runner_type);
        const content = await fs.readFile(p, 'utf8');
        hashes[p] = sha256(content);
      }
    }
  }
  await saveHashes(hashes);
}

export async function pushChanged(client, verbose = false) {
  await ensureState();
  if (!(await fs.pathExists(MAP_PATH))) {
    throw new Error('Missing .newo/map.json. Run `newo pull` first.');
  }
  
  if (verbose) console.log('📋 Loading project mapping...');
  const idMap = await fs.readJson(MAP_PATH);
  if (verbose) console.log('🔍 Loading file hashes...');
  const oldHashes = await loadHashes();
  const newHashes = { ...oldHashes };

  if (verbose) console.log('🔄 Scanning for changes...');
  let pushed = 0;
  let scanned = 0;
  
  for (const [agentIdn, agentObj] of Object.entries(idMap.agents)) {
    if (verbose) console.log(`  📁 Scanning agent: ${agentIdn}`);
    for (const [flowIdn, flowObj] of Object.entries(agentObj.flows)) {
      if (verbose) console.log(`    📁 Scanning flow: ${flowIdn}`);
      for (const [skillIdn, skillMeta] of Object.entries(flowObj.skills)) {
        const p = skillPath(agentIdn, flowIdn, skillIdn, skillMeta.runner_type);
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
            path: skillMeta.path
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

  if (verbose) console.log(`🔄 Scanned ${scanned} files, found ${pushed} changes`);
  await saveHashes(newHashes);
  console.log(pushed ? `✅ Push complete. ${pushed} file(s) updated.` : '✅ Nothing to push.');
}

export async function status(verbose = false) {
  await ensureState();
  if (!(await fs.pathExists(MAP_PATH))) {
    console.log('No map. Run `newo pull` first.');
    return;
  }
  
  if (verbose) console.log('📋 Loading project mapping and hashes...');
  const idMap = await fs.readJson(MAP_PATH);
  const hashes = await loadHashes();
  let dirty = 0;

  for (const [agentIdn, agentObj] of Object.entries(idMap.agents)) {
    if (verbose) console.log(`  📁 Checking agent: ${agentIdn}`);
    for (const [flowIdn, flowObj] of Object.entries(agentObj.flows)) {
      if (verbose) console.log(`    📁 Checking flow: ${flowIdn}`);
      for (const [skillIdn, skillMeta] of Object.entries(flowObj.skills)) {
        const p = skillPath(agentIdn, flowIdn, skillIdn, skillMeta.runner_type);
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
  console.log(dirty ? `${dirty} changed file(s).` : 'Clean.');
}

async function generateFlowsYaml(client, agents, verbose = false) {
  const flowsData = { flows: [] };

  for (const agent of agents) {
    if (verbose) console.log(`  📁 Processing agent: ${agent.idn}`);
    
    const agentFlows = [];
    
    for (const flow of agent.flows ?? []) {
      if (verbose) console.log(`    📄 Processing flow: ${flow.idn}`);
      
      // Get skills for this flow
      const skills = await listFlowSkills(client, flow.id);
      const skillsData = skills.map(skill => ({
        idn: skill.idn,
        title: skill.title || "",
        prompt_script: `flows/${flow.idn}/${skill.idn}.${skill.runner_type === 'nsl' ? 'jinja' : 'nsl'}`,
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
      let eventsData = [];
      try {
        const events = await listFlowEvents(client, flow.id);
        eventsData = events.map(event => ({
          title: event.description,
          idn: event.idn,
          skill_selector: `!enum "SkillSelector.${event.skill_selector}"`,
          skill_idn: event.skill_idn,
          state_idn: event.state_idn,
          integration_idn: event.integration_idn,
          connector_idn: event.connector_idn,
          interrupt_mode: `!enum "InterruptMode.${event.interrupt_mode}"`
        }));
        if (verbose) console.log(`      📋 Found ${events.length} events`);
      } catch (error) {
        if (verbose) console.log(`      ⚠️  No events found for flow ${flow.idn}`);
      }

      // Get state fields for this flow
      let stateFieldsData = [];
      try {
        const states = await listFlowStates(client, flow.id);
        stateFieldsData = states.map(state => ({
          title: state.title,
          idn: state.idn,
          default_value: state.default_value,
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

    flowsData.flows.push({
      agent_idn: agent.idn,
      agent_description: agent.description,
      agent_flows: agentFlows
    });
  }

  // Convert to YAML and write to file with custom enum handling
  let yamlContent = yaml.dump(flowsData, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
    forceQuotes: false
  });
  
  // Post-process to fix enum formatting
  yamlContent = yamlContent.replace(/"(!enum "[^"]+")"/g, '$1');
  
  const yamlPath = path.join('flows.yaml');
  await fs.writeFile(yamlPath, yamlContent, 'utf8');
  console.log(`✓ Generated flows.yaml`);
}