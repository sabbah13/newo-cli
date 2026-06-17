/**
 * Remote skill resolution by IDN path (project/agent/flow/skill).
 *
 * Used by `newo get-skill` and `newo update-skill` to address a single skill
 * on the platform without requiring a pulled local workspace.
 */
import type { AxiosInstance } from 'axios';
import { listProjects, listAgents, listFlowSkills, getSkill } from '../api.js';
import type { ProjectMeta, Agent, Flow, Skill } from '../types.js';

export interface RemoteSkillPath {
  projectIdn: string;
  agentIdn: string;
  flowIdn: string;
  skillIdn: string;
}

export interface ResolvedRemoteSkill {
  project: ProjectMeta;
  agent: Agent;
  flow: Flow;
  skill: Skill;
}

/**
 * Resolve a skill on the platform by its IDN path.
 * Throws descriptive errors listing available IDNs at the failing level.
 */
export async function resolveRemoteSkill(
  client: AxiosInstance,
  path: RemoteSkillPath
): Promise<ResolvedRemoteSkill> {
  const projects = await listProjects(client);
  const project = projects.find(p => p.idn === path.projectIdn);
  if (!project) {
    throw new Error(
      `Project '${path.projectIdn}' not found. Available projects: ${projects.map(p => p.idn).join(', ') || '(none)'}`
    );
  }

  const agents = await listAgents(client, project.id);
  const agent = agents.find(a => a.idn === path.agentIdn);
  if (!agent) {
    throw new Error(
      `Agent '${path.agentIdn}' not found in project '${path.projectIdn}'. Available agents: ${agents.map(a => a.idn).join(', ') || '(none)'}`
    );
  }

  const flows = agent.flows || [];
  const flow = flows.find(f => f.idn === path.flowIdn);
  if (!flow) {
    throw new Error(
      `Flow '${path.flowIdn}' not found in agent '${path.agentIdn}'. Available flows: ${flows.map(f => f.idn).join(', ') || '(none)'}`
    );
  }

  const skills = await listFlowSkills(client, flow.id);
  const skillStub = skills.find(s => s.idn === path.skillIdn);
  if (!skillStub) {
    throw new Error(
      `Skill '${path.skillIdn}' not found in flow '${path.flowIdn}'. Available skills: ${skills.map(s => s.idn).join(', ') || '(none)'}`
    );
  }

  // The flow-skills list endpoint already returns full skills including
  // prompt_script (pull relies on this). Only fall back to the by-id
  // endpoint when prompt_script is absent — and tolerate a 404 there,
  // since /api/v1/designer/skills/{id} is not available on all accounts.
  let skill = skillStub;
  if (skill.prompt_script === undefined || skill.prompt_script === null) {
    try {
      skill = await getSkill(client, skillStub.id);
    } catch {
      skill = skillStub;
    }
  }

  return { project, agent, flow, skill };
}

/**
 * Parse a `--model provider_idn/model_idn` flag value
 */
export function parseModelFlag(value: string): { provider_idn: string; model_idn: string } {
  const parts = value.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(
      `Invalid --model value '${value}'. Expected format: <provider_idn>/<model_idn> (e.g. openai/gpt4o)`
    );
  }
  return { provider_idn: parts[0], model_idn: parts[1] };
}
