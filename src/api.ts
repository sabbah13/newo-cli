import axios, { type AxiosInstance, type InternalAxiosRequestConfig, type AxiosResponse, type AxiosError } from 'axios';
import { getValidAccessToken, forceReauth } from './auth.js';
import { ENV } from './env.js';
import type {
  ProjectMeta,
  Agent,
  Skill,
  FlowEvent,
  FlowState,
  AkbImportArticle,
  CustomerProfile,
  CustomerAttribute,
  CustomerAttributesResponse,
  UserPersonaResponse,
  UserPersona,
  ChatHistoryParams,
  ChatHistoryResponse,
  CreateAgentRequest,
  CreateAgentResponse,
  CreateFlowRequest,
  CreateFlowResponse,
  CreateSkillRequest,
  CreateSkillResponse,
  CreateFlowEventRequest,
  CreateFlowEventResponse,
  CreateFlowStateRequest,
  CreateFlowStateResponse,
  CreateSkillParameterRequest,
  CreateSkillParameterResponse,
  CreateCustomerAttributeRequest,
  CreateCustomerAttributeResponse,
  CreatePersonaRequest,
  CreatePersonaResponse,
  CreateProjectRequest,
  CreateProjectResponse,
  PublishFlowRequest,
  PublishFlowResponse
} from './types.js';

// Per-request retry tracking to avoid shared state issues
const RETRY_SYMBOL = Symbol('retried');

export async function makeClient(verbose: boolean = false, token?: string): Promise<AxiosInstance> {
  let accessToken = token || await getValidAccessToken();
  if (verbose) console.log('✓ Access token obtained');

  const client = axios.create({
    baseURL: ENV.NEWO_BASE_URL,
    headers: { accept: 'application/json' }
  });

  client.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${accessToken}`;
    
    if (verbose) {
      console.log(`→ ${config.method?.toUpperCase()} ${config.url}`);
      if (config.data) console.log('  Data:', JSON.stringify(config.data, null, 2));
      if (config.params) console.log('  Params:', config.params);
    }
    
    return config;
  });

  client.interceptors.response.use(
    (response: AxiosResponse) => {
      if (verbose) {
        console.log(`← ${response.status} ${response.config.method?.toUpperCase()} ${response.config.url}`);
        if (response.data && Object.keys(response.data).length < 20) {
          console.log('  Response:', JSON.stringify(response.data, null, 2));
        } else if (response.data) {
          const itemCount = Array.isArray(response.data) ? response.data.length : Object.keys(response.data).length;
          console.log(`  Response: [${typeof response.data}] ${Array.isArray(response.data) ? itemCount + ' items' : 'large object'}`);
        }
      }
      return response;
    },
    async (error: AxiosError) => {
      const status = error?.response?.status;
      if (verbose) {
        console.log(`← ${status} ${error.config?.method?.toUpperCase()} ${error.config?.url} - ${error.message}`);
        if (error.response?.data) console.log('  Error data:', error.response.data);
      }
      
      // Use per-request retry tracking to avoid shared state issues
      const config = error.config as InternalAxiosRequestConfig & { [RETRY_SYMBOL]?: boolean };
      
      if (status === 401 && !config?.[RETRY_SYMBOL]) {
        if (config) {
          config[RETRY_SYMBOL] = true;
          if (verbose) console.log('🔄 Retrying with fresh token...');
          accessToken = await forceReauth();
          
          config.headers = config.headers || {};
          config.headers.Authorization = `Bearer ${accessToken}`;
          return client.request(config);
        }
      }
      
      throw error;
    }
  );

  return client;
}

export async function listProjects(client: AxiosInstance): Promise<ProjectMeta[]> {
  const response = await client.get<ProjectMeta[]>('/api/v1/designer/projects');
  return response.data;
}

export async function listAgents(client: AxiosInstance, projectId: string): Promise<Agent[]> {
  const response = await client.get<Agent[]>('/api/v1/bff/agents/list', { 
    params: { project_id: projectId } 
  });
  return response.data;
}

export async function getProjectMeta(client: AxiosInstance, projectId: string): Promise<ProjectMeta> {
  const response = await client.get<ProjectMeta>(`/api/v1/designer/projects/by-id/${projectId}`);
  return response.data;
}

export async function listFlowSkills(client: AxiosInstance, flowId: string): Promise<Skill[]> {
  const response = await client.get<Skill[]>(`/api/v1/designer/flows/${flowId}/skills`);
  return response.data;
}

export async function getSkill(client: AxiosInstance, skillId: string): Promise<Skill> {
  const response = await client.get<Skill>(`/api/v1/designer/skills/${skillId}`);
  return response.data;
}

export async function updateSkill(client: AxiosInstance, skillObject: Skill): Promise<void> {
  await client.put(`/api/v1/designer/flows/skills/${skillObject.id}`, skillObject);
}

export async function listFlowEvents(client: AxiosInstance, flowId: string): Promise<FlowEvent[]> {
  const response = await client.get<FlowEvent[]>(`/api/v1/designer/flows/${flowId}/events`);
  return response.data;
}

export async function listFlowStates(client: AxiosInstance, flowId: string): Promise<FlowState[]> {
  const response = await client.get<FlowState[]>(`/api/v1/designer/flows/${flowId}/states`);
  return response.data;
}

export async function importAkbArticle(client: AxiosInstance, articleData: AkbImportArticle): Promise<unknown> {
  const response = await client.post('/api/v1/akb/append-manual', articleData);
  return response.data;
}

export async function getCustomerProfile(client: AxiosInstance): Promise<CustomerProfile> {
  const response = await client.get<CustomerProfile>('/api/v1/customer/profile');
  return response.data;
}

export async function getCustomerAttributes(client: AxiosInstance, includeHidden: boolean = true): Promise<CustomerAttributesResponse> {
  const response = await client.get<CustomerAttributesResponse>('/api/v1/bff/customer/attributes', {
    params: { include_hidden: includeHidden }
  });
  return response.data;
}

export async function updateCustomerAttribute(client: AxiosInstance, attribute: CustomerAttribute): Promise<void> {
  if (!attribute.id) {
    throw new Error(`Attribute ${attribute.idn} is missing ID - cannot update`);
  }
  await client.put(`/api/v1/customer/attributes/${attribute.id}`, {
    idn: attribute.idn,
    value: attribute.value,
    title: attribute.title,
    description: attribute.description,
    group: attribute.group,
    is_hidden: attribute.is_hidden,
    possible_values: attribute.possible_values,
    value_type: attribute.value_type
  });
}

// Conversation API Functions

export async function listUserPersonas(client: AxiosInstance, page: number = 1, per: number = 50): Promise<UserPersonaResponse> {
  const response = await client.get<UserPersonaResponse>('/api/v1/bff/conversations/user-personas', {
    params: { page, per }
  });
  return response.data;
}

export async function getUserPersona(client: AxiosInstance, personaId: string): Promise<UserPersona> {
  const response = await client.get<UserPersona>(`/api/v1/bff/conversations/user-personas/${personaId}`);
  return response.data;
}

export async function getAccount(client: AxiosInstance): Promise<{ id: string; [key: string]: any }> {
  const response = await client.get<{ id: string; [key: string]: any }>('/api/v1/account');
  return response.data;
}


export async function getChatHistory(client: AxiosInstance, params: ChatHistoryParams): Promise<ChatHistoryResponse> {
  const queryParams: Record<string, any> = {
    user_actor_id: params.user_actor_id,
    page: params.page || 1,
    per: params.per || 50
  };

  // Only add agent_actor_id if provided
  if (params.agent_actor_id) {
    queryParams.agent_actor_id = params.agent_actor_id;
  }

  const response = await client.get<ChatHistoryResponse>('/api/v1/chat/history', {
    params: queryParams
  });
  return response.data;
}

// Entity Creation/Deletion API Functions

export async function createAgent(client: AxiosInstance, projectId: string, agentData: CreateAgentRequest): Promise<CreateAgentResponse> {
  // Use project-specific v2 endpoint for proper project association
  const response = await client.post<CreateAgentResponse>(`/api/v2/designer/${projectId}/agents`, agentData);
  return response.data;
}

export async function deleteAgent(client: AxiosInstance, agentId: string): Promise<void> {
  await client.delete(`/api/v1/designer/agents/${agentId}`);
}

export async function createFlow(client: AxiosInstance, agentId: string, flowData: CreateFlowRequest): Promise<CreateFlowResponse> {
  // Use the correct NEWO endpoint pattern for flow creation
  const response = await client.post(`/api/v1/designer/${agentId}/flows/empty`, flowData);

  // The NEWO flow creation API returns empty response body with 201 status
  // The flow is created successfully, but we need to get the ID through agent listing
  if (response.status === 201) {
    // Flow created successfully, but ID will be retrieved during pull operation
    return { id: 'pending-sync' };
  }

  throw new Error(`Flow creation failed with status: ${response.status}`);
}

export async function deleteFlow(client: AxiosInstance, flowId: string): Promise<void> {
  await client.delete(`/api/v1/designer/flows/${flowId}`);
}

export async function createSkill(client: AxiosInstance, flowId: string, skillData: CreateSkillRequest): Promise<CreateSkillResponse> {
  const response = await client.post<CreateSkillResponse>(`/api/v1/designer/flows/${flowId}/skills`, skillData);
  return response.data;
}

export async function deleteSkill(client: AxiosInstance, skillId: string): Promise<void> {
  await client.delete(`/api/v1/designer/flows/skills/${skillId}`);
}

export async function deleteSkillById(client: AxiosInstance, skillId: string): Promise<void> {
  console.log(`🗑️ Deleting skill from platform: ${skillId}`);
  await client.delete(`/api/v1/designer/flows/skills/${skillId}`);
  console.log(`✅ Skill deleted from platform: ${skillId}`);
}

export async function createFlowEvent(client: AxiosInstance, flowId: string, eventData: CreateFlowEventRequest): Promise<CreateFlowEventResponse> {
  const response = await client.post<CreateFlowEventResponse>(`/api/v1/designer/flows/${flowId}/events`, eventData);
  return response.data;
}

export async function deleteFlowEvent(client: AxiosInstance, eventId: string): Promise<void> {
  await client.delete(`/api/v1/designer/flows/events/${eventId}`);
}

export async function createFlowState(client: AxiosInstance, flowId: string, stateData: CreateFlowStateRequest): Promise<CreateFlowStateResponse> {
  const response = await client.post<CreateFlowStateResponse>(`/api/v1/designer/flows/${flowId}/states`, stateData);
  return response.data;
}

export async function createSkillParameter(client: AxiosInstance, skillId: string, paramData: CreateSkillParameterRequest): Promise<CreateSkillParameterResponse> {
  // Debug the parameter creation request
  console.log('Creating parameter for skill:', skillId);
  console.log('Parameter data:', JSON.stringify(paramData, null, 2));

  try {
    const response = await client.post<CreateSkillParameterResponse>(`/api/v1/designer/flows/skills/${skillId}/parameters`, paramData);
    return response.data;
  } catch (error: any) {
    console.error('Parameter creation error details:', error.response?.data);
    throw error;
  }
}

export async function createCustomerAttribute(client: AxiosInstance, attributeData: CreateCustomerAttributeRequest): Promise<CreateCustomerAttributeResponse> {
  const response = await client.post<CreateCustomerAttributeResponse>('/api/v1/customer/attributes', attributeData);
  return response.data;
}

export async function createProject(client: AxiosInstance, projectData: CreateProjectRequest): Promise<CreateProjectResponse> {
  const response = await client.post<CreateProjectResponse>('/api/v1/designer/projects', projectData);
  return response.data;
}

export async function deleteProject(client: AxiosInstance, projectId: string): Promise<void> {
  await client.delete(`/api/v1/designer/projects/${projectId}`);
}

export async function createPersona(client: AxiosInstance, personaData: CreatePersonaRequest): Promise<CreatePersonaResponse> {
  const response = await client.post<CreatePersonaResponse>('/api/v1/customer/personas', personaData);
  return response.data;
}

export async function publishFlow(client: AxiosInstance, flowId: string, publishData: PublishFlowRequest): Promise<PublishFlowResponse> {
  const response = await client.post<PublishFlowResponse>(`/api/v1/designer/flows/${flowId}/publish`, publishData);
  return response.data;
}