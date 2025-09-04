import type { NewoEnvironment } from './types.js';

/**
 * Validated environment configuration
 */
export interface ValidatedEnv {
  readonly NEWO_BASE_URL: string;
  readonly NEWO_PROJECT_ID: string | undefined;
  readonly NEWO_API_KEY: string | undefined;
  readonly NEWO_API_KEYS: string | undefined;
  readonly NEWO_ACCESS_TOKEN: string | undefined;
  readonly NEWO_REFRESH_TOKEN: string | undefined;
  readonly NEWO_REFRESH_URL: string | undefined;
  readonly NEWO_DEFAULT_CUSTOMER: string | undefined;
  // Dynamic customer entries will be detected at runtime
  readonly [key: string]: string | undefined;
}

/**
 * Environment validation errors with clear messaging
 */
export class EnvValidationError extends Error {
  constructor(message: string) {
    super(`Environment validation failed: ${message}`);
    this.name = 'EnvValidationError';
  }
}

/**
 * Validates required environment variables and returns typed configuration
 */
export function validateEnvironment(): ValidatedEnv {
  const env = process.env as NewoEnvironment;
  
  const baseUrl = env.NEWO_BASE_URL?.trim() || 'https://app.newo.ai';
  const projectId = env.NEWO_PROJECT_ID?.trim();
  const apiKey = env.NEWO_API_KEY?.trim();
  const accessToken = env.NEWO_ACCESS_TOKEN?.trim();
  const refreshToken = env.NEWO_REFRESH_TOKEN?.trim();
  const refreshUrl = env.NEWO_REFRESH_URL?.trim();

  // Base URL validation
  if (!isValidUrl(baseUrl)) {
    throw new EnvValidationError(
      `NEWO_BASE_URL must be a valid URL. Received: ${baseUrl}`
    );
  }

  // Project ID is optional - if not set, pull all projects
  // If provided, validate UUID format
  if (projectId && !isValidUuid(projectId)) {
    throw new EnvValidationError(
      `NEWO_PROJECT_ID must be a valid UUID when provided. Received: ${projectId}`
    );
  }

  // Authentication validation - at least one method required
  const hasApiKey = !!apiKey;
  const hasApiKeys = !!env.NEWO_API_KEYS?.trim();
  const hasDirectTokens = !!(accessToken && refreshToken);
  
  if (!hasApiKey && !hasApiKeys && !hasDirectTokens) {
    throw new EnvValidationError(
      'Authentication required: Set NEWO_API_KEY, NEWO_API_KEYS (recommended), or both NEWO_ACCESS_TOKEN and NEWO_REFRESH_TOKEN'
    );
  }

  // If refresh URL is provided, validate it
  if (refreshUrl && !isValidUrl(refreshUrl)) {
    throw new EnvValidationError(
      `NEWO_REFRESH_URL must be a valid URL when provided. Received: ${refreshUrl}`
    );
  }

  return {
    NEWO_BASE_URL: baseUrl,
    NEWO_PROJECT_ID: projectId || undefined,
    NEWO_API_KEY: apiKey,
    NEWO_API_KEYS: env.NEWO_API_KEYS?.trim(),
    NEWO_ACCESS_TOKEN: accessToken,
    NEWO_REFRESH_TOKEN: refreshToken,
    NEWO_REFRESH_URL: refreshUrl,
    NEWO_DEFAULT_CUSTOMER: env.NEWO_DEFAULT_CUSTOMER?.trim(),
  };
}

/**
 * Validates if a string is a valid URL
 */
function isValidUrl(urlString: string): boolean {
  try {
    new URL(urlString);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates if a string is a valid UUID (v4 format)
 */
function isValidUuid(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * Global validated environment - call validateEnvironment() once at startup
 */
export let ENV: ValidatedEnv;

/**
 * Initialize environment validation - must be called at application startup
 */
export function initializeEnvironment(): ValidatedEnv {
  ENV = validateEnvironment();
  return ENV;
}