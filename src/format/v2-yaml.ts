/**
 * V2 YAML parsers and generators
 *
 * Handles reading/writing the newo_v2 format YAML files:
 * - Flow YAML: {FlowIdn}.yaml (inline skill definitions, events, state_fields)
 * - Project YAML: {project_idn}.yaml
 * - Agent YAML: agent.yaml
 * - Library YAML: {library_idn}.yaml
 */
import fs from 'fs-extra';
import yaml from 'js-yaml';
import { patchYamlToPyyaml } from './yaml-patch.js';

// ── V2 Types ──

export interface V2InlineSkill {
  title: string;
  idn: string;
  prompt_script: string;
  runner_type: string;
  model: {
    model_idn: string;
    provider_idn: string;
  };
  parameters: Array<{ name: string; default_value: string }>;
}

export interface V2FlowEvent {
  idn: string;
  skill_selector: string;
  skill_idn: string | null;
  state_idn: string | null;
  integration_idn: string | null;
  connector_idn: string | null;
  interrupt_mode: string;
}

export interface V2StateField {
  title: string;
  idn: string;
  default_value: string;
  scope: string;
}

export interface V2FlowDefinition {
  title: string;
  idn: string;
  description: string | null;
  agent_id: string | null;
  skills: V2InlineSkill[];
  events: V2FlowEvent[];
  state_fields: V2StateField[];
  default_runner_type: string;
  default_provider_idn: string;
  default_model_idn: string;
  publication_type: string | null;
}

export interface V2ProjectMeta {
  idn: string;
  name: string;
  version: string;
  description: string;
  is_auto_update_enabled: boolean;
  registry: string;
  registry_item_idn: string;
}

export interface V2AgentMeta {
  idn: string;
  title: string | null;
  description: string | null;
}

export interface V2LibraryDefinition {
  title: string;
  idn: string;
  description: string | null;
  skills: V2InlineSkill[];
}

// ── Custom YAML tag for !enum values ──

const enumTag = new yaml.Type('!enum', {
  kind: 'scalar',
  resolve: () => true,
  construct: (data: string) => data,
  represent: (data: unknown) => String(data),
});

const V2_YAML_SCHEMA = yaml.DEFAULT_SCHEMA.extend([enumTag]);

// ── Shared YAML dump options ──

const YAML_DUMP_OPTIONS: yaml.DumpOptions = {
  indent: 2,
  quotingType: '"',
  forceQuotes: false,
  lineWidth: -1,
  noRefs: true,
  sortKeys: false,
  flowLevel: -1,
  schema: V2_YAML_SCHEMA,
};

// ── Skill sorting: CamelCase first, then _prefixed, then snake_case ──

function skillSortKey(idn: string): string {
  if (idn.startsWith('_')) {
    return `1_${idn}`; // _prefixed second
  }
  if (idn[0] && idn[0] === idn[0].toUpperCase()) {
    return `0_${idn}`; // CamelCase first
  }
  return `2_${idn}`; // snake_case last
}

/**
 * Sort skills in V2 export order (case-sensitive ASCII sort within groups):
 * 1. CamelCase (public) - case-sensitive alphabetically
 * 2. _prefixed (private) - case-sensitive alphabetically
 * 3. snake_case - case-sensitive alphabetically
 */
