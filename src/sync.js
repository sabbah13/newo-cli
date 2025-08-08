import { listAgents, listFlowSkills, getSkill, updateSkill } from './api.js';
import { ensureState, skillPath, writeFileAtomic, readIfExists, MAP_PATH } from './fsutil.js';
import fs from 'fs-extra';
import { sha256, loadHashes, saveHashes } from './hash.js';

export async function pullAll(client, projectId) {
  await ensureState();
  const agents = await listAgents(client, projectId);

  const idMap = { projectId, agents: {} };

  for (const agent of agents) {
    const aKey = agent.idn;
    idMap.agents[aKey] = { id: agent.id, flows: {} };

    for (const flow of agent.flows ?? []) {
      idMap.agents[aKey].flows[flow.idn] = { id: flow.id, skills: {} };

      const skills = await listFlowSkills(client, flow.id);
      for (const s of skills) {
        const detail = await getSkill(client, s.id);
        const file = skillPath(agent.idn, flow.idn, s.idn);
        await writeFileAtomic(file, detail.prompt_script || '');
        idMap.agents[aKey].flows[flow.idn].skills[s.idn] = s.id;
        console.log(`✓ Pulled ${file}`);
      }
    }
  }

  await fs.writeJson(MAP_PATH, idMap, { spaces: 2 });

  const hashes = {};
  for (const [agentIdn, agentObj] of Object.entries(idMap.agents)) {
    for (const [flowIdn, flowObj] of Object.entries(agentObj.flows)) {
      for (const [skillIdn] of Object.entries(flowObj.skills)) {
        const p = skillPath(agentIdn, flowIdn, skillIdn);
        const content = await fs.readFile(p, 'utf8');
        hashes[p] = sha256(content);
      }
    }
  }
  await saveHashes(hashes);
}

export async function pushChanged(client) {
  await ensureState();
  if (!(await fs.pathExists(MAP_PATH))) {
    throw new Error('Missing .newo/map.json. Run `newo pull` first.');
  }
  const idMap = await fs.readJson(MAP_PATH);
  const oldHashes = await loadHashes();
  const newHashes = { ...oldHashes };

  let pushed = 0;
  for (const [agentIdn, agentObj] of Object.entries(idMap.agents)) {
    for (const [flowIdn, flowObj] of Object.entries(agentObj.flows)) {
      for (const [skillIdn, skillId] of Object.entries(flowObj.skills)) {
        const p = skillPath(agentIdn, flowIdn, skillIdn);
        const content = await readIfExists(p);
        if (content === null) continue;
        const h = sha256(content);
        if (oldHashes[p] !== h) {
          await updateSkill(client, skillId, content);
          console.log(`↑ Pushed ${p}`);
          newHashes[p] = h;
          pushed++;
        }
      }
    }
  }

  await saveHashes(newHashes);
  console.log(pushed ? `✅ Push complete. ${pushed} file(s) updated.` : '✅ Nothing to push.');
}

export async function status() {
  await ensureState();
  if (!(await fs.pathExists(MAP_PATH))) {
    console.log('No map. Run `newo pull` first.');
    return;
  }
  const idMap = await fs.readJson(MAP_PATH);
  const hashes = await loadHashes();
  let dirty = 0;

  for (const [agentIdn, agentObj] of Object.entries(idMap.agents)) {
    for (const [flowIdn, flowObj] of Object.entries(agentObj.flows)) {
      for (const [skillIdn] of Object.entries(flowObj.skills)) {
        const p = skillPath(agentIdn, flowIdn, skillIdn);
        const exists = await fs.pathExists(p);
        if (!exists) { console.log(`D  ${p}`); dirty++; continue; }
        const content = await fs.readFile(p, 'utf8');
        const h = sha256(content);
        if (hashes[p] !== h) { console.log(`M  ${p}`); dirty++; }
      }
    }
  }
  console.log(dirty ? `${dirty} changed file(s).` : 'Clean.');
}
