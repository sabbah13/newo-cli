import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';
import type { NewoEnvironment, TokenResponse, StoredTokens } from './types.js';

dotenv.config();

const {
  NEWO_BASE_URL,
  NEWO_API_KEY,
  NEWO_ACCESS_TOKEN,
  NEWO_REFRESH_TOKEN,
  NEWO_REFRESH_URL
} = process.env as NewoEnvironment;

const STATE_DIR = path.join(process.cwd(), '.newo');
const TOKENS_PATH = path.join(STATE_DIR, 'tokens.json');

async function saveTokens(tokens: StoredTokens): Promise<void> {
  await fs.ensureDir(STATE_DIR);
  await fs.writeJson(TOKENS_PATH, tokens, { spaces: 2 });
}

async function loadTokens(): Promise<StoredTokens | null> {
  if (await fs.pathExists(TOKENS_PATH)) {
    return fs.readJson(TOKENS_PATH) as Promise<StoredTokens>;
  }
  
  if (NEWO_ACCESS_TOKEN || NEWO_REFRESH_TOKEN) {
    const tokens: StoredTokens = {
      access_token: NEWO_ACCESS_TOKEN || '',
      refresh_token: NEWO_REFRESH_TOKEN || '',
      expires_at: Date.now() + 10 * 60 * 1000
    };
    await saveTokens(tokens);
    return tokens;
  }
  
  return null;
}

function isExpired(tokens: StoredTokens | null): boolean {
  if (!tokens?.expires_at) return false;
  return Date.now() >= tokens.expires_at - 10_000;
}

export async function exchangeApiKeyForToken(): Promise<StoredTokens> {
  if (!NEWO_API_KEY) {
    throw new Error('NEWO_API_KEY not set. Provide an API key in .env');
  }
  
  const url = `${NEWO_BASE_URL}/api/v1/auth/api-key/token`;
  const response = await axios.post<TokenResponse>(
    url, 
    {}, 
    { 
      headers: { 
        'x-api-key': NEWO_API_KEY, 
        'accept': 'application/json' 
      } 
    }
  );
  
  const data = response.data;
  const access = data.access_token || data.token || data.accessToken;
  const refresh = data.refresh_token || data.refreshToken || '';
  const expiresInSec = data.expires_in || data.expiresIn || 3600;
  
  if (!access) {
    throw new Error('Failed to get access token from API key exchange');
  }
  
  const tokens: StoredTokens = { 
    access_token: access, 
    refresh_token: refresh, 
    expires_at: Date.now() + expiresInSec * 1000 
  };
  
  await saveTokens(tokens);
  return tokens;
}

export async function refreshWithEndpoint(refreshToken: string): Promise<StoredTokens> {
  if (!NEWO_REFRESH_URL) {
    throw new Error('NEWO_REFRESH_URL not set');
  }
  
  const response = await axios.post<TokenResponse>(
    NEWO_REFRESH_URL, 
    { refresh_token: refreshToken }, 
    { headers: { 'accept': 'application/json' } }
  );
  
  const data = response.data;
  const access = data.access_token || data.token || data.accessToken;
  const refresh = data.refresh_token ?? refreshToken;
  const expiresInSec = data.expires_in || 3600;
  
  if (!access) {
    throw new Error('Failed to get access token from refresh');
  }
  
  const tokens: StoredTokens = { 
    access_token: access, 
    refresh_token: refresh, 
    expires_at: Date.now() + expiresInSec * 1000 
  };
  
  await saveTokens(tokens);
  return tokens;
}

export async function getValidAccessToken(): Promise<string> {
  let tokens = await loadTokens();
  
  if (!tokens || !tokens.access_token) {
    tokens = await exchangeApiKeyForToken();
    return tokens.access_token;
  }
  
  if (!isExpired(tokens)) {
    return tokens.access_token;
  }

  if (NEWO_REFRESH_URL && tokens.refresh_token) {
    try {
      tokens = await refreshWithEndpoint(tokens.refresh_token);
      return tokens.access_token;
    } catch (error) {
      console.warn('Refresh failed, falling back to API key exchange…');
    }
  }
  
  tokens = await exchangeApiKeyForToken();
  return tokens.access_token;
}

export async function forceReauth(): Promise<string> {
  const tokens = await exchangeApiKeyForToken();
  return tokens.access_token;
}