/**
 * NEWO API Client - Refactored Version
 * Enhanced with improved error handling, request/response management, and infrastructure integration
 */
import axios from 'axios';
import { getValidAccessToken, forceReauth } from './auth.js';
import { config } from './config.js';
import { API_ENDPOINTS, DEFAULTS, HTTP_STATUS, RETRY_CONFIG, APP_VERSION } from './constants.js';
import { ApiError, AuthenticationError, NetworkError, ErrorHandler } from './errors.js';
import { logger } from './logger.js';
import { performanceMonitor, rateLimiter } from './performance.js';
import { Validator, VALIDATION_TYPES } from './validation.js';

// Enhanced API Configuration using constants
const API_CONFIG = {
  baseURL: config.NEWO_BASE_URL,
  timeout: DEFAULTS.TIMEOUT,
  maxRetries: RETRY_CONFIG.MAX_ATTEMPTS,
  retryDelay: RETRY_CONFIG.INITIAL_DELAY,
  maxDelay: RETRY_CONFIG.MAX_DELAY,
  backoffMultiplier: RETRY_CONFIG.BACKOFF_MULTIPLIER,
  retryableStatusCodes: RETRY_CONFIG.RETRYABLE_STATUS_CODES,
  requestDelay: config.NEWO_REQUEST_DELAY || 0, // Request delay from config
};

// API Endpoints Registry with parameterization helpers
const ENDPOINTS = {
  // Project endpoints
  PROJECTS_LIST: API_ENDPOINTS.PROJECTS,
  PROJECT_BY_ID: (id) => `${API_ENDPOINTS.PROJECT_BY_ID}/${id}`,
  
  // Agent endpoints
  AGENTS_LIST: API_ENDPOINTS.AGENTS_LIST,
  
  // Flow endpoints
  FLOW_SKILLS: (flowId) => `${API_ENDPOINTS.FLOW_SKILLS}/${flowId}/skills`,
  FLOW_EVENTS: (flowId) => `${API_ENDPOINTS.FLOW_EVENTS}/${flowId}/events`,
  FLOW_STATES: (flowId) => `${API_ENDPOINTS.FLOW_STATES}/${flowId}/states`,
  
  // Skill endpoints
  SKILL_GET: (skillId) => `${API_ENDPOINTS.SKILLS}/${skillId}`,
  SKILL_UPDATE: (skillId) => `${API_ENDPOINTS.FLOW_SKILLS}/skills/${skillId}`,
  
  // AKB endpoints
  AKB_IMPORT: API_ENDPOINTS.AKB_IMPORT,
};

// Export error classes from infrastructure
export { ApiError as APIError, AuthenticationError, NetworkError };

/**
 * Enhanced HTTP client factory with comprehensive error handling and retry logic
 */
export class NEWOAPIClient {
  constructor(options = {}) {
    this.verbose = options.verbose || false;
    this.accessToken = null;
    this.client = null;
    this.retryCount = 0;
  }

  /**
   * Initialize the API client with authentication
   */
  async initialize() {
    this.accessToken = await getValidAccessToken();
    if (this.verbose) console.log('✓ Access token obtained');

    this.client = axios.create({
      baseURL: API_CONFIG.baseURL,
      timeout: API_CONFIG.timeout,
      headers: { 
        accept: 'application/json',
        'User-Agent': 'NEWO-CLI/1.4.0'
      }
    });

    this._setupInterceptors();
    return this;
  }

