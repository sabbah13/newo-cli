/**
 * V2 (newo_v2) path utilities
 *
 * Generates paths for the NEWO platform export format:
 *   newo_customers/{cust}/
 *     import_version.txt
 *     attributes.yaml
 *     akb/{AgentIdn}.yaml
 *     {ProjectIdn}/
 *       {project_idn}.yaml
 *       attributes.yaml
 *       agents/{AgentIdn}/
 *         agent.yaml
 *         flows/{FlowIdn}/
 *           {FlowIdn}.yaml
 *           skills/{SkillIdn}.nsl|.nslg
 *       libraries/{LibIdn}/
 *         {lib_idn}.yaml
 *         skills/{SkillIdn}.nsl|.nslg
 */
import path from 'path';
import { NEWO_CUSTOMERS_DIR } from '../fsutil.js';
import type { RunnerType } from '../types.js';
import { getExtensionForFormat } from './extensions.js';

// ── Customer level ──

export function v2CustomerDir(customerIdn: string): string {
  return path.posix.join(NEWO_CUSTOMERS_DIR, customerIdn);
}

export function v2ImportVersionPath(customerIdn: string): string {
  return path.posix.join(v2CustomerDir(customerIdn), 'import_version.txt');
}

export function v2CustomerAttributesPath(customerIdn: string): string {
  return path.posix.join(v2CustomerDir(customerIdn), 'attributes.yaml');
}

// ── AKB level ──

export function v2AkbDir(customerIdn: string): string {
  return path.posix.join(v2CustomerDir(customerIdn), 'akb');
}

export function v2AkbPath(customerIdn: string, agentIdn: string): string {
  return path.posix.join(v2AkbDir(customerIdn), `${agentIdn}.yaml`);
}

// ── Project level ──

export function v2ProjectDir(customerIdn: string, projectIdn: string): string {
  return path.posix.join(v2CustomerDir(customerIdn), projectIdn);
}

export function v2ProjectYamlPath(customerIdn: string, projectIdn: string): string {
  return path.posix.join(v2ProjectDir(customerIdn, projectIdn), `${projectIdn}.yaml`);
}

export function v2ProjectAttributesPath(customerIdn: string, projectIdn: string): string {
  return path.posix.join(v2ProjectDir(customerIdn, projectIdn), 'attributes.yaml');
}

// ── Agent level ──

export function v2AgentDir(
  customerIdn: string,
  projectIdn: string,
  agentIdn: string
): string {
  return path.posix.join(v2ProjectDir(customerIdn, projectIdn), 'agents', agentIdn);
}

export function v2AgentYamlPath(
  customerIdn: string,
  projectIdn: string,
  agentIdn: string
): string {
  return path.posix.join(v2AgentDir(customerIdn, projectIdn, agentIdn), 'agent.yaml');
}

// ── Flow level ──

export function v2FlowDir(
  customerIdn: string,
  projectIdn: string,
  agentIdn: string,
  flowIdn: string
): string {
  return path.posix.join(
    v2AgentDir(customerIdn, projectIdn, agentIdn),
    'flows',
    flowIdn
  );
}

export function v2FlowYamlPath(
  customerIdn: string,
  projectIdn: string,
  agentIdn: string,
  flowIdn: string
): string {
  return path.posix.join(
    v2FlowDir(customerIdn, projectIdn, agentIdn, flowIdn),
    `${flowIdn}.yaml`
  );
}

// ── Skill level ──

export function v2SkillsDir(
  customerIdn: string,
  projectIdn: string,
  agentIdn: string,
  flowIdn: string
): string {
  return path.posix.join(
    v2FlowDir(customerIdn, projectIdn, agentIdn, flowIdn),
    'skills'
  );
}

export function v2SkillScriptPath(
  customerIdn: string,
  projectIdn: string,
  agentIdn: string,
  flowIdn: string,
  skillIdn: string,
  runnerType: RunnerType
): string {
  const ext = getExtensionForFormat(runnerType, 'newo_v2');
  return path.posix.join(
    v2SkillsDir(customerIdn, projectIdn, agentIdn, flowIdn),
    `${skillIdn}${ext}`
  );
}

/**
 * Build the relative prompt_script path as it appears in V2 flow YAML
 * e.g., "flows/MainFlow/skills/GreetingSkill.nsl"
 */
export function v2SkillRelativePath(
  flowIdn: string,
  skillIdn: string,
  runnerType: RunnerType
): string {
  const ext = getExtensionForFormat(runnerType, 'newo_v2');
  return `flows/${flowIdn}/skills/${skillIdn}${ext}`;
}

// ── Library level ──

export function v2LibraryDir(
  customerIdn: string,
  projectIdn: string,
  libraryIdn: string
): string {
  return path.posix.join(v2ProjectDir(customerIdn, projectIdn), 'libraries', libraryIdn);
}

export function v2LibraryYamlPath(
  customerIdn: string,
  projectIdn: string,
  libraryIdn: string
): string {
  return path.posix.join(
    v2LibraryDir(customerIdn, projectIdn, libraryIdn),
    `${libraryIdn}.yaml`
  );
}

export function v2LibrarySkillsDir(
  customerIdn: string,
  projectIdn: string,
  libraryIdn: string
): string {
  return path.posix.join(v2LibraryDir(customerIdn, projectIdn, libraryIdn), 'skills');
}

export function v2LibrarySkillScriptPath(
  customerIdn: string,
  projectIdn: string,
  libraryIdn: string,
  skillIdn: string,
  runnerType: RunnerType
): string {
  const ext = getExtensionForFormat(runnerType, 'newo_v2');
  return path.posix.join(
    v2LibrarySkillsDir(customerIdn, projectIdn, libraryIdn),
    `${skillIdn}${ext}`
  );
}

/**
 * Build relative prompt_script path for library skill in V2 YAML
 * The V2 export includes the project prefix:
 *   e.g., "naf/libraries/testLib/skills/utilSkill.nsl"
 */
export function v2LibrarySkillRelativePath(
  projectIdn: string,
  libraryIdn: string,
  skillIdn: string,
  runnerType: RunnerType
): string {
  const ext = getExtensionForFormat(runnerType, 'newo_v2');
  return `${projectIdn}/libraries/${libraryIdn}/skills/${skillIdn}${ext}`;
}