export function sortV2Skills<T extends { idn: string }>(skills: T[]): T[] {
  return [...skills].sort((a, b) => {
    const ka = skillSortKey(a.idn);
    const kb = skillSortKey(b.idn);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

/**
 * Sort parameters alphabetically by name (case-sensitive, V2 export order)
 */
export function sortV2Parameters<T extends { name: string }>(params: T[]): T[] {
  return [...params].sort((a, b) => {
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}

// ── Flow YAML ──

export async function parseV2FlowYaml(filePath: string): Promise<V2FlowDefinition> {
  const content = await fs.readFile(filePath, 'utf8');
  return yaml.load(content, { schema: V2_YAML_SCHEMA }) as V2FlowDefinition;
}

/**
 * Generate V2 flow YAML content from API data
 *
 * Produces the exact format found in the reference V2 export:
 *   title, idn, description, agent_id, skills[], events[], state_fields[],
 *   default_runner_type, default_provider_idn, default_model_idn, publication_type
 */
export function generateV2FlowYaml(
  flowIdn: string,
  flowTitle: string,
  flowDescription: string | null,
  defaultRunnerType: string,
  defaultProviderIdn: string,
  defaultModelIdn: string,
  skills: V2InlineSkill[],
  events: V2FlowEvent[],
  stateFields: V2StateField[]
): string {
  // Sort skills in V2 order and sort parameters within each skill
  const sortedSkills = sortV2Skills(skills).map(s => ({
    ...s,
    parameters: sortV2Parameters(s.parameters),
  }));

  // Sort events by idn, then skill_idn, then integration_idn, then connector_idn
  const sortedEvents = [...events].sort((a, b) => {
    if (a.idn !== b.idn) return a.idn < b.idn ? -1 : 1;
    const as = a.skill_idn || '';
    const bs = b.skill_idn || '';
    if (as !== bs) return as < bs ? -1 : 1;
    const ai = a.integration_idn || '';
    const bi = b.integration_idn || '';
    if (ai !== bi) return ai < bi ? -1 : 1;
    const ac = a.connector_idn || '';
    const bc = b.connector_idn || '';
    return ac < bc ? -1 : ac > bc ? 1 : 0;
  });
  // Sort state_fields alphabetically by idn
  const sortedStates = [...stateFields].sort((a, b) => a.idn < b.idn ? -1 : a.idn > b.idn ? 1 : 0);

  const flowDef: V2FlowDefinition = {
    title: flowTitle,
    idn: flowIdn,
    description: flowDescription ?? null,
    agent_id: null,
    skills: sortedSkills,
    events: sortedEvents,
    state_fields: sortedStates,
    default_runner_type: defaultRunnerType,
    default_provider_idn: defaultProviderIdn,
    default_model_idn: defaultModelIdn,
    publication_type: null,
  };

  // Flow YAML uses lineWidth: -1 (no wrapping) to keep prompt_script paths on one line
  // Then patch to convert double-quoted JSON values to single-quoted
  return patchYamlToPyyaml(yaml.dump(flowDef, { ...YAML_DUMP_OPTIONS, lineWidth: -1 }));
}

// ── Project YAML ──

export async function parseV2ProjectYaml(filePath: string): Promise<V2ProjectMeta> {
  const content = await fs.readFile(filePath, 'utf8');
  const parsed = yaml.load(content, { schema: V2_YAML_SCHEMA }) as { project: V2ProjectMeta };
  return parsed.project;
}

/**
 * Generate V2 project YAML
 *
 * Format:
 *   project:
 *     idn: naf
 *     name: naf
 *     version: 4.1.0
 *     description: ""
 *     is_auto_update_enabled: true
 *     registry: production
 *     registry_item_idn: naf
 */
export function generateV2ProjectYaml(meta: V2ProjectMeta): string {
  return yaml.dump({ project: meta }, YAML_DUMP_OPTIONS);
}

// ── Agent YAML ──

export async function parseV2AgentYaml(filePath: string): Promise<V2AgentMeta> {
  const content = await fs.readFile(filePath, 'utf8');
  const parsed = yaml.load(content, { schema: V2_YAML_SCHEMA }) as { agent: V2AgentMeta };
  return parsed.agent;
}

/**
 * Generate V2 agent YAML
 *
 * Format:
 *   agent:
 *     idn: TaskManager
 *     title: TaskManager
 *     description: null
 *
 * V2 export preserves description exactly as provided (null stays null, "" stays "")
 */
export function generateV2AgentYaml(meta: V2AgentMeta): string {
  return patchYamlToPyyaml(yaml.dump({ agent: meta }, YAML_DUMP_OPTIONS));
}

// ── Library YAML ──

export async function parseV2LibraryYaml(filePath: string): Promise<V2LibraryDefinition> {
  const content = await fs.readFile(filePath, 'utf8');
  return yaml.load(content, { schema: V2_YAML_SCHEMA }) as V2LibraryDefinition;
}

/**
 * Generate V2 library YAML
 *
 * Format:
 *   title: Test Library
 *   idn: testLib
 *   description: Shared utility library
 *   skills:
 *     - idn: utilSkill
 *       ...
 */
export function generateV2LibraryYaml(lib: V2LibraryDefinition): string {
  return yaml.dump(lib, YAML_DUMP_OPTIONS);
}

// ── Conversion helpers ──

/**
 * Build a V2InlineSkill entry from API skill data
 */
export function buildV2InlineSkill(
  skillIdn: string,
  skillTitle: string,
  runnerType: string,
  modelIdn: string,
  providerIdn: string,
  parameters: Array<{ name: string; default_value: string }>,
  promptScriptRelPath: string
): V2InlineSkill {
  return {
    title: skillTitle || '',
    idn: skillIdn,
    prompt_script: promptScriptRelPath,
    runner_type: runnerType,
    model: {
      model_idn: modelIdn,
      provider_idn: providerIdn,
    },
    parameters: parameters.map(p => ({
      name: p.name,
      default_value: p.default_value ?? '',
    })),
  };
}

/**
 * Build a V2FlowEvent entry from API event data
 */
export function buildV2FlowEvent(
  eventIdn: string,
  skillSelector: string,
  skillIdn: string | null,
  stateIdn: string | null,
  integrationIdn: string | null,
  connectorIdn: string | null,
  interruptMode: string
): V2FlowEvent {
  return {
    idn: eventIdn,
    skill_selector: skillSelector,
    skill_idn: skillIdn || null,
    state_idn: stateIdn || null,
    integration_idn: integrationIdn || null,
    connector_idn: connectorIdn || null,
    interrupt_mode: interruptMode,
  };
}

/**
 * Build a V2StateField entry from API state data
 */
export function buildV2StateField(
  stateIdn: string,
  stateTitle: string,
  defaultValue: string,
  scope: string
): V2StateField {
  return {
    title: stateTitle || '',
    idn: stateIdn,
    default_value: defaultValue ?? '',
    scope,
  };
}
