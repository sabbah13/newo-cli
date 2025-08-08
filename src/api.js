import axios from 'axios';
import dotenv from 'dotenv';
import { getValidAccessToken, forceReauth } from './auth.js';
dotenv.config();

const { NEWO_BASE_URL } = process.env;

export async function makeClient() {
  let accessToken = await getValidAccessToken();

  const client = axios.create({
    baseURL: NEWO_BASE_URL,
    headers: { accept: 'application/json' }
  });

  client.interceptors.request.use(async (config) => {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${accessToken}`;
    return config;
  });

  let retried = false;
  client.interceptors.response.use(
    r => r,
    async (error) => {
      const status = error?.response?.status;
      if (status === 401 && !retried) {
        retried = true;
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
  try {
    const r = await client.get(`/api/v1/bff/skills/${skillId}`);
    return r.data;
  } catch {
    const r2 = await client.get(`/api/v1/designer/skills/${skillId}`);
    return r2.data;
  }
}

export async function updateSkill(client, skillId, prompt_script) {
  try {
    await client.put(`/api/v1/designer/skills/${skillId}`, { prompt_script });
  } catch {
    await client.put(`/api/v1/bff/skills/${skillId}`, { prompt_script });
  }
}
