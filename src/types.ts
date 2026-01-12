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

export interface CustomerAttribute {
  id?: string; // Required for push operations
  idn: string;
  value: string | object;
  title: string;
  description: string;
  group: string;
  is_hidden: boolean;
  possible_values: string[];
  value_type: string;
}

export interface CustomerAttributesResponse {
  groups: string[];
  attributes: CustomerAttribute[];
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
  readonly version?: string | null;
  readonly is_synchronized?: boolean;
  readonly preferred_update_time?: string | null;
  readonly is_auto_update_enabled?: boolean;
  readonly registry_idn?: string;
  readonly registry_item_idn?: string | null;
  readonly registry_item_version?: string | null;
  readonly created_at?: string;
  readonly updated_at?: string;
}

export interface Agent {
  readonly id: string;
  readonly idn: string;
  readonly title?: string;
  readonly description?: string | null;
  readonly flows?: readonly Flow[];
  readonly persona?: {
    readonly id: string;
    readonly name: string;
    readonly title: string;
  } | null;
  readonly created_at?: string;
  readonly updated_at?: string;
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

// Hierarchical Metadata Types for Individual YAML Files
export interface ProjectMetadata {
  id: string;
  idn: string;
  title: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

export interface AgentMetadata {
  id: string;
  idn: string;
  title?: string;
  description?: string;
  persona_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface FlowMetadata {
  id: string;
  idn: string;
  title: string;
  description?: string;
  default_runner_type: RunnerType;
  default_model: ModelConfig;
  events: FlowEvent[];
  state_fields: FlowState[];
  created_at?: string;
  updated_at?: string;
}

export interface SkillMetadata {
  id: string;
  idn: string;
  title: string;
  runner_type: RunnerType;
  model: ModelConfig;
  parameters: SkillParameter[];
  path?: string;
  created_at?: string;
  updated_at?: string;
}

// Conversation Types
export interface Actor {
  readonly id: string;
  readonly conversation_is_active: boolean;
  readonly act_count: number;
  readonly external_id: string;
  readonly integration_idn: string;
  readonly connector_idn: string;
  readonly contact_information: string;
}

export interface UserPersona {
  readonly id: string;
  readonly name: string;
  readonly last_session_id: string;
  readonly session_is_active: boolean;
  readonly last_act_time: string;
  readonly last_act_text: string;
  readonly act_count: number;
  readonly actors: readonly Actor[];
  readonly not_found: boolean;
}

export interface ConversationAct {
  readonly id: string;
  readonly command_act_id: string | null;
  readonly external_event_id: string;
  readonly arguments: readonly any[];
  readonly reference_idn: string;
  readonly runtime_context_id: string;
  readonly source_text: string;
  readonly original_text: string;
  readonly datetime: string;
  readonly user_actor_id: string;
  readonly agent_actor_id: string | null;
  readonly user_persona_id: string;
  readonly user_persona_name: string;
  readonly agent_persona_id: string;
  readonly external_id: string | null;
  readonly integration_idn: string;
  readonly connector_idn: string;
  readonly to_integration_idn: string | null;
  readonly to_connector_idn: string | null;
  readonly is_agent: boolean;
  readonly project_idn: string | null;
  readonly flow_idn: string;
  readonly skill_idn: string;
  readonly session_id: string;
  readonly recordings: readonly any[];
  readonly contact_information: string | null;
}

export interface UserPersonaResponse {
  readonly items: readonly UserPersona[];
  readonly metadata: {
    readonly page: number;
    readonly per: number;
    readonly total: number;
  };
}


export interface ChatHistoryParams {
  readonly user_actor_id: string;
  readonly agent_actor_id?: string;
  readonly page?: number;
  readonly per?: number;
}

export interface ChatHistoryResponse {
  readonly items: readonly any[]; // We'll define this after seeing the response structure
  readonly metadata?: {
    readonly page: number;
    readonly per: number;
    readonly total: number;
  };
}

export interface ConversationOptions {
  readonly includeAll?: boolean;
  readonly connectors?: string[];
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly fields?: string[];
  readonly maxPersonas?: number | undefined;
  readonly maxActsPerPersona?: number | undefined;
}

// Processed conversation data for YAML output
export interface ProcessedAct {
  readonly datetime: string;
  readonly type: string;
  readonly message: string;
  readonly contact_information?: string | null;
  readonly flow_idn?: string;
  readonly skill_idn?: string;
  readonly session_id?: string;
}

export interface ProcessedPersona {
  readonly id: string;
  readonly name: string;
  readonly phone: string | null;
  readonly act_count: number;
  readonly acts: readonly ProcessedAct[];
}

export interface ConversationsData {
  readonly personas: readonly ProcessedPersona[];
  readonly total_personas: number;
  readonly total_acts: number;
  readonly generated_at: string;
}

// Entity Creation/Deletion Types

export interface CreateAgentRequest {
  idn: string;
  title: string;
  description?: string | null;
  persona_id?: string | null;
}

export interface CreateAgentResponse {
  id: string;
}

export interface CreateFlowRequest {
  idn: string;
  title: string;
}

export interface CreateFlowResponse {
  id: string;
}

export interface CreateSkillRequest {
  idn: string;
  title: string;
  prompt_script?: string;
  runner_type: RunnerType;
  model: ModelConfig;
  path?: string;
  parameters?: SkillParameter[];
}

export interface CreateSkillResponse {
  id: string;
}

export interface CreateFlowEventRequest {
  idn: string;
  description?: string;
  skill_selector: string;
  skill_idn?: string;
  state_idn?: string | null;
  interrupt_mode: string;
  integration_idn: string;
  connector_idn: string;
}

export interface CreateFlowEventResponse {
  id: string;
}

export interface CreateFlowStateRequest {
  title: string;
  idn: string;
  default_value?: string;
  scope: string;
}

export interface CreateFlowStateResponse {
  id: string;
}

export interface CreateSkillParameterRequest {
  name: string;
  default_value?: string;
}

export interface CreateSkillParameterResponse {
  id: string;
}

export interface CreateCustomerAttributeRequest {
  idn: string;
  value: string;
  title: string;
  description?: string;
  group: string;
  is_hidden: boolean;
  possible_values: string[];
  value_type: string;
}

export interface CreateCustomerAttributeResponse {
  id: string;
}

export interface CreatePersonaRequest {
  name: string;
  title: string;
  description?: string;
}

export interface CreatePersonaResponse {
  id: string;
}

export interface CreateProjectRequest {
  idn: string;
  title: string;
  version?: string;
  description?: string;
  is_auto_update_enabled?: boolean;
  registry_idn?: string;
  registry_item_idn?: string | null;
  registry_item_version?: string | null;
}

export interface CreateProjectResponse {
  id: string;
}

export interface PublishFlowRequest {
  version: string;
  description: string;
  type: string;
}

export interface PublishFlowResponse {
  success: boolean;
}

// Sandbox Chat Types

export interface IntegrationSettingDescription {
  readonly title: string;
  readonly idn: string;
  readonly control_type: string;
  readonly value_type: string;
  readonly is_required: boolean;
  readonly is_readonly: boolean;
  readonly default_value?: string | null;
  readonly description?: string | null;
  readonly group?: string | null;
  readonly possible_values?: readonly string[] | null;
  readonly possible_values_only?: boolean;
  readonly possible_values_url?: string | null;
}

export interface Integration {
  readonly id: string;
  readonly title: string;
  readonly idn: string;
  readonly description: string;
  readonly is_disabled: boolean;
  readonly channel: string;
  readonly integration_settings_descriptions?: readonly IntegrationSettingDescription[];
  readonly connector_settings_descriptions?: readonly IntegrationSettingDescription[];
}

export interface IntegrationSetting {
  readonly title: string;
  readonly idn: string;
  readonly control_type: string;
  readonly value_type: string;
  readonly is_required: boolean;
  readonly default_value?: string | null;
}

export interface Connector {
  readonly id: string;
  readonly title: string;
  readonly connector_idn: string;
  readonly integration_idn: string;
  readonly status: string;
  readonly api_key?: string;
  readonly settings: readonly ConnectorSetting[];
}

export interface ConnectorSetting {
  readonly idn: string;
  readonly value: string;
}

export interface CreateSandboxPersonaRequest {
  name: string;
  title: string;
}

export interface CreateSandboxPersonaResponse {
  id: string;
}

export interface CreateActorRequest {
  name: string;
  external_id: string;
  integration_idn: string;
  connector_idn: string;
  time_zone_identifier?: string;
}

export interface CreateActorResponse {
  id: string;
}

export interface SendChatMessageRequest {
  text: string;
  arguments?: readonly any[];
}

export interface ConversationActsParams {
  user_persona_id: string;
  user_actor_id: string;
  agent_persona_id?: string; // Optional - can be omitted for first poll
  per?: number;
  page?: number;
}

export interface ConversationActsResponse {
  readonly items: readonly ConversationAct[];
  readonly metadata?: {
    readonly page: number;
    readonly per: number;
    readonly total: number;
  };
}

// Sandbox Chat Session State
export interface SandboxChatSession {
  user_persona_id: string;
  user_actor_id: string; // This is the chat ID
  agent_persona_id: string | null; // Retrieved from first response
  connector_idn: string;
  session_id: string | null;
  external_id: string; // Random identifier for this chat
}

// Sandbox Chat Debug Info
export interface ChatDebugInfo {
  flow_idn: string | null;
  skill_idn: string | null;
  session_id: string;
  runtime_context_id: string | null;
  reference_idn: string;
  arguments: readonly any[];
}

// Script Actions Types
export interface ScriptAction {
  readonly title: string;
  readonly idn?: string;
  readonly arguments: Record<string, ArgumentSchema>;
}

export interface ArgumentSchema {
  readonly title: string;
  readonly type: string;
  readonly default?: any;
  readonly items?: any;
  readonly anyOf?: readonly any[];
  readonly enum?: readonly string[];
  readonly format?: string;
  readonly pattern?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly contentMediaType?: string;
  readonly contentSchema?: any;
  [key: string]: any; // Allow additional JSON Schema properties
}

// Connector CRUD Types
export interface CreateConnectorRequest {
  title: string;
  connector_idn: string;
  integration_idn: string;
  settings?: readonly ConnectorSetting[];
}

export interface CreateConnectorResponse {
  id: string;
}

export interface UpdateConnectorRequest {
  title?: string;
  status?: string;
  settings?: readonly ConnectorSetting[];
}

export interface IntegrationSettingsResponse {
  settings: IntegrationSetting[];
}

// Integrations Data for File Storage
export interface IntegrationsYamlData {
  integrations: IntegrationMetadata[];
}

export interface IntegrationMetadata {
  id: string;
  idn: string;
  title: string;
  description: string;
  channel: string;
  is_disabled: boolean;
}

export interface ConnectorMetadata {
  id: string;
  connector_idn: string;
  title: string;
  status: string;
  integration_idn: string;
  settings: readonly ConnectorSetting[];
}

// Webhook Types
export interface OutgoingWebhook {
  readonly id: string;
  readonly idn: string;
  readonly description: string;
  readonly connector_idn: string;
  readonly url: string;
  readonly command_idns: readonly string[];
}

export interface IncomingWebhook {
  readonly id: string;
  readonly idn: string;
  readonly webhook_path_id: string;
  readonly description: string;
  readonly url: string;
  readonly connector_idn: string;
  readonly event_idns: readonly string[];
  readonly allowed_ips: readonly string[];
}

// AKB (Knowledge Base) Types
export interface Persona {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly agent: {
    readonly id: string;
    readonly idn: string;
    readonly title: string | null;
  };
  readonly actors: readonly any[];
}

export interface PersonaSearchResponse {
  readonly items: readonly Persona[];
  readonly metadata: {
    readonly page: number;
    readonly per: number;
    readonly total: number;
  };
}

export interface AkbTopic {
  readonly id: string;
  readonly topic_name: string;
  readonly topic_summary: string;
  readonly topic_facts: readonly string[];
  readonly confidence: number;
  readonly source: string;
  readonly labels: readonly string[];
  readonly created_at: string;
  readonly updated_at: string;
  readonly persona_id: string;
}

export interface AkbTopicItem {
  readonly topic: AkbTopic;
  readonly fuzzy_search_fields_score: number | null;
}

export interface AkbTopicsResponse {
  readonly items: readonly AkbTopicItem[];
  readonly metadata: {
    readonly page: number;
    readonly per: number;
    readonly total: number;
  };
}

export interface AkbYamlTopic {
  topic_name: string;
  topic_facts: string[];
  confidence: number;
  source: string;
  created_at: string;
  updated_at: string;
  labels: string[];
  topic_summary: string;
}

// Registry Types (for project marketplace/templates)
export interface Registry {
  readonly id: string;
  readonly idn: string;
  readonly account_id: string;
  readonly is_public: boolean;
}

export interface RegistryItemProjectImage {
  readonly id: string;
  readonly idn: string;
  readonly image_hash: string;
  readonly storage_id: string;
  readonly customer_idn: string;
  readonly account_id: string;
  readonly created_at: string;
}

export interface RegistryItem {
  readonly id: string;
  readonly idn: string;
  readonly version: string;
  readonly project_image: RegistryItemProjectImage;
  readonly account_id: string;
  readonly account_idn: string | null;
  readonly account_email: string | null;
  readonly is_public: boolean;
  readonly active_project_count: number;
  readonly created_at: string;
  readonly published_at: string;
}

export interface AddProjectFromRegistryRequest {
  idn: string;
  title: string;
  version?: string;
  description?: string;
  is_auto_update_enabled?: boolean;
  registry_idn: string;
  registry_item_idn: string;
  registry_item_version: string | null;
}

// Create NEWO Customer Types (v3 API)

export interface CustomerMember {
  email: string;
  role: 'owner' | 'account_manager' | 'technical_owner' | 'referral';
  tenants?: string[];
  first_name?: string;
  external_account_id?: string;
  contact_email?: string;
}

export interface CustomerAttributeInput {
  idn: string;
  value: string;
  is_hidden?: boolean;
  group?: string;
}

export interface CustomerProjectInput {
  idn: string;
  title?: string;
  registry_idn?: string;
  registry_item_idn?: string;
  registry_item_version?: string;
  is_auto_update_enabled?: boolean;
}

export interface CreateNewoCustomerRequest {
  secret: string;
  customer: {
    organization_name: string;
    tenant: string;
    comment?: string;
    query_params?: string;
    members: CustomerMember[];
    contact_email: string;
    contact_phone?: string;
    external_customer_id?: string;
    organization_type?: 'customer' | 'partner';
    organization_status?: 'temporal' | 'permanent';
    billing_method?: string;
    platform_links?: {
      portal?: string;
      builder?: string;
      creator?: string;
      chat_widget?: string;
    };
    organization_logo?: {
      title?: string;
      external_logo_id?: string;
    };
    attributes?: CustomerAttributeInput[];
    a_service?: {
      partner_idn: string;
      member_idn: string;
    };
  };
  projects?: CustomerProjectInput[];
}

export interface CreateNewoCustomerResponse {
  id: string;
  idn: string;
}

// Analytics Logs Types

export type LogLevel = 'info' | 'warning' | 'error';
export type LogType = 'system' | 'operation' | 'call';

export interface LogEntry {
  readonly log_id: string;
  readonly level: LogLevel;
  readonly log_type: LogType;
  readonly project_idn: string;
  readonly data: {
    readonly external_event_id?: string;
    readonly reference_idn?: string;
    readonly operation_type?: string;
    readonly arguments?: readonly { name: string; value: string }[];
    readonly user_actor_id?: string;
    readonly integration_idn?: string;
    readonly connector_idn?: string;
    readonly to_integration_idn?: string;
    readonly to_connector_idn?: string;
    readonly flow_idn?: string;
    readonly skill_idn?: string;
    readonly agent_idn?: string;
    readonly line?: number;
    readonly runtime_context_id?: string;
    readonly [key: string]: unknown;
  };
  readonly message: string;
  readonly datetime: string;
}

export interface LogsResponse {
  readonly items: readonly LogEntry[];
}

export interface LogsQueryParams {
  page?: number;
  per?: number;
  from_datetime?: string;
  to_datetime?: string;
  levels?: LogLevel | LogLevel[];
  log_types?: LogType | LogType[];
  message?: string;
  project_idn?: string;
  flow_idn?: string;
  skill_idn?: string;
  external_event_id?: string;
  runtime_context_id?: string;
  user_persona_ids?: string;
  user_actor_ids?: string;
  agent_persona_ids?: string;
}