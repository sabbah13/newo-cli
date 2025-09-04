import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import { ENV } from './env.js';
import type { TokenResponse, StoredTokens } from './types.js';

const STATE_DIR = path.join(process.cwd(), '.newo');
const TOKENS_PATH = path.join(STATE_DIR, 'tokens.json');

async function saveTokens(tokens: StoredTokens): Promise<void> {
  await fs.ensureDir(STATE_DIR);
  await fs.writeJson(TOKENS_PATH, tokens, { spaces: 2 });
}

async function loadTokens(): Promise<StoredTokens | null> {
  try {
    if (await fs.pathExists(TOKENS_PATH)) {
      return await fs.readJson(TOKENS_PATH) as StoredTokens;
    }
  } catch (error: unknown) {
    console.warn('Failed to load tokens from file:', error instanceof Error ? error.message : String(error));
  }
  
  if (ENV.NEWO_ACCESS_TOKEN || ENV.NEWO_REFRESH_TOKEN) {
    const tokens: StoredTokens = {
      access_token: ENV.NEWO_ACCESS_TOKEN || '',
      refresh_token: ENV.NEWO_REFRESH_TOKEN || '',
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

function normalizeTokenResponse(tokenResponse: TokenResponse): { access: string; refresh: string; expiresInSec: number } {
  const access = tokenResponse.access_token || tokenResponse.token || tokenResponse.accessToken;
  const refresh = tokenResponse.refresh_token || tokenResponse.refreshToken || '';
  const expiresInSec = tokenResponse.expires_in || tokenResponse.expiresIn || 3600;
  
  if (!access) {
    throw new Error('Invalid token response: missing access token');
  }
  
  return { access, refresh, expiresInSec };
}

export async function exchangeApiKeyForToken(): Promise<StoredTokens> {
  if (!ENV.NEWO_API_KEY) {
    throw new Error('NEWO_API_KEY not set. Provide an API key in .env');
  }
  
  try {
    const url = `${ENV.NEWO_BASE_URL}/api/v1/auth/api-key/token`;
    const response = await axios.post<TokenResponse>(
      url, 
      {}, 
      { 
        headers: { 
          'x-api-key': ENV.NEWO_API_KEY, 
          'accept': 'application/json' 
        } 
      }
    );
    
    const { access, refresh, expiresInSec } = normalizeTokenResponse(response.data);
    
    const tokens: StoredTokens = { 
      access_token: access, 
      refresh_token: refresh, 
      expires_at: Date.now() + expiresInSec * 1000 
    };
    
    await saveTokens(tokens);
    return tokens;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to exchange API key for token: ${message}`);
  }
}

export async function refreshWithEndpoint(refreshToken: string): Promise<StoredTokens> {
  if (!ENV.NEWO_REFRESH_URL) {
    throw new Error('NEWO_REFRESH_URL not set');
  }
  
  try {
    const response = await axios.post<TokenResponse>(
      ENV.NEWO_REFRESH_URL, 
      { refresh_token: refreshToken }, 
      { headers: { 'accept': 'application/json' } }
    );
    
    const { access, expiresInSec } = normalizeTokenResponse(response.data);
    const refresh = response.data.refresh_token || response.data.refreshToken || refreshToken;
    
    const tokens: StoredTokens = { 
      access_token: access, 
      refresh_token: refresh, 
      expires_at: Date.now() + expiresInSec * 1000 
    };
    
    await saveTokens(tokens);
    return tokens;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to refresh token: ${message}`);
  }
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

  if (ENV.NEWO_REFRESH_URL && tokens.refresh_token) {
    try {
      tokens = await refreshWithEndpoint(tokens.refresh_token);
      return tokens.access_token;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Refresh failed (${message}), falling back to API key exchange…`);
    }
  }
  
  tokens = await exchangeApiKeyForToken();
  return tokens.access_token;
}

export async function forceReauth(): Promise<string> {
  const tokens = await exchangeApiKeyForToken();
  return tokens.access_token;
}