/**
 * Comprehensive type definitions for NEWO CLI
 */

export interface NewoEnvironment {
  NEWO_BASE_URL?: string;
  NEWO_PROJECT_ID?: string;
  NEWO_API_KEY?: string;
  NEWO_API_KEYS?: string; // JSON string containing array of keys or key objects
  NEWO_ACCESS_TOKEN?: string;
  NEWO_REFRESH_TOKEN?: string;
  NEWO_REFRESH_URL?: string;
  NEWO_DEFAULT_CUSTOMER?: string;
  // Dynamic customer entries will be detected at runtime
  [key: string]: string | undefined;
}

export interface ApiKeyConfig {
  key: string;
  project_id?: string;
}

export interface CustomerConfig {
  idn: string;
  apiKey: string;
  projectId?: string | undefined;
}

export interface CustomerProfile {
  id: string;
  idn: string;
  organization_name: string;
  email: string;
  [key: string]: any;
}

export interface MultiCustomerConfig {
  customers: Record<string, CustomerConfig>;
  defaultCustomer?: string | undefined;
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
  readonly id: string;
  readonly idn: string;
  readonly title: string;
  readonly description?: string;
  readonly created_at?: string;
  readonly updated_at?: string;
}

export interface Agent {
  readonly id: string;
  readonly idn: string;
  readonly title?: string;
  readonly description?: string;
  readonly flows?: readonly Flow[];
}

export interface Flow {
  readonly id: string;
  readonly idn: string;
  readonly title: string;
  readonly description?: string;
  readonly default_runner_type: RunnerType;
  readonly default_model: ModelConfig;
}

export interface ModelConfig {
  readonly model_idn: string;
  readonly provider_idn: string;
}

export interface SkillParameter {
  readonly name: string;
  readonly default_value?: string;
}

export interface Skill {
  readonly id: string;
  readonly idn: string;
  readonly title: string;
  prompt_script?: string; // Mutable for updates
  readonly runner_type: RunnerType;
  readonly model: ModelConfig;
  readonly parameters: readonly SkillParameter[];
  readonly path?: string | undefined;
}

export interface FlowEvent {
  readonly id: string;
  readonly idn: string;
  readonly description: string;
  readonly skill_selector: SkillSelector;
  readonly skill_idn?: string;
  readonly state_idn?: string;
  readonly integration_idn?: string;
  readonly connector_idn?: string;
  readonly interrupt_mode: InterruptMode;
}

export interface FlowState {
  readonly id: string;
  readonly idn: string;
  readonly title: string;
  readonly default_value?: string;
  readonly scope: StateFieldScope;
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
  readonly topic_name: string;
  readonly persona_id: string | null;
  readonly topic_summary: string;
  readonly topic_facts: readonly string[];
  readonly confidence: number;
  readonly source: string;
  readonly labels: readonly string[];
}

export interface AkbImportArticle extends Omit<ParsedArticle, 'persona_id'> {
  persona_id: string;
}

// CLI Types
export interface CliArgs {
  readonly _: readonly string[];
  readonly verbose?: boolean;
  readonly v?: boolean;
  readonly [key: string]: unknown;
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
  skill_idn?: string | null;
  state_idn?: string | null;
  integration_idn?: string | null;
  connector_idn?: string | null;
  interrupt_mode: string;
}

export interface FlowsYamlState {
  title: string;
  idn: string;
  default_value?: string | null;
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
  agent_description?: string | null;
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