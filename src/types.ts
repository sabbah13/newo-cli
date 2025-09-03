/**
 * Comprehensive type definitions for NEWO CLI
 */

export interface NewoEnvironment {
  NEWO_BASE_URL?: string;
  NEWO_PROJECT_ID?: string;
  NEWO_API_KEY?: string;
  NEWO_ACCESS_TOKEN?: string;
  NEWO_REFRESH_TOKEN?: string;
  NEWO_REFRESH_URL?: string;
}

// Authentication Types
export interface TokenResponse {
  access_token?: string;
  token?: string;
  accessToken?: string;
  refresh_token?: string;
  refreshToken?: string;
  expires_in?: number;
  expiresIn?: number;
}

export interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

// API Response Types
export interface ProjectMeta {
  id: string;
  idn: string;
  title: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Agent {
  id: string;
  idn: string;
  title?: string;
  description?: string;
  flows?: Flow[];
}

export interface Flow {
  id: string;
  idn: string;
  title: string;
  description?: string;
  default_runner_type: RunnerType;
  default_model: ModelConfig;
}

export interface ModelConfig {
  model_idn: string;
  provider_idn: string;
}

export interface SkillParameter {
  name: string;
  default_value?: string;
}

export interface Skill {
  id: string;
  idn: string;
  title: string;
  prompt_script?: string;
  runner_type: RunnerType;
  model: ModelConfig;
  parameters: SkillParameter[];
  path?: string | undefined;
}

export interface FlowEvent {
  id: string;
  idn: string;
  description: string;
  skill_selector: SkillSelector;
  skill_idn?: string;
  state_idn?: string;
  integration_idn?: string;
  connector_idn?: string;
  interrupt_mode: InterruptMode;
}

export interface FlowState {
  id: string;
  idn: string;
  title: string;
  default_value?: string;
  scope: StateFieldScope;
}

// Enum Types
export type RunnerType = 'guidance' | 'nsl';
export type SkillSelector = 'first' | 'last' | 'random' | 'all';
export type InterruptMode = 'allow' | 'deny' | 'queue';
export type StateFieldScope = 'flow' | 'agent' | 'project' | 'global';

// File System Types
export interface SkillMetadata {
  id: string;
  title: string;
  idn: string;
  runner_type: RunnerType;
  model: ModelConfig;
  parameters: SkillParameter[];
  path?: string | undefined;
}

export interface FlowData {
  id: string;
  skills: Record<string, SkillMetadata>;
}

export interface AgentData {
  id: string;
  flows: Record<string, FlowData>;
}

export interface ProjectData {
  projectId: string;
  projectIdn: string;
  agents: Record<string, AgentData>;
}

export interface ProjectMap {
  projects: Record<string, ProjectData>;
}

// Legacy single-project format support
export interface LegacyProjectMap extends ProjectData {
  projects?: Record<string, ProjectData>;
}

export interface HashStore {
  [filePath: string]: string;
}

// AKB Types
export interface ParsedArticle {
  topic_name: string;
  persona_id: string | null;
  topic_summary: string;
  topic_facts: string[];
  confidence: number;
  source: string;
  labels: string[];
}

export interface AkbImportArticle extends Omit<ParsedArticle, 'persona_id'> {
  persona_id: string;
}

// CLI Types
export interface CliArgs {
  _: string[];
  verbose?: boolean;
  v?: boolean;
  [key: string]: unknown;
}

// flows.yaml Generation Types
export interface FlowsYamlSkill {
  idn: string;
  title: string;
  prompt_script: string;
  runner_type: string;
  model: ModelConfig;
  parameters: Array<{
    name: string;
    default_value: string;
  }>;
}

export interface FlowsYamlEvent {
  title: string;
  idn: string;
  skill_selector: string;
  skill_idn?: string | undefined;
  state_idn?: string | undefined;
  integration_idn?: string | undefined;
  connector_idn?: string | undefined;
  interrupt_mode: string;
}

export interface FlowsYamlState {
  title: string;
  idn: string;
  default_value?: string | undefined;
  scope: string;
}

export interface FlowsYamlFlow {
  idn: string;
  title: string;
  description: string | null;
  default_runner_type: string;
  default_provider_idn: string;
  default_model_idn: string;
  skills: FlowsYamlSkill[];
  events: FlowsYamlEvent[];
  state_fields: FlowsYamlState[];
}

export interface FlowsYamlAgent {
  agent_idn: string;
  agent_description?: string | undefined;
  agent_flows: FlowsYamlFlow[];
}

export interface FlowsYamlData {
  flows: FlowsYamlAgent[];
}

// HTTP Client Types
export interface AxiosClientConfig {
  baseURL?: string;
  headers?: Record<string, string>;
}

// Error Types
export interface NewoApiError extends Error {
  response?: {
    status: number;
    data: unknown;
  };
  config?: {
    method?: string;
    url?: string;
    headers?: Record<string, string>;
  };
}

// Status Types
export type FileStatus = 'M' | 'D' | 'clean';

export interface StatusResult {
  filePath: string;
  status: FileStatus;
  oldHash?: string;
  newHash?: string;
}