  /**
   * Setup request and response interceptors with infrastructure integration
   */
  _setupInterceptors() {
    // Request interceptor with rate limiting and performance monitoring
    this.client.interceptors.request.use(
      async (config) => {
        const startTime = Date.now();
        const requestId = `api-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        // Rate limiting check
        const rateLimitResult = rateLimiter.isAllowed('api-requests');
        if (!rateLimitResult.allowed) {
          throw new ApiError(
            `Rate limit exceeded. Retry after ${rateLimitResult.retryAfter}s`,
            HTTP_STATUS.TOO_MANY_REQUESTS,
            config.url
          );
        }

        // Performance monitoring
        performanceMonitor.startTimer(requestId);
        config.metadata = { requestId, startTime };
        
        // Set headers
        config.headers = config.headers || {};
        config.headers.Authorization = `Bearer ${this.accessToken}`;
        config.headers['User-Agent'] = `NEWO-CLI/${APP_VERSION}`;
        config.headers['X-Request-ID'] = requestId;
        
        // Logging with structured format (only in verbose mode)
        if (this.verbose) {
          await logger.debug('API Request', {
            method: config.method?.toUpperCase(),
            url: config.url,
            requestId,
            hasData: !!config.data,
            hasParams: !!config.params,
            dataSize: config.data ? JSON.stringify(config.data).length : 0
          });
        }
        
        if (this.verbose) {
          console.log(`→ ${config.method?.toUpperCase()} ${config.url} [${requestId}]`);
          if (config.data && JSON.stringify(config.data).length < 1000) {
            console.log('  Data:', JSON.stringify(config.data, null, 2));
          } else if (config.data) {
            console.log(`  Data: [${typeof config.data}] ${Array.isArray(config.data) ? `${config.data.length} items` : 'large object'}`);
          }
          if (config.params) console.log('  Params:', config.params);
        }
        
        // Apply request delay if configured (avoiding naming conflict with request config)
        const requestDelay = API_CONFIG.requestDelay || 0;
        if (requestDelay > 0) {
          const delayStart = new Date();
          if (this.verbose) {
            console.log(`⏳ Applying ${requestDelay}ms delay before request at ${delayStart.toISOString()}`);
          }
          await new Promise(resolve => setTimeout(resolve, requestDelay));
          if (this.verbose) {
            const delayEnd = new Date();
            const actualDelay = delayEnd.getTime() - delayStart.getTime();
            console.log(`✓ Delay completed after ${actualDelay}ms at ${delayEnd.toISOString()}`);
          }
        } else if (this.verbose) {
          console.log(`⚡ No delay configured (NEWO_REQUEST_DELAY=${requestDelay})`);
        }
        
        return config;
      },
      async (error) => {
        await logger.error('Request configuration failed', { error: error.message });
        return Promise.reject(ErrorHandler.fromHttpError(error));
      }
    );

    // Response interceptor with performance monitoring and structured logging
    this.client.interceptors.response.use(
      async (response) => {
        const { requestId, startTime } = response.config.metadata || {};
        const duration = Date.now() - startTime;
        
        // Performance monitoring
        if (requestId) {
          performanceMonitor.endTimer(requestId, {
            method: response.config.method,
            url: response.config.url,
            status: response.status,
            responseSize: JSON.stringify(response.data).length
          });
        }
        
        // Log API call metrics
        await logger.logApiCall(
          response.config.method,
          response.config.url,
          response.status,
          duration
        );
        
        if (this.verbose) {
          console.log(`← ${response.status} ${response.config.method?.toUpperCase()} ${response.config.url} [${requestId}] (${duration}ms)`);
          if (response.data && typeof response.data === 'object') {
            const dataSize = Array.isArray(response.data) ? response.data.length : Object.keys(response.data).length;
            if (dataSize < 20) {
              console.log('  Response:', JSON.stringify(response.data, null, 2));
            } else {
              console.log(`  Response: [${typeof response.data}] ${Array.isArray(response.data) ? `${response.data.length} items` : `${dataSize} properties`}`);
            }
          }
        }
        
        this.retryCount = 0; // Reset retry count on success
        return response;
      },
      async (error) => {
        const status = error?.response?.status;
        const endpoint = error?.config?.url;
        const { requestId, startTime } = error.config?.metadata || {};
        const duration = Date.now() - (startTime || Date.now());
        
        // Performance monitoring for failed requests
        if (requestId) {
          performanceMonitor.endTimer(requestId, {
            method: error.config?.method,
            url: endpoint,
            status,
            error: error.message,
            failed: true
          });
        }
        
        // Log API error
        await logger.logApiCall(
          error.config?.method,
          endpoint,
          status,
          duration,
          error
        );

        if (this.verbose) {
          console.log(`← ${status || 'NETWORK'} ${error.config?.method?.toUpperCase()} ${endpoint} [${requestId}] (${duration}ms) - ${error.message}`);
          if (error.response?.data) {
            console.log('  Error data:', JSON.stringify(error.response.data, null, 2));
          }
        }

        // Handle authentication errors with retry
        if (status === HTTP_STATUS.UNAUTHORIZED && this.retryCount < 1) {
          this.retryCount++;
          await logger.info('Retrying with fresh authentication token');
          
          try {
            this.accessToken = await forceReauth();
            error.config.headers.Authorization = `Bearer ${this.accessToken}`;
            return this.client.request(error.config);
          } catch (authError) {
            const authenticationError = new AuthenticationError(
              'Failed to refresh authentication',
              { endpoint, originalError: authError.message }
            );
            throw await ErrorHandler.handle(authenticationError, logger, { operation: 'token_refresh' });
          }
        }

        // Handle retryable errors with exponential backoff
        const isRetryable = API_CONFIG.retryableStatusCodes.includes(status) || !status;
        if (isRetryable && this.retryCount < API_CONFIG.maxRetries) {
          this.retryCount++;
          const delay = Math.min(
            API_CONFIG.retryDelay * Math.pow(API_CONFIG.backoffMultiplier, this.retryCount - 1),
            API_CONFIG.maxDelay
          );
          
          await logger.warn(`Retrying request (${this.retryCount}/${API_CONFIG.maxRetries}) after ${delay}ms`, {
            endpoint,
            status,
            attempt: this.retryCount
          });
          
          await this._delay(delay);
          return this.client.request(error.config);
        }

        // Convert to structured error and handle
        const structuredError = ErrorHandler.fromHttpError(error, endpoint);
        throw await ErrorHandler.handle(structuredError, logger, { 
          operation: 'api_request',
          endpoint,
          method: error.config?.method 
        });
      }
    );
  }

  /**
   * Utility method for delays
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Generic request method with validation and enhanced error handling
   */
  async _request(method, endpoint, data = null, params = null) {
    if (!this.client) {
      throw new Error('Client not initialized. Call initialize() first.');
    }

    // Validate endpoint
    Validator.validate(endpoint, {
      type: VALIDATION_TYPES.STRING,
      required: true,
      min: 1,
      custom: (value) => value.startsWith('/') || 'Endpoint must start with /'
    }, 'endpoint');

    const config = {
      method: method.toUpperCase(),
      url: endpoint,
      ...(data && { data }),
      ...(params && { params })
    };

    try {
      const response = await this.client.request(config);
      return response.data;
    } catch (error) {
      if (error instanceof ApiError || error instanceof AuthenticationError || error instanceof NetworkError) {
        throw error;
      }
      
      // Handle unexpected errors
      const unexpectedError = new ApiError(
        `Unexpected error: ${error.message}`,
        null,
        endpoint,
        { originalError: error.message, stack: error.stack }
      );
      
      throw await ErrorHandler.handle(unexpectedError, logger, { 
        operation: 'api_request',
        method,
        endpoint 
      });
    }
  }

  // Project Management Methods with validation
  async listProjects() {
    await logger.debug('Listing all projects');
    return this._request('GET', ENDPOINTS.PROJECTS_LIST);
  }

  async getProjectMeta(projectId) {
    // Validate project ID
    const validatedId = Validator.validate(projectId, {
      type: VALIDATION_TYPES.UUID,
      required: true
    }, 'projectId');
    
    await logger.debug('Getting project metadata', { projectId: validatedId });
    return this._request('GET', ENDPOINTS.PROJECT_BY_ID(validatedId));
  }

  // Agent Management Methods with validation
  async listAgents(projectId) {
    const validatedId = Validator.validate(projectId, {
      type: VALIDATION_TYPES.UUID,
      required: true
    }, 'projectId');
    
    await logger.debug('Listing agents for project', { projectId: validatedId });
    return this._request('GET', ENDPOINTS.AGENTS_LIST, null, { project_id: validatedId });
  }

  // Flow Management Methods
  async listFlowSkills(flowId) {
    if (!flowId) throw new Error('Flow ID is required');
    return this._request('GET', ENDPOINTS.FLOW_SKILLS(flowId));
  }

  async listFlowEvents(flowId) {
    if (!flowId) throw new Error('Flow ID is required');
    return this._request('GET', ENDPOINTS.FLOW_EVENTS(flowId));
  }

  async listFlowStates(flowId) {
    if (!flowId) throw new Error('Flow ID is required');
    return this._request('GET', ENDPOINTS.FLOW_STATES(flowId));
  }

  // Skill Management Methods with comprehensive validation
  async getSkill(skillId) {
    const validatedId = Validator.validate(skillId, {
      type: VALIDATION_TYPES.UUID,
      required: true
    }, 'skillId');
    
    await logger.debug('Getting skill', { skillId: validatedId });
    return this._request('GET', ENDPOINTS.SKILL_GET(validatedId));
  }

  async updateSkill(skillObject) {
    // Validate skill object structure
    const validatedSkill = Validator.validateObject(skillObject, {
      id: {
        type: VALIDATION_TYPES.UUID,
        required: true
      },
      title: {
        type: VALIDATION_TYPES.STRING,
        required: true,
        min: 1,
        max: 200
      },
      idn: {
        type: VALIDATION_TYPES.STRING,
        required: true,
        min: 1,
        max: 100
      },
      content: {
        type: VALIDATION_TYPES.STRING,
        required: false
      },
      runner_type: {
        type: VALIDATION_TYPES.ENUM,
        enum: ['guidance', 'nsl'],
        required: false
      }
    });
    
    await logger.debug('Updating skill', { 
      skillId: validatedSkill.id,
      title: validatedSkill.title,
      runnerType: validatedSkill.runner_type
    });
    
    return this._request('PUT', ENDPOINTS.SKILL_UPDATE(validatedSkill.id), validatedSkill);
  }

  // AKB Management Methods with validation
  async importAkbArticle(articleData) {
    // Validate article data structure
    const validatedArticle = Validator.validateObject(articleData, {
      topic_name: {
        type: VALIDATION_TYPES.STRING,
        required: true,
        min: 1,
        max: 200
      },
      source: {
        type: VALIDATION_TYPES.STRING,
        required: true,
        min: 1,
        max: 100
      },
      topic_summary: {
        type: VALIDATION_TYPES.STRING,
        required: true,
        min: 1
      },
      persona_id: {
        type: VALIDATION_TYPES.UUID,
        required: false
      }
    });
    
    await logger.debug('Importing AKB article', { 
      topicName: validatedArticle.topic_name,
      source: validatedArticle.source,
      personaId: validatedArticle.persona_id
    });
    
    return this._request('POST', ENDPOINTS.AKB_IMPORT, validatedArticle);
  }

  // Utility Methods
  getEndpoints() {
    return { ...ENDPOINTS };
  }

  getConfig() {
    return { ...API_CONFIG };
  }

  isInitialized() {
    return !!this.client && !!this.accessToken;
  }
}

/**
 * Factory function to create and initialize API client
 * Maintains backward compatibility with existing code
 */
export async function makeClient(verbose = false) {
  const apiClient = new NEWOAPIClient({ verbose });
  await apiClient.initialize();
  
  // Return legacy-compatible client interface
  return {
    get: (url, config) => apiClient.client.get(url, config),
    post: (url, data, config) => apiClient.client.post(url, data, config),
    put: (url, data, config) => apiClient.client.put(url, data, config),
    delete: (url, config) => apiClient.client.delete(url, config),
    request: (config) => apiClient.client.request(config),
    
    // Enhanced methods
    listProjects: () => apiClient.listProjects(),
    getProjectMeta: (projectId) => apiClient.getProjectMeta(projectId),
    listAgents: (projectId) => apiClient.listAgents(projectId),
    listFlowSkills: (flowId) => apiClient.listFlowSkills(flowId),
    listFlowEvents: (flowId) => apiClient.listFlowEvents(flowId),
    listFlowStates: (flowId) => apiClient.listFlowStates(flowId),
    getSkill: (skillId) => apiClient.getSkill(skillId),
    updateSkill: (skillObject) => apiClient.updateSkill(skillObject),
    importAkbArticle: (articleData) => apiClient.importAkbArticle(articleData),
  };
}

// Export legacy functions for backward compatibility
export async function listProjects(client) {
  const response = await client.get(ENDPOINTS.PROJECTS_LIST);
  return response.data;
}

export async function listAgents(client, projectId) {
  const response = await client.get(ENDPOINTS.AGENTS_LIST, { params: { project_id: projectId } });
  return response.data;
}

export async function getProjectMeta(client, projectId) {
  const response = await client.get(ENDPOINTS.PROJECT_BY_ID(projectId));
  return response.data;
}

export async function listFlowSkills(client, flowId) {
  const response = await client.get(ENDPOINTS.FLOW_SKILLS(flowId));
  return response.data;
}

export async function getSkill(client, skillId) {
  const response = await client.get(ENDPOINTS.SKILL_GET(skillId));
  return response.data;
}

export async function updateSkill(client, skillObject) {
  await client.put(ENDPOINTS.SKILL_UPDATE(skillObject.id), skillObject);
}

export async function listFlowEvents(client, flowId) {
  const response = await client.get(ENDPOINTS.FLOW_EVENTS(flowId));
  return response.data;
}

export async function listFlowStates(client, flowId) {
  const response = await client.get(ENDPOINTS.FLOW_STATES(flowId));
  return response.data;
}

export async function importAkbArticle(client, articleData) {
  const response = await client.post(ENDPOINTS.AKB_IMPORT, articleData);
  return response.data;
}

// Error classes are already exported above as individual exports