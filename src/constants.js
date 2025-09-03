/**
 * Application constants and configuration values
 */

// Application metadata
export const APP_NAME = 'NEWO CLI';
export const APP_VERSION = '1.4.0';
export const APP_DESCRIPTION = 'NEWO CLI: sync flows/skills between NEWO and local files';

// Command names
export const COMMANDS = {
  PULL: 'pull',
  PUSH: 'push',
  STATUS: 'status',
  META: 'meta',
  IMPORT_AKB: 'import-akb',
  HELP: 'help'
};

// Valid commands array
export const VALID_COMMANDS = Object.values(COMMANDS);

// Help flags
export const HELP_FLAGS = ['help', '-h', '--help'];

// File extensions
export const FILE_EXTENSIONS = {
  GUIDANCE: '.guidance',
  JINJA: '.jinja',
  JSON: '.json',
  YAML: '.yaml',
  YML: '.yml',
  MARKDOWN: '.md',
  TEXT: '.txt'
};

// Runner types
export const RUNNER_TYPES = {
  GUIDANCE: 'guidance',
  NSL: 'nsl'
};

// Default values
export const DEFAULTS = {
  BASE_URL: 'https://app.newo.ai',
  TIMEOUT: 30000, // 30 seconds
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000, // 1 second
  CHUNK_SIZE: 1024 * 1024, // 1MB
  MAX_PARALLEL_OPERATIONS: process.env.NEWO_CONCURRENT_REQUESTS ? Number(process.env.NEWO_CONCURRENT_REQUESTS) : 20,
  CACHE_TTL: 300000, // 5 minutes
  LOG_LEVEL: 'INFO',
  RATE_LIMIT_WINDOW: process.env.NEWO_RATE_LIMIT_WINDOW ? Number(process.env.NEWO_RATE_LIMIT_WINDOW) : 60000,
  RATE_LIMIT_MAX_REQUESTS: process.env.NEWO_RATE_LIMIT_MAX_REQUESTS ? Number(process.env.NEWO_RATE_LIMIT_MAX_REQUESTS) : 5000
};

// Directory structure
export const DIRECTORIES = {
  PROJECTS: 'projects',
  STATE: '.newo',
  CACHE: 'cache',
  LOGS: 'logs',
  TEMP: 'temp'
};

// File names
export const FILES = {
  TOKENS: 'tokens.json',
  SECURE_TOKENS: 'tokens.secure',
  MAP: 'map.json',
  HASHES: 'hashes.json',
  METADATA: 'metadata.json',
  FLOWS: 'flows.yaml',
  CONFIG: 'jinja-lsp.toml'
};

// API endpoints
export const API_ENDPOINTS = {
  AUTH_TOKEN: '/api/v1/auth/api-key/token',
  PROJECTS: '/api/v1/designer/projects',
  PROJECT_BY_ID: '/api/v1/designer/projects/by-id',
  AGENTS_LIST: '/api/v1/bff/agents/list',
  FLOW_SKILLS: '/api/v1/designer/flows',
  SKILLS: '/api/v1/designer/skills',
  FLOW_EVENTS: '/api/v1/designer/flows',
  FLOW_STATES: '/api/v1/designer/flows',
  AKB_IMPORT: '/api/v1/akb/append-manual'
};

// HTTP status codes
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504
};

// Error codes
export const ERROR_CODES = {
  NEWO_ERROR: 'NEWO_ERROR',
  AUTH_ERROR: 'AUTH_ERROR',
  AUTHZ_ERROR: 'AUTHZ_ERROR',
  API_ERROR: 'API_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  FS_ERROR: 'FS_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  CONFIG_ERROR: 'CONFIG_ERROR',
  SYNC_ERROR: 'SYNC_ERROR',
  AKB_IMPORT_ERROR: 'AKB_IMPORT_ERROR',
  RATE_LIMIT_ERROR: 'RATE_LIMIT_ERROR',
  TIMEOUT_ERROR: 'TIMEOUT_ERROR',
  SECURITY_ERROR: 'SECURITY_ERROR'
};

// Performance thresholds
export const PERFORMANCE_THRESHOLDS = {
  SLOW_OPERATION_MS: 5000, // 5 seconds
  MEMORY_WARNING_MB: 100,
  MAX_FILE_SIZE_MB: 10,
  MAX_PARALLEL_FILES: 20,
  CACHE_SIZE_LIMIT: 1000
};

// Security constants
export const SECURITY_LIMITS = {
  MAX_STRING_LENGTH: 10000,
  MAX_PATH_LENGTH: 1000,
  MIN_API_KEY_LENGTH: 10,
  MIN_TOKEN_LENGTH: 10,
  MAX_FILENAME_LENGTH: 255,
  SESSION_TIMEOUT_MS: 3600000 // 1 hour
};

// Validation patterns
export const VALIDATION_PATTERNS = {
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  API_KEY: /^[a-zA-Z0-9_-]{10,}$/,
  SAFE_FILENAME: /^[a-zA-Z0-9._-]+$/,
  PROJECT_IDN: /^[a-zA-Z0-9_-]+$/,
  AGENT_IDN: /^[a-zA-Z0-9_-]+$/,
  FLOW_IDN: /^[a-zA-Z0-9_-]+$/,
  SKILL_IDN: /^[a-zA-Z0-9_-]+$/
};

// Environment variables
export const ENV_VARS = {
  NEWO_BASE_URL: 'NEWO_BASE_URL',
  NEWO_PROJECT_ID: 'NEWO_PROJECT_ID',
  NEWO_API_KEY: 'NEWO_API_KEY',
  NEWO_ACCESS_TOKEN: 'NEWO_ACCESS_TOKEN',
  NEWO_REFRESH_TOKEN: 'NEWO_REFRESH_TOKEN',
  NEWO_REFRESH_URL: 'NEWO_REFRESH_URL',
  NODE_ENV: 'NODE_ENV'
};

