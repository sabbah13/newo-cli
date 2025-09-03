import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs-extra';

// Load environment variables
dotenv.config();

/**
 * Configuration validation schema
 */
const CONFIG_SCHEMA = {
  NEWO_BASE_URL: {
    type: 'string',
    default: 'https://app.newo.ai',
    validate: (value) => {
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    },
    required: false
  },
  NEWO_PROJECT_ID: {
    type: 'string',
    default: null,
    validate: (value) => !value || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
    required: false
  },
  NEWO_API_KEY: {
    type: 'string',
    default: null,
    validate: (value) => !value || value.length >= 10,
    required: false,
    sensitive: true
  },
  NEWO_ACCESS_TOKEN: {
    type: 'string',
    default: null,
    validate: (value) => !value || value.length >= 10,
    required: false,
    sensitive: true
  },
  NEWO_REFRESH_TOKEN: {
    type: 'string',
    default: null,
    validate: (value) => !value || value.length >= 10,
    required: false,
    sensitive: true
  },
  NEWO_REFRESH_URL: {
    type: 'string',
    default: null,
    validate: (value) => {
      if (!value) return true;
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    },
    required: false
  },
  NODE_ENV: {
    type: 'string',
    default: 'development',
    validate: (value) => ['development', 'production', 'test'].includes(value),
    required: false
  },
  // Rate limiting and retry configurations
  NEWO_RATE_LIMIT_MAX_REQUESTS: {
    type: 'number',
    default: 5000, // High default for comfortable usage
    validate: (value) => value > 0 && value <= 50000, // Allow up to 50k for high-throughput usage
    required: false
  },
  NEWO_RATE_LIMIT_WINDOW: {
    type: 'number', 
    default: 60000, // 1 minute
    validate: (value) => value > 0,
    required: false
  },
  NEWO_RETRY_MAX_ATTEMPTS: {
    type: 'number',
    default: 5, // Increased from 3
    validate: (value) => value >= 1 && value <= 10,
    required: false
  },
  NEWO_RETRY_INITIAL_DELAY: {
    type: 'number',
    default: 2000, // Increased from 1000 (2 seconds)
    validate: (value) => value >= 100 && value <= 30000,
    required: false
  },
  NEWO_RETRY_MAX_DELAY: {
    type: 'number', 
    default: 30000, // Increased from 10000 (30 seconds)
    validate: (value) => value >= 1000,
    required: false
  },
  NEWO_RETRY_BACKOFF_MULTIPLIER: {
    type: 'number',
    default: 1.5, // Reduced from 2 for gentler backoff
    validate: (value) => value >= 1 && value <= 5,
    required: false
  },
  NEWO_API_TIMEOUT: {
    type: 'number',
    default: 60000, // 60 seconds
    validate: (value) => value > 0,
    required: false
  },
  NEWO_CONCURRENT_REQUESTS: {
    type: 'number',
    default: 20, // Increased from 10
    validate: (value) => value > 0 && value <= 100,
    required: false
  },
  NEWO_REQUEST_DELAY: {
    type: 'number',
    default: 100, // 100ms delay between requests 
    validate: (value) => value >= 0,
    required: false
  }
};

/**
 * Configuration validation errors
 */
class ConfigValidationError extends Error {
  constructor(field, message) {
    super(`Configuration validation error for ${field}: ${message}`);
    this.name = 'ConfigValidationError';
    this.field = field;
  }
}

/**
 * Validate a configuration value against its schema
 */
function validateConfigValue(key, value, schema) {
  if (value === null || value === undefined) {
    if (schema.required) {
      throw new ConfigValidationError(key, 'Required field is missing');
    }
    return schema.default;
  }

  // Type validation
  if (schema.type === 'string' && typeof value !== 'string') {
    throw new ConfigValidationError(key, `Expected string, got ${typeof value}`);
  }

  if (schema.type === 'number' && typeof value !== 'number') {
    const numValue = Number(value);
    if (isNaN(numValue)) {
      throw new ConfigValidationError(key, 'Expected number');
    }
    value = numValue;
  }

  if (schema.type === 'boolean' && typeof value !== 'boolean') {
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else throw new ConfigValidationError(key, 'Expected boolean');
  }

  // Custom validation
  if (schema.validate && !schema.validate(value)) {
    throw new ConfigValidationError(key, 'Custom validation failed');
  }

  return value;
}

/**
 * Load and validate configuration
 */
function loadConfig() {
  const config = {};
  const errors = [];

  for (const [key, schema] of Object.entries(CONFIG_SCHEMA)) {
    try {
      const envValue = process.env[key];
      config[key] = validateConfigValue(key, envValue, schema);
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length > 0) {
    const errorMessage = errors.map(e => e.message).join('\n');
    throw new Error(`Configuration validation failed:\n${errorMessage}`);
  }

  return config;
}

/**
 * Get sanitized configuration for logging (removes sensitive values)
 */
function getSanitizedConfig(config) {
  const sanitized = { ...config };
  
  for (const [key, schema] of Object.entries(CONFIG_SCHEMA)) {
    if (schema.sensitive && sanitized[key]) {
      sanitized[key] = '[REDACTED]';
    }
  }
  
  return sanitized;
}

/**
 * Validate authentication configuration
 */
function validateAuthConfig(config) {
  const hasApiKey = config.NEWO_API_KEY;
  const hasTokens = config.NEWO_ACCESS_TOKEN && config.NEWO_REFRESH_TOKEN;
  
  if (!hasApiKey && !hasTokens) {
    throw new Error(
      'Authentication configuration missing. ' +
      'Provide either NEWO_API_KEY or both NEWO_ACCESS_TOKEN and NEWO_REFRESH_TOKEN'
    );
  }
  
  return true;
}

/**
 * Get application directories configuration
 */
function getDirectories() {
  const cwd = process.cwd();
  return {
    root: path.join(cwd, 'projects'),
    state: path.join(cwd, '.newo'),
    temp: path.join(cwd, '.newo', 'temp'),
    cache: path.join(cwd, '.newo', 'cache'),
    logs: path.join(cwd, '.newo', 'logs')
  };
}

/**
 * Ensure all required directories exist
 */
async function ensureDirectories() {
  const dirs = getDirectories();
  
  for (const dir of Object.values(dirs)) {
    await fs.ensureDir(dir);
  }
  
  return dirs;
}

// Load and export configuration
let appConfig;
try {
  appConfig = loadConfig();
  validateAuthConfig(appConfig);
} catch (error) {
  console.error('❌ Configuration Error:', error.message);
  process.exit(1);
}

export {
  appConfig as config,
  CONFIG_SCHEMA,
  ConfigValidationError,
  validateConfigValue,
  getSanitizedConfig,
  validateAuthConfig,
  getDirectories,
  ensureDirectories
};