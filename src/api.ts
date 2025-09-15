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
  CustomerAttributesResponse
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