// Log messages
export const LOG_MESSAGES = {
  STARTING_OPERATION: 'Starting operation',
  OPERATION_COMPLETE: 'Operation completed',
  OPERATION_FAILED: 'Operation failed',
  AUTHENTICATING: 'Authenticating with NEWO API',
  AUTH_SUCCESS: 'Authentication successful',
  AUTH_FAILED: 'Authentication failed',
  FETCHING_DATA: 'Fetching data from API',
  DATA_RECEIVED: 'Data received successfully',
  FILE_OPERATION: 'Performing file operation',
  FILE_SUCCESS: 'File operation successful',
  FILE_FAILED: 'File operation failed',
  VALIDATION_ERROR: 'Validation error occurred',
  SECURITY_WARNING: 'Security warning',
  PERFORMANCE_WARNING: 'Performance warning'
};

// AKB import constants
export const AKB_CONSTANTS = {
  ARTICLE_SEPARATOR: '---',
  DEFAULT_CONFIDENCE: 100,
  DEFAULT_LABELS: ['rag_context'],
  MAX_ARTICLE_SIZE: 50000, // 50KB
  BATCH_SIZE: 10
};

// Retry configuration - now configurable via environment variables
export const RETRY_CONFIG = {
  MAX_ATTEMPTS: process.env.NEWO_RETRY_MAX_ATTEMPTS ? Number(process.env.NEWO_RETRY_MAX_ATTEMPTS) : 5,
  INITIAL_DELAY: process.env.NEWO_RETRY_INITIAL_DELAY ? Number(process.env.NEWO_RETRY_INITIAL_DELAY) : 2000,
  MAX_DELAY: process.env.NEWO_RETRY_MAX_DELAY ? Number(process.env.NEWO_RETRY_MAX_DELAY) : 30000,
  BACKOFF_MULTIPLIER: process.env.NEWO_RETRY_BACKOFF_MULTIPLIER ? Number(process.env.NEWO_RETRY_BACKOFF_MULTIPLIER) : 1.5,
  RETRYABLE_STATUS_CODES: [429, 500, 502, 503, 504],
  RETRYABLE_ERROR_CODES: ['ECONNRESET', 'ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT']
};

// Cache configuration
export const CACHE_CONFIG = {
  DEFAULT_TTL: 300000, // 5 minutes
  MAX_SIZE: 1000,
  CLEANUP_INTERVAL: 300000, // 5 minutes
  FILE_CACHE_TTL: 60000, // 1 minute
  API_CACHE_TTL: 180000 // 3 minutes
};

// Progress indicators
export const PROGRESS_INDICATORS = {
  SPINNER_CHARS: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  PROGRESS_BAR_WIDTH: 40,
  UPDATE_INTERVAL: 100, // milliseconds
  DOTS_INTERVAL: 500 // milliseconds
};

// Success/failure emojis and indicators
export const INDICATORS = {
  SUCCESS: '✅',
  ERROR: '❌',
  WARNING: '⚠️',
  INFO: 'ℹ️',
  LOADING: '🔄',
  SECURITY: '🛡️',
  PERFORMANCE: '⚡',
  FILE: '📄',
  FOLDER: '📁',
  UPLOAD: '📤',
  DOWNLOAD: '📥',
  SYNC: '🔄',
  API: '🌐',
  CACHE: '💾',
  TIME: '⏱️'
};

// Usage examples and help text
export const HELP_TEXT = {
  USAGE: `${APP_NAME}
Usage:
  newo pull                    # download all projects -> ./projects/ OR specific project if NEWO_PROJECT_ID set
  newo push                    # upload modified *.guidance/*.jinja back to NEWO
  newo status                  # show modified files
  newo meta                    # get project metadata (debug, requires NEWO_PROJECT_ID)
  newo import-akb <file> <persona_id>  # import AKB articles from file
  
Flags:
  --verbose, -v                # enable detailed logging
  
Env:
  NEWO_BASE_URL, NEWO_PROJECT_ID (optional), NEWO_API_KEY, NEWO_REFRESH_URL (optional)
  
Notes:
  - multi-project support: pull downloads all accessible projects or single project based on NEWO_PROJECT_ID
  - If NEWO_PROJECT_ID is set, pull downloads only that project
  - If NEWO_PROJECT_ID is not set, pull downloads all projects accessible with your API key
  - Projects are stored in ./projects/{project-idn}/ folders
  - Each project folder contains metadata.json and flows.yaml`,

  EXAMPLES: {
    PULL_ALL: 'newo pull',
    PULL_SINGLE: 'NEWO_PROJECT_ID=abc123 newo pull',
    PUSH: 'newo push',
    STATUS: 'newo status',
    VERBOSE: 'newo pull --verbose',
    IMPORT_AKB: 'newo import-akb articles.txt persona-id-123'
  }
};

// Export grouped constants for easier imports
export const CONSTANTS = {
  APP_NAME,
  APP_VERSION,
  APP_DESCRIPTION,
  COMMANDS,
  VALID_COMMANDS,
  HELP_FLAGS,
  FILE_EXTENSIONS,
  RUNNER_TYPES,
  DEFAULTS,
  DIRECTORIES,
  FILES,
  API_ENDPOINTS,
  HTTP_STATUS,
  ERROR_CODES,
  PERFORMANCE_THRESHOLDS,
  SECURITY_LIMITS,
  VALIDATION_PATTERNS,
  ENV_VARS,
  LOG_MESSAGES,
  AKB_CONSTANTS,
  RETRY_CONFIG,
  CACHE_CONFIG,
  PROGRESS_INDICATORS,
  INDICATORS,
  HELP_TEXT
};