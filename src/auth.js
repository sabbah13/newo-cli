import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const {
  NEWO_BASE_URL,
  NEWO_API_KEY,
  NEWO_ACCESS_TOKEN,
  NEWO_REFRESH_TOKEN,
  NEWO_REFRESH_URL
} = process.env;

const STATE_DIR = path.join(process.cwd(), '.newo');
const TOKENS_PATH = path.join(STATE_DIR, 'tokens.json');

async function saveTokens(tokens) {
  await fs.ensureDir(STATE_DIR);
  await fs.writeJson(TOKENS_PATH, tokens, { spaces: 2 });
}

async function loadTokens() {
  if (await fs.pathExists(TOKENS_PATH)) {
    return fs.readJson(TOKENS_PATH);
  }
  if (NEWO_ACCESS_TOKEN || NEWO_REFRESH_TOKEN) {
    const t = {
      access_token: NEWO_ACCESS_TOKEN || '',
      refresh_token: NEWO_REFRESH_TOKEN || '',
      expires_at: Date.now() + 10 * 60 * 1000
    };
    await saveTokens(t);
    return t;
  }
  return null;
}

function isExpired(tokens) {
  if (!tokens?.expires_at) return false;
  return Date.now() >= tokens.expires_at - 10_000;
}

export async function exchangeApiKeyForToken() {
  if (!NEWO_API_KEY) throw new Error('NEWO_API_KEY not set. Provide an API key in .env');
  const url = `${NEWO_BASE_URL}/api/v1/auth/api-key/token`;
  const res = await axios.post(url, {}, { headers: { 'x-api-key': NEWO_API_KEY, 'accept': 'application/json' } });
  const data = res.data || {};
  const access = data.access_token || data.token || data.accessToken;
  const refresh = data.refresh_token || data.refreshToken || '';
  const expiresInSec = data.expires_in || data.expiresIn || 3600;
  const tokens = { access_token: access, refresh_token: refresh, expires_at: Date.now() + expiresInSec * 1000 };
  await saveTokens(tokens);
  return tokens;
}

export async function refreshWithEndpoint(refreshToken) {
  if (!NEWO_REFRESH_URL) throw new Error('NEWO_REFRESH_URL not set');
  const res = await axios.post(NEWO_REFRESH_URL, { refresh_token: refreshToken }, { headers: { 'accept': 'application/json' } });
  const data = res.data || {};
  const access = data.access_token || data.token || data.accessToken;
  const refresh = data.refresh_token ?? refreshToken;
  const expiresInSec = data.expires_in || 3600;
  const tokens = { access_token: access, refresh_token: refresh, expires_at: Date.now() + expiresInSec * 1000 };
  await saveTokens(tokens);
  return tokens;
}

export async function getValidAccessToken() {
  let tokens = await loadTokens();
  if (!tokens || !tokens.access_token) {
    tokens = await exchangeApiKeyForToken();
    return tokens.access_token;
  }
  if (!isExpired(tokens)) return tokens.access_token;

  if (NEWO_REFRESH_URL && tokens.refresh_token) {
    try {
      tokens = await refreshWithEndpoint(tokens.refresh_token);
      return tokens.access_token;
    } catch (e) {
      console.warn('Refresh failed, falling back to API key exchange…');
    }
  }
  tokens = await exchangeApiKeyForToken();
  return tokens.access_token;
}

export async function forceReauth() {
  const tokens = await exchangeApiKeyForToken();
  return tokens.access_token;
}
