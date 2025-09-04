import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import { ENV } from './env.js';
import { customerStateDir } from './fsutil.js';
import type { TokenResponse, StoredTokens, CustomerConfig } from './types.js';

const STATE_DIR = path.join(process.cwd(), '.newo');

function tokensPath(customerIdn?: string): string {
  if (customerIdn) {
    return path.join(customerStateDir(customerIdn), 'tokens.json');
  }
  return path.join(STATE_DIR, 'tokens.json'); // Legacy path
}

async function saveTokens(tokens: StoredTokens, customerIdn?: string): Promise<void> {
  const filePath = tokensPath(customerIdn);
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeJson(filePath, tokens, { spaces: 2 });
}

async function loadTokens(customerIdn?: string): Promise<StoredTokens | null> {
  try {
    const filePath = tokensPath(customerIdn);
    if (await fs.pathExists(filePath)) {
      return await fs.readJson(filePath) as StoredTokens;
    }
  } catch (error: unknown) {
    console.warn('Failed to load tokens from file:', error instanceof Error ? error.message : String(error));
  }
  
  // Fallback to environment tokens for legacy mode or bootstrap
  if (!customerIdn && (ENV.NEWO_ACCESS_TOKEN || ENV.NEWO_REFRESH_TOKEN)) {
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

export async function exchangeApiKeyForToken(customer?: CustomerConfig): Promise<StoredTokens> {
  const apiKey = customer?.apiKey || ENV.NEWO_API_KEY;
  if (!apiKey) {
    throw new Error(customer 
      ? `API key not set for customer ${customer.idn}` 
      : 'NEWO_API_KEY not set. Provide an API key in .env'
    );
  }
  
  try {
    const url = `${ENV.NEWO_BASE_URL}/api/v1/auth/api-key/token`;
    const response = await axios.post<TokenResponse>(
      url, 
      {}, 
      { 
        headers: { 
          'x-api-key': apiKey, 
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
    
    await saveTokens(tokens, customer?.idn);
    return tokens;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const customerInfo = customer ? ` for customer ${customer.idn}` : '';
    throw new Error(`Failed to exchange API key for token${customerInfo}: ${message}`);
  }
}

export async function refreshWithEndpoint(refreshToken: string, customer?: CustomerConfig): Promise<StoredTokens> {
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
    
    await saveTokens(tokens, customer?.idn);
    return tokens;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const customerInfo = customer ? ` for customer ${customer.idn}` : '';
    throw new Error(`Failed to refresh token${customerInfo}: ${message}`);
  }
}

export async function getValidAccessToken(customer?: CustomerConfig): Promise<string> {
  let tokens = await loadTokens(customer?.idn);
  
  if (!tokens || !tokens.access_token) {
    tokens = await exchangeApiKeyForToken(customer);
    return tokens.access_token;
  }
  
  if (!isExpired(tokens)) {
    return tokens.access_token;
  }

  if (ENV.NEWO_REFRESH_URL && tokens.refresh_token) {
    try {
      tokens = await refreshWithEndpoint(tokens.refresh_token, customer);
      return tokens.access_token;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Refresh failed (${message}), falling back to API key exchange…`);
    }
  }
  
  tokens = await exchangeApiKeyForToken(customer);
  return tokens.access_token;
}

export async function forceReauth(customer?: CustomerConfig): Promise<string> {
  const tokens = await exchangeApiKeyForToken(customer);
  return tokens.access_token;
}