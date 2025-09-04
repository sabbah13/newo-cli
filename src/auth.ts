import fs from 'fs-extra';
import path from 'path';
import axios, { AxiosError } from 'axios';
import { ENV } from './env.js';
import { customerStateDir } from './fsutil.js';
import type { TokenResponse, StoredTokens, CustomerConfig } from './types.js';

const STATE_DIR = path.join(process.cwd(), '.newo');

// Constants for validation and timeouts
const API_KEY_MIN_LENGTH = 10;
const TOKEN_MIN_LENGTH = 20;
const REQUEST_TIMEOUT = 30000; // 30 seconds
const TOKEN_EXPIRY_BUFFER = 60000; // 1 minute buffer for token expiry

// Validation functions
function validateApiKey(apiKey: string, customerIdn?: string): void {
  if (!apiKey || typeof apiKey !== 'string') {
    throw new Error(`Invalid API key format${customerIdn ? ` for customer ${customerIdn}` : ''}: must be a non-empty string`);
  }
  if (apiKey.length < API_KEY_MIN_LENGTH) {
    throw new Error(`API key too short${customerIdn ? ` for customer ${customerIdn}` : ''}: minimum ${API_KEY_MIN_LENGTH} characters required`);
  }
  if (apiKey.includes(' ') || apiKey.includes('\n') || apiKey.includes('\t')) {
    throw new Error(`Invalid API key format${customerIdn ? ` for customer ${customerIdn}` : ''}: contains invalid characters`);
  }
}

function validateTokens(tokens: StoredTokens): void {
  if (!tokens.access_token || typeof tokens.access_token !== 'string' || tokens.access_token.length < TOKEN_MIN_LENGTH) {
    throw new Error('Invalid access token format: must be a non-empty string with minimum length');
  }
  if (tokens.refresh_token && (typeof tokens.refresh_token !== 'string' || tokens.refresh_token.length < TOKEN_MIN_LENGTH)) {
    throw new Error('Invalid refresh token format: must be a non-empty string with minimum length');
  }
  if (tokens.expires_at && (typeof tokens.expires_at !== 'number' || tokens.expires_at <= 0)) {
    throw new Error('Invalid token expiry: must be a positive number');
  }
}

function validateUrl(url: string, name: string): void {
  if (!url || typeof url !== 'string') {
    throw new Error(`${name} must be a non-empty string`);
  }
  try {
    new URL(url);
  } catch {
    throw new Error(`${name} must be a valid URL format`);
  }
  if (!url.startsWith('https://') && !url.startsWith('http://')) {
    throw new Error(`${name} must use HTTP or HTTPS protocol`);
  }
}

// Enhanced logging function
function logAuthEvent(level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    module: 'auth',
    message,
    ...meta
  };
  
  // Sanitize sensitive data
  const sanitized = JSON.parse(JSON.stringify(logEntry, (key, value) => {
    if (typeof key === 'string' && (key.toLowerCase().includes('key') || key.toLowerCase().includes('token') || key.toLowerCase().includes('secret'))) {
      return typeof value === 'string' ? `${value.slice(0, 8)}...` : value;
    }
    return value;
  }));
  
  if (level === 'error') {
    console.error(JSON.stringify(sanitized));
  } else if (level === 'warn') {
    console.warn(JSON.stringify(sanitized));
  } else {
    console.log(JSON.stringify(sanitized));
  }
}

// Enhanced error handling for network requests
function handleNetworkError(error: unknown, operation: string, customerIdn?: string): never {
  const customerInfo = customerIdn ? ` for customer ${customerIdn}` : '';
  
  if (error instanceof AxiosError) {
    const statusCode = error.response?.status;
    const responseData = error.response?.data;
    
    if (statusCode === 401) {
      throw new Error(`Authentication failed${customerInfo}: Invalid API key or credentials`);
    } else if (statusCode === 403) {
      throw new Error(`Access forbidden${customerInfo}: Insufficient permissions`);
    } else if (statusCode === 429) {
      throw new Error(`Rate limit exceeded${customerInfo}: Please try again later`);
    } else if (statusCode && statusCode >= 500) {
      throw new Error(`Server error${customerInfo}: The NEWO service is temporarily unavailable (${statusCode})`);
    } else if (error.code === 'ECONNREFUSED') {
      throw new Error(`Connection refused${customerInfo}: Cannot reach NEWO service`);
    } else if (error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
      throw new Error(`Network timeout${customerInfo}: Check your internet connection`);
    } else {
      throw new Error(`Network error during ${operation}${customerInfo}: ${error.message}${responseData ? ` - ${JSON.stringify(responseData)}` : ''}`);
    }
  }
  
  throw new Error(`Failed to ${operation}${customerInfo}: ${error instanceof Error ? error.message : String(error)}`);
}

function tokensPath(customerIdn?: string): string {
  if (customerIdn) {
    return path.join(customerStateDir(customerIdn), 'tokens.json');
  }
  return path.join(STATE_DIR, 'tokens.json'); // Legacy path
}

async function saveTokens(tokens: StoredTokens, customerIdn?: string): Promise<void> {
  try {
    validateTokens(tokens);
    
    const filePath = tokensPath(customerIdn);
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeJson(filePath, tokens, { spaces: 2 });
    
    logAuthEvent('info', 'Tokens saved successfully', { 
      customerIdn: customerIdn || 'legacy',
      expiresAt: tokens.expires_at ? new Date(tokens.expires_at).toISOString() : undefined,
      hasRefreshToken: !!tokens.refresh_token
    });
  } catch (error: unknown) {
    logAuthEvent('error', 'Failed to save tokens', { 
      customerIdn: customerIdn || 'legacy',
      error: error instanceof Error ? error.message : String(error)
    });
    throw new Error(`Failed to save authentication tokens${customerIdn ? ` for customer ${customerIdn}` : ''}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function loadTokens(customerIdn?: string): Promise<StoredTokens | null> {
  try {
    const filePath = tokensPath(customerIdn);
    if (await fs.pathExists(filePath)) {
      const tokens = await fs.readJson(filePath) as StoredTokens;
      
      // Validate loaded tokens
      try {
        validateTokens(tokens);
      } catch (validationError: unknown) {
        logAuthEvent('warn', 'Loaded tokens failed validation, will regenerate', { 
          customerIdn: customerIdn || 'legacy',
          error: validationError instanceof Error ? validationError.message : String(validationError)
        });
        return null; // Force token regeneration
      }
      
      logAuthEvent('info', 'Tokens loaded successfully', { 
        customerIdn: customerIdn || 'legacy',
        expiresAt: tokens.expires_at ? new Date(tokens.expires_at).toISOString() : undefined,
        hasRefreshToken: !!tokens.refresh_token
      });
      
      return tokens;
    }
  } catch (error: unknown) {
    logAuthEvent('warn', 'Failed to load tokens from file', { 
      customerIdn: customerIdn || 'legacy',
      error: error instanceof Error ? error.message : String(error)
    });
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
  if (!tokens?.expires_at) {
    logAuthEvent('warn', 'Token has no expiry time, treating as expired');
    return true;
  }
  
  const currentTime = Date.now();
  const expiryTime = tokens.expires_at;
  const timeUntilExpiry = expiryTime - currentTime;
  
  if (timeUntilExpiry <= TOKEN_EXPIRY_BUFFER) {
    logAuthEvent('info', 'Token is expired or expires soon', {
      expiresAt: new Date(expiryTime).toISOString(),
      timeUntilExpiry: Math.round(timeUntilExpiry / 1000)
    });
    return true;
  }
  
  return false;
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
  const customerIdn = customer?.idn;
  
  // Validate inputs
  if (!apiKey) {
    throw new Error(customer 
      ? `API key not set for customer ${customer.idn}. Set NEWO_CUSTOMER_${customer.idn.toUpperCase()}_API_KEY in your environment` 
      : 'NEWO_API_KEY not set. Provide an API key in .env file'
    );
  }
  
  validateApiKey(apiKey, customerIdn);
  validateUrl(ENV.NEWO_BASE_URL, 'NEWO_BASE_URL');
  
  logAuthEvent('info', 'Exchanging API key for tokens', { customerIdn: customerIdn || 'legacy' });
  
  try {
    const url = `${ENV.NEWO_BASE_URL}/api/v1/auth/api-key/token`;
    const response = await axios.post<TokenResponse>(
      url, 
      {}, 
      { 
        timeout: REQUEST_TIMEOUT,
        headers: { 
          'x-api-key': apiKey, 
          'accept': 'application/json',
          'user-agent': 'newo-cli/1.5.0'
        } 
      }
    );
    
    if (!response.data) {
      throw new Error('Empty response from token exchange endpoint');
    }
    
    const { access, refresh, expiresInSec } = normalizeTokenResponse(response.data);
    
    const tokens: StoredTokens = { 
      access_token: access, 
      refresh_token: refresh, 
      expires_at: Date.now() + expiresInSec * 1000 
    };
    
    // Validate tokens before saving
    validateTokens(tokens);
    
    await saveTokens(tokens, customerIdn);
    
    logAuthEvent('info', 'API key exchange completed successfully', { 
      customerIdn: customerIdn || 'legacy',
      expiresAt: new Date(tokens.expires_at).toISOString()
    });
    
    return tokens;
  } catch (error: unknown) {
    logAuthEvent('error', 'API key exchange failed', { 
      customerIdn: customerIdn || 'legacy',
      error: error instanceof Error ? error.message : String(error)
    });
    handleNetworkError(error, 'exchange API key for token', customerIdn);
  }
}

export async function refreshWithEndpoint(refreshToken: string, customer?: CustomerConfig): Promise<StoredTokens> {
  const customerIdn = customer?.idn;
  
  // Validate inputs
  if (!ENV.NEWO_REFRESH_URL) {
    throw new Error('NEWO_REFRESH_URL not set in environment');
  }
  if (!refreshToken || typeof refreshToken !== 'string' || refreshToken.length < TOKEN_MIN_LENGTH) {
    throw new Error(`Invalid refresh token${customerIdn ? ` for customer ${customerIdn}` : ''}: must be a non-empty string with minimum length`);
  }
  
  validateUrl(ENV.NEWO_REFRESH_URL, 'NEWO_REFRESH_URL');
  
  logAuthEvent('info', 'Refreshing tokens using refresh endpoint', { customerIdn: customerIdn || 'legacy' });
  
  try {
    const response = await axios.post<TokenResponse>(
      ENV.NEWO_REFRESH_URL, 
      { refresh_token: refreshToken }, 
      { 
        timeout: REQUEST_TIMEOUT,
        headers: { 
          'accept': 'application/json',
          'user-agent': 'newo-cli/1.5.0'
        } 
      }
    );
    
    if (!response.data) {
      throw new Error('Empty response from token refresh endpoint');
    }
    
    const { access, expiresInSec } = normalizeTokenResponse(response.data);
    const refresh = response.data.refresh_token || response.data.refreshToken || refreshToken;
    
    const tokens: StoredTokens = { 
      access_token: access, 
      refresh_token: refresh, 
      expires_at: Date.now() + expiresInSec * 1000 
    };
    
    // Validate tokens before saving
    validateTokens(tokens);
    
    await saveTokens(tokens, customerIdn);
    
    logAuthEvent('info', 'Token refresh completed successfully', { 
      customerIdn: customerIdn || 'legacy',
      expiresAt: new Date(tokens.expires_at).toISOString()
    });
    
    return tokens;
  } catch (error: unknown) {
    logAuthEvent('error', 'Token refresh failed', { 
      customerIdn: customerIdn || 'legacy',
      error: error instanceof Error ? error.message : String(error)
    });
    handleNetworkError(error, 'refresh token', customerIdn);
  }
}

export async function getValidAccessToken(customer?: CustomerConfig): Promise<string> {
  const customerIdn = customer?.idn;
  
  logAuthEvent('info', 'Getting valid access token', { customerIdn: customerIdn || 'legacy' });
  
  try {
    let tokens = await loadTokens(customerIdn);
    
    // No tokens found, exchange API key
    if (!tokens || !tokens.access_token) {
      logAuthEvent('info', 'No existing tokens found, exchanging API key', { customerIdn: customerIdn || 'legacy' });
      tokens = await exchangeApiKeyForToken(customer);
      return tokens.access_token;
    }
    
    // Tokens are valid and not expired
    if (!isExpired(tokens)) {
      logAuthEvent('info', 'Using existing valid access token', { customerIdn: customerIdn || 'legacy' });
      return tokens.access_token;
    }

    // Try to refresh if refresh URL and token available
    if (ENV.NEWO_REFRESH_URL && tokens.refresh_token) {
      try {
        logAuthEvent('info', 'Attempting to refresh expired token', { customerIdn: customerIdn || 'legacy' });
        tokens = await refreshWithEndpoint(tokens.refresh_token, customer);
        return tokens.access_token;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logAuthEvent('warn', 'Token refresh failed, falling back to API key exchange', { 
          customerIdn: customerIdn || 'legacy',
          error: message
        });
      }
    } else {
      logAuthEvent('info', 'No refresh endpoint or refresh token available, using API key exchange', { 
        customerIdn: customerIdn || 'legacy' 
      });
    }
    
    // Fallback to API key exchange
    tokens = await exchangeApiKeyForToken(customer);
    return tokens.access_token;
  } catch (error: unknown) {
    logAuthEvent('error', 'Failed to get valid access token', { 
      customerIdn: customerIdn || 'legacy',
      error: error instanceof Error ? error.message : String(error)
    });
    throw new Error(`Unable to obtain valid access token${customerIdn ? ` for customer ${customerIdn}` : ''}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function forceReauth(customer?: CustomerConfig): Promise<string> {
  const customerIdn = customer?.idn;
  
  logAuthEvent('info', 'Forcing re-authentication', { customerIdn: customerIdn || 'legacy' });
  
  try {
    const tokens = await exchangeApiKeyForToken(customer);
    logAuthEvent('info', 'Forced re-authentication completed successfully', { 
      customerIdn: customerIdn || 'legacy',
      expiresAt: new Date(tokens.expires_at).toISOString()
    });
    return tokens.access_token;
  } catch (error: unknown) {
    logAuthEvent('error', 'Forced re-authentication failed', { 
      customerIdn: customerIdn || 'legacy',
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}