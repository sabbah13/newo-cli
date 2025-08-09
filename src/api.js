import axios from 'axios';
import dotenv from 'dotenv';
import { getValidAccessToken, forceReauth } from './auth.js';
dotenv.config();

const { NEWO_BASE_URL } = process.env;

export async function makeClient(verbose = false) {
  let accessToken = await getValidAccessToken();
  if (verbose) console.log('✓ Access token obtained');

  const client = axios.create({
    baseURL: NEWO_BASE_URL,
    headers: { accept: 'application/json' }
  });

  client.interceptors.request.use(async (config) => {
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
    r => {
      if (verbose) {
        console.log(`← ${r.status} ${r.config.method?.toUpperCase()} ${r.config.url}`);
        if (r.data && Object.keys(r.data).length < 20) {
          console.log('  Response:', JSON.stringify(r.data, null, 2));
        } else if (r.data) {
          console.log(`  Response: [${typeof r.data}] ${Array.isArray(r.data) ? r.data.length + ' items' : 'large object'}`);
        }
      }
      return r;
    },
    async (error) => {
      const status = error?.response?.status;
      if (verbose) {
        console.log(`← ${status} ${error.config?.method?.toUpperCase()} ${error.config?.url} - ${error.message}`);
        if (error.response?.data) console.log('  Error data:', error.response.data);
      }
      if (status === 401 && !retried) {
        retried = true;
        if (verbose) console.log('🔄 Retrying with fresh token...');
        accessToken = await forceReauth();
        error.config.headers.Authorization = `Bearer ${accessToken}`;
        return client.request(error.config);
      }
      throw error;
    }
  );

  return client;
}

export async function listAgents(client, projectId) {
  const r = await client.get(`/api/v1/bff/agents/list`, { params: { project_id: projectId } });
  return r.data;
}

export async function getProjectMeta(client, projectId) {
  const r = await client.get(`/api/v1/designer/projects/by-id/${projectId}`);
  return r.data;
}

export async function listFlowSkills(client, flowId) {
  const r = await client.get(`/api/v1/designer/flows/${flowId}/skills`);
  return r.data;
}

export async function getSkill(client, skillId) {
  const r = await client.get(`/api/v1/designer/skills/${skillId}`);
  return r.data;
}

export async function updateSkill(client, skillObject) {
  await client.put(`/api/v1/designer/flows/skills/${skillObject.id}`, skillObject);
}

export async function listFlowEvents(client, flowId) {
  const r = await client.get(`/api/v1/designer/flows/${flowId}/events`);
  return r.data;
}

export async function listFlowStates(client, flowId) {
  const r = await client.get(`/api/v1/designer/flows/${flowId}/states`);
  return r.data;
}