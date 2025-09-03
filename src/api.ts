import axios, { type AxiosInstance, type InternalAxiosRequestConfig, type AxiosResponse, type AxiosError } from 'axios';
import dotenv from 'dotenv';
import { getValidAccessToken, forceReauth } from './auth.js';
import type { 
  NewoEnvironment, 
  ProjectMeta, 
  Agent, 
  Skill, 
  FlowEvent, 
  FlowState,
  AkbImportArticle
} from './types.js';

dotenv.config();

const { NEWO_BASE_URL } = process.env as NewoEnvironment;

export async function makeClient(verbose: boolean = false): Promise<AxiosInstance> {
  let accessToken = await getValidAccessToken();
  if (verbose) console.log('✓ Access token obtained');

  if (!NEWO_BASE_URL) {
    throw new Error('NEWO_BASE_URL is not set in environment variables');
  }

  const client = axios.create({
    baseURL: NEWO_BASE_URL,
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

  let retried = false;
  client.interceptors.response.use(
    (response: AxiosResponse) => {
      if (verbose) {
        console.log(`← ${response.status} ${response.config.method?.toUpperCase()} ${response.config.url}`);
        if (response.data && Object.keys(response.data).length < 20) {
          console.log('  Response:', JSON.stringify(response.data, null, 2));
        } else if (response.data) {
          console.log(`  Response: [${typeof response.data}] ${Array.isArray(response.data) ? response.data.length + ' items' : 'large object'}`);
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
      
      if (status === 401 && !retried) {
        retried = true;
        if (verbose) console.log('🔄 Retrying with fresh token...');
        accessToken = await forceReauth();
        
        if (error.config) {
          error.config.headers = error.config.headers || {};
          error.config.headers.Authorization = `Bearer ${accessToken}`;
          return client.request(error.config);
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