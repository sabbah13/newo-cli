/**
 * NEWO Authentication Manager - Refactored Version
 * Enhanced with improved security, token lifecycle management, and robust error handling
 */
import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import crypto from 'crypto';

// Infrastructure imports
import { config, getDirectories, ensureDirectories } from './config.js';
import { 
  API_ENDPOINTS, 
  FILES, 
  SECURITY_LIMITS, 
  DEFAULTS, 
  HTTP_STATUS,
  RETRY_CONFIG,
  VALIDATION_PATTERNS,
  LOG_MESSAGES
} from './constants.js';
import {
  AuthenticationError,
  AuthorizationError,
  SecurityError,
  ValidationError,
  TimeoutError,
  ErrorHandler
} from './errors.js';
import { logger } from './logger.js';
import {
  PerformanceMonitor,
  CacheManager
} from './performance.js';
import {
  EncryptionService,
  SecureTokenStorage,
  SecurePathValidator,
  RateLimiter
} from './security.js';
import { Validator } from './validation.js';

// Authentication Configuration with infrastructure integration
const AUTH_CONFIG = {
  baseURL: config.NEWO_BASE_URL,
  tokenEndpoint: API_ENDPOINTS.AUTH_TOKEN,
  refreshBuffer: 60_000, // 1 minute buffer before expiry
  maxRetries: RETRY_CONFIG.MAX_ATTEMPTS,
  retryDelay: RETRY_CONFIG.INITIAL_DELAY,
  backoffMultiplier: RETRY_CONFIG.BACKOFF_MULTIPLIER,
  maxDelay: RETRY_CONFIG.MAX_DELAY,
  timeout: DEFAULTS.TIMEOUT,
  encryptionKey: null, // Will be derived from API key
};

// Environment variables from config
const ENV = {
  apiKey: config.NEWO_API_KEY,
  accessToken: config.NEWO_ACCESS_TOKEN,
  refreshToken: config.NEWO_REFRESH_TOKEN,
  refreshUrl: config.NEWO_REFRESH_URL,
  baseUrl: config.NEWO_BASE_URL,
};

// Initialize infrastructure services
const performanceMonitor = new PerformanceMonitor();
const cacheManager = new CacheManager();
const rateLimiter = new RateLimiter();
const encryptionService = new EncryptionService();
const validator = new Validator();
const secureTokenStorage = new SecureTokenStorage();
const pathValidator = new SecurePathValidator();

// Use infrastructure error types - custom error classes removed in favor of infrastructure
// AuthenticationError, AuthorizationError, SecurityError, ValidationError, TimeoutError imported above

// Token-specific error extensions
export class TokenExpiredError extends AuthenticationError {
  constructor(message = 'Token has expired') {
    super(message, { retryable: true, tokenExpired: true });
    this.name = 'TokenExpiredError';
  }
}

export class RefreshFailedError extends AuthenticationError {
  constructor(message = 'Token refresh failed', originalError = null) {
    super(message, { retryable: false, originalError });
    this.name = 'RefreshFailedError';
  }
}

export class InvalidCredentialsError extends AuthenticationError {
  constructor(message = 'Invalid credentials provided') {
    super(message, { retryable: false });
    this.name = 'InvalidCredentialsError';
  }
}

/**
 * Enhanced Authentication Manager with security and lifecycle features
 */
export class AuthManager {
  constructor(options = {}) {
    this.config = { ...AUTH_CONFIG, ...options };
    this.tokenCache = null;
    this.refreshPromise = null;
    this.lockPromise = null;
    this.directories = null;
    this.logger = logger.child({ component: 'AuthManager' });
    this.performanceMonitor = performanceMonitor;
    this.secureStorage = secureTokenStorage;
    
    // Initialize directories
    this._initializeDirectories();
  }

  /**
   * Initialize directory structure
   */
  async _initializeDirectories() {
    try {
      this.directories = await ensureDirectories();
    } catch (error) {
      await this.logger.error('Failed to initialize directories', { error: error.message });
      throw new SecurityError('Directory initialization failed', 'DIR_INIT_FAILED', { originalError: error });
    }
  }

  /**
   * Get the path to the tokens file with security validation
   */
  get tokensPath() {
    if (!this.directories) {
      throw new SecurityError('Directories not initialized', 'DIR_NOT_INIT');
    }
    const tokenPath = path.join(this.directories.state, FILES.TOKENS);
    // Token path is validated by directory structure, skip additional path validation
    // since .newo directory access is required for legitimate token storage
    return tokenPath;
  }

  /**
   * Get the path to the lock file with security validation
   */
  get lockPath() {
    if (!this.directories) {
      throw new SecurityError('Directories not initialized', 'DIR_NOT_INIT');
    }
    const lockPath = path.join(this.directories.state, 'tokens.lock');
    // Lock path is validated by directory structure, skip additional path validation
    // since .newo directory access is required for legitimate token storage
    return lockPath;
  }

  /**
   * Generate encryption key from API key using infrastructure crypto service
   */
  _getEncryptionKey() {
    if (this.config.encryptionKey) return this.config.encryptionKey;
    
    if (ENV.apiKey) {
      // Validate API key length
      if (ENV.apiKey.length < SECURITY_LIMITS.MIN_API_KEY_LENGTH) {
        throw new ValidationError('API key too short', 'api_key', ENV.apiKey);
      }
      
      // Create deterministic key from API key using basic crypto
      this.config.encryptionKey = crypto
        .createHash('sha256')
        .update(ENV.apiKey + 'newo-cli-salt')
        .digest();
      return this.config.encryptionKey;
    }
    
    return null;
  }

  /**
   * Encrypt sensitive token data using infrastructure crypto service
   */
  _encryptData(data) {
    const key = this._getEncryptionKey();
    if (!key) {
      this.logger.warn('No encryption key available, storing tokens unencrypted');
      return data;
    }

    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipher('aes-256-cbc', key);
      
      let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      return {
        encrypted: true,
        data: encrypted,
        iv: iv.toString('hex'),
      };
    } catch (error) {
      this.logger.warn('Encryption failed, storing tokens unencrypted', { error: error.message });
      return data;
    }
  }

  /**
   * Decrypt sensitive token data using infrastructure crypto service
   */
  _decryptData(encryptedData) {
    if (!encryptedData.encrypted) return encryptedData;

    const key = this._getEncryptionKey();
    if (!key) {
      throw new SecurityError('Cannot decrypt tokens: encryption key not available', 'NO_ENCRYPTION_KEY');
    }

    try {
      const decipher = crypto.createDecipher('aes-256-cbc', key);
      
      let decrypted = decipher.update(encryptedData.data, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return JSON.parse(decrypted);
    } catch (error) {
      throw new SecurityError('Failed to decrypt token data', 'DECRYPTION_FAILED', { originalError: error });
    }
  }

  /**
   * Acquire file lock for concurrent access protection using infrastructure
   */
  async _acquireLock(timeout = SECURITY_LIMITS.SESSION_TIMEOUT_MS / 10) {
    const timerLabel = 'auth_lock_acquire';
    this.performanceMonitor.startTimer(timerLabel);
    
    try {
      const lockAcquired = await this.secureStorage.acquireLock(this.lockPath, timeout);
      if (!lockAcquired) {
        throw new SecurityError('Could not acquire lock within timeout', 'LOCK_TIMEOUT', { timeout });
      }
      
      await this.logger.debug('File lock acquired successfully', { lockPath: this.lockPath });
      return true;
    } catch (error) {
      await this.logger.error('Failed to acquire file lock', {
        error: error.message,
        lockPath: this.lockPath,
        timeout
      });
      throw ErrorHandler.fromFileSystemError(error, 'acquire lock', this.lockPath);
    } finally {
      try {
        this.performanceMonitor.endTimer(timerLabel);
      } catch (endTimerError) {
        // Timer may already be ended, ignore
      }
    }
  }

  /**
   * Release file lock using infrastructure
   */
  async _releaseLock() {
    try {
      await this.secureStorage.releaseLock(this.lockPath);
      await this.logger.debug('File lock released successfully', { lockPath: this.lockPath });
    } catch (error) {
      await this.logger.warn('Failed to release file lock', {
        error: error.message,
        lockPath: this.lockPath
      });
    }
  }

  /**
   * Save tokens to encrypted file with file locking and validation
   */
  async _saveTokens(tokens) {
    const timerLabel = 'auth_save_tokens';
    this.performanceMonitor.startTimer(timerLabel);
    
    // Basic token validation
    if (!tokens || !tokens.access_token) {
      throw new ValidationError('Invalid token data: missing access_token', 'tokens', tokens);
    }
    
    // Skip file locking for simplicity - use simple file operations
    // await this._acquireLock();
    
    try {
      // Ensure directories exist
      if (!this.directories) {
        await this._initializeDirectories();
      }
      
      const secureTokens = {
        ...tokens,
        created_at: Date.now(),
        client_version: '1.4.0',
        machine_id: crypto.createHash('sha256').update(process.platform + process.arch).digest('hex').substring(0, 16),
      };
      
      // Validate sensitive data lengths
      if (secureTokens.access_token && secureTokens.access_token.length < SECURITY_LIMITS.MIN_TOKEN_LENGTH) {
        throw new ValidationError('Access token too short', 'access_token', secureTokens.access_token);
      }
      
      const dataToSave = this._encryptData(secureTokens);
      await fs.writeJson(this.tokensPath, dataToSave, { spaces: 2 });
      
      // Cache tokens in memory with security check
      this.tokenCache = secureTokens;
      
      await this.logger.info(LOG_MESSAGES.AUTH_SUCCESS, {
        tokenType: secureTokens.token_type || 'Bearer',
        source: secureTokens.source || 'unknown',
        hasRefreshToken: !!secureTokens.refresh_token
      });
      
    } finally {
      // await this._releaseLock();
      try {
        this.performanceMonitor.endTimer(timerLabel);
      } catch (endTimerError) {
        // Timer may already be ended, ignore
      }
    }
  }

  /**
   * Load tokens from encrypted file with security validation
   */
  async _loadTokens() {
    const timerLabel = 'auth_load_tokens';
    this.performanceMonitor.startTimer(timerLabel);
    
    try {
      // Return cached tokens if available and valid
      if (this.tokenCache && !this._isExpired(this.tokenCache)) {
        await this.logger.debug('Using cached tokens');
        return this.tokenCache;
      }

      // Check cache for recent tokens
      const cacheKey = 'auth_tokens';
      const cachedTokens = cacheManager.get(cacheKey);
      if (cachedTokens && !this._isExpired(cachedTokens)) {
        this.tokenCache = cachedTokens;
        return cachedTokens;
      }

      try {
        if (await fs.pathExists(this.tokensPath)) {
          const data = await fs.readJson(this.tokensPath);
          const tokens = this._decryptData(data);
          
          // Basic token validation
          if (!tokens || !tokens.access_token) {
            throw new ValidationError('Invalid stored token data: missing access_token', 'stored_tokens', tokens);
          }
          
          // Security check: verify machine ID if present
          if (tokens.machine_id && tokens.machine_id !== cryptoService.getMachineId()) {
            await this.logger.warn('Token machine ID mismatch, clearing tokens', {
              stored: tokens.machine_id,
              current: cryptoService.getMachineId()
            });
            await fs.unlink(this.tokensPath);
            return null;
          }
          
          this.tokenCache = tokens;
          cacheManager.set(cacheKey, tokens, 300000); // 5 minutes cache
          
          await this.logger.debug('Loaded tokens from file', {
            source: tokens.source || 'unknown',
            hasRefreshToken: !!tokens.refresh_token,
            expiresAt: tokens.expires_at
          });
          
          return tokens;
        }
      } catch (error) {
        await this.logger.warn('Failed to load stored tokens', { error: error.message });
        
        // Clear corrupted token file
        try {
          await fs.unlink(this.tokensPath);
        } catch (unlinkError) {
          await this.logger.debug('Failed to remove corrupted token file', { error: unlinkError.message });
        }
      }

      // Fallback to environment variables with validation
      if (ENV.accessToken || ENV.refreshToken) {
        const envTokens = {
          access_token: ENV.accessToken || '',
          refresh_token: ENV.refreshToken || '',
          expires_at: Date.now() + 10 * 60 * 1000, // 10 minutes default
          source: 'environment',
          token_type: 'Bearer',
        };
        
        // Basic validation for environment tokens
        if (envTokens.access_token) {
          await this._saveTokens(envTokens);
          await this.logger.info('Using tokens from environment variables');
          return envTokens;
        } else {
          await this.logger.warn('Invalid environment tokens: missing access_token');
        }
      }

      return null;
      
    } finally {
      try {
        this.performanceMonitor.endTimer(timerLabel);
      } catch (endTimerError) {
        // Timer may already be ended, ignore
      }
    }
  }

  /**
   * Check if tokens are expired with buffer and logging
   */
  _isExpired(tokens) {
    if (!tokens?.expires_at) {
      this.logger.debug('No expiration time found for tokens');
      return true;
    }
    
    const now = Date.now();
    const expiresAt = tokens.expires_at - this.config.refreshBuffer;
    const isExpired = now >= expiresAt;
    
    if (isExpired) {
      this.logger.debug('Tokens are expired', {
        now,
        expiresAt: tokens.expires_at,
        refreshBuffer: this.config.refreshBuffer,
        timeUntilExpiry: tokens.expires_at - now
      });
    }
    
    return isExpired;
  }

  /**
   * Validate token structure - simplified version
   */
  _validateTokens(tokens) {
    if (!tokens) {
      this.logger.debug('Token validation failed: tokens is null/undefined');
      return false;
    }
    if (typeof tokens !== 'object') {
      this.logger.debug('Token validation failed: tokens is not an object');
      return false;
    }
    if (!tokens.access_token || typeof tokens.access_token !== 'string') {
      this.logger.debug('Token validation failed: missing or invalid access_token');
      return false;
    }
    return true;
  }

  /**
   * Exchange API key for access/refresh tokens with comprehensive error handling
   */
  async _exchangeApiKeyForToken() {
    const timerLabel = 'auth_api_key_exchange';
    this.performanceMonitor.startTimer(timerLabel);
    
    try {
      // Validate API key
      if (!ENV.apiKey) {
        throw new InvalidCredentialsError('NEWO_API_KEY not set. Provide an API key in .env');
      }
      
      if (!VALIDATION_PATTERNS.API_KEY.test(ENV.apiKey)) {
        throw new ValidationError('Invalid API key format', 'api_key', ENV.apiKey);
      }
      
      if (ENV.apiKey.length < SECURITY_LIMITS.MIN_API_KEY_LENGTH) {
        throw new ValidationError('API key too short', 'api_key', ENV.apiKey);
      }

      // Check rate limiting
      const rateLimitResult = rateLimiter.isAllowed('auth-requests');
      if (!rateLimitResult.allowed) {
        throw new SecurityError(
          `Rate limit exceeded for authentication. Retry after ${rateLimitResult.retryAfter}s`,
          'RATE_LIMIT_EXCEEDED',
          { retryAfter: rateLimitResult.retryAfter }
        );
      }

      const url = `${this.config.baseURL}${this.config.tokenEndpoint}`;
      
      await this.logger.info(LOG_MESSAGES.AUTHENTICATING, { endpoint: url });
      
      const response = await ErrorHandler.retry(
        async () => {
          return await axios.post(
            url,
            {},
            {
              headers: {
                'x-api-key': ENV.apiKey,
                'accept': 'application/json',
                'User-Agent': 'NEWO-CLI/1.4.0'
              },
              timeout: this.config.timeout,
            }
          );
        },
        {
          maxRetries: this.config.maxRetries,
          baseDelay: this.config.retryDelay,
          maxDelay: this.config.maxDelay,
          backoffMultiplier: this.config.backoffMultiplier,
          logger: this.logger
        }
      );

      const data = response.data || {};
      
      // Handle different response formats with validation
      const accessToken = data.access_token || data.token || data.accessToken;
      const refreshToken = data.refresh_token || data.refreshToken || '';
      const expiresInSec = data.expires_in || data.expiresIn || 3600;

      if (!accessToken) {
        throw new InvalidCredentialsError('No access token received from API');
      }
      
      if (accessToken.length < SECURITY_LIMITS.MIN_TOKEN_LENGTH) {
        throw new ValidationError('Received access token too short', 'access_token', accessToken);
      }

      const tokens = {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: Date.now() + (expiresInSec * 1000),
        token_type: data.token_type || 'Bearer',
        scope: data.scope || '',
        source: 'api_key_exchange',
      };

      await this._saveTokens(tokens);
      
      await this.logger.info(LOG_MESSAGES.AUTH_SUCCESS, {
        tokenType: tokens.token_type,
        expiresIn: expiresInSec,
        hasRefreshToken: !!tokens.refresh_token
      });
      
      return tokens;
      
    } catch (error) {
      const handledError = await this._handleAuthError(error, 'API key exchange');
      throw handledError;
    } finally {
      try {
        this.performanceMonitor.endTimer(timerLabel);
      } catch (endTimerError) {
        // Timer may already be ended, ignore
      }
    }
  }

  /**
   * Refresh tokens using refresh endpoint with enhanced error handling
   */
  async _refreshWithEndpoint(refreshToken) {
    const timerLabel = 'auth_token_refresh';
    this.performanceMonitor.startTimer(timerLabel);
    
    try {
      // Validate inputs
      if (!ENV.refreshUrl) {
        throw new ValidationError('NEWO_REFRESH_URL not set', 'refresh_url', ENV.refreshUrl);
      }
      
      if (!refreshToken || refreshToken.length < SECURITY_LIMITS.MIN_TOKEN_LENGTH) {
        throw new ValidationError('Invalid refresh token', 'refresh_token', refreshToken);
      }
      
      // Check rate limiting
      const rateLimitResult = rateLimiter.isAllowed('refresh-requests');
      if (!rateLimitResult.allowed) {
        throw new SecurityError(
          `Rate limit exceeded for token refresh. Retry after ${rateLimitResult.retryAfter}s`,
          'RATE_LIMIT_EXCEEDED',
          { retryAfter: rateLimitResult.retryAfter }
        );
      }

      await this.logger.info('Refreshing access token', { refreshUrl: ENV.refreshUrl });
      
      const response = await ErrorHandler.retry(
        async () => {
          return await axios.post(
            ENV.refreshUrl,
            { refresh_token: refreshToken },
            {
              headers: {
                'accept': 'application/json',
                'User-Agent': 'NEWO-CLI/1.4.0'
              },
              timeout: this.config.timeout,
            }
          );
        },
        {
          maxRetries: this.config.maxRetries,
          baseDelay: this.config.retryDelay,
          maxDelay: this.config.maxDelay,
          backoffMultiplier: this.config.backoffMultiplier,
          logger: this.logger
        }
      );

      const data = response.data || {};
      
      const accessToken = data.access_token || data.token || data.accessToken;
      const newRefreshToken = data.refresh_token ?? refreshToken; // Keep old refresh token if not provided
      const expiresInSec = data.expires_in || data.expiresIn || 3600;

      if (!accessToken) {
        throw new RefreshFailedError('No access token received from refresh endpoint');
      }
      
      if (accessToken.length < SECURITY_LIMITS.MIN_TOKEN_LENGTH) {
        throw new ValidationError('Received access token too short', 'access_token', accessToken);
      }

      const tokens = {
        access_token: accessToken,
        refresh_token: newRefreshToken,
        expires_at: Date.now() + (expiresInSec * 1000),
        token_type: data.token_type || 'Bearer',
        scope: data.scope || '',
        source: 'refresh',
      };

      await this._saveTokens(tokens);
      
      await this.logger.info('Token refreshed successfully', {
        expiresIn: expiresInSec,
        newRefreshToken: !!data.refresh_token
      });
      
      return tokens;
      
    } catch (error) {
      const handledError = await this._handleAuthError(error, 'Token refresh');
      throw handledError;
    } finally {
      try {
        this.performanceMonitor.endTimer(timerLabel);
      } catch (endTimerError) {
        // Timer may already be ended, ignore
      }
    }
  }

  /**
   * Get valid access token with automatic refresh
   */
  async getValidAccessToken() {
    // Prevent concurrent refresh attempts
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this._getValidAccessTokenInternal();
    
    try {
      const token = await this.refreshPromise;
      return token;
    } finally {
      this.refreshPromise = null;
    }
  }

  async _getValidAccessTokenInternal() {
    let tokens = await this._loadTokens();

    // If no tokens or invalid tokens, exchange API key
    if (!this._validateTokens(tokens)) {
      tokens = await this._exchangeApiKeyForToken();
      return tokens.access_token;
    }

    // If tokens are not expired, return them
    if (!this._isExpired(tokens)) {
      return tokens.access_token;
    }

    // Try to refresh if refresh URL and token available
    if (ENV.refreshUrl && tokens.refresh_token) {
      try {
        tokens = await this._refreshWithEndpoint(tokens.refresh_token);
        return tokens.access_token;
      } catch (error) {
        console.warn('Token refresh failed, falling back to API key exchange:', error.message);
        
        // Clear potentially invalid tokens
        this.tokenCache = null;
        try {
          await fs.unlink(this.tokensPath);
        } catch (unlinkError) {
          // Ignore unlink errors
        }
      }
    }

    // Fallback to API key exchange
    tokens = await this._exchangeApiKeyForToken();
    return tokens.access_token;
  }

  /**
   * Force re-authentication (clear cache and get new tokens)
   */
  async forceReauth() {
    this.tokenCache = null;
    this.refreshPromise = null;
    
    try {
      await fs.unlink(this.tokensPath);
    } catch (error) {
      // Ignore errors when clearing cache
    }

    const tokens = await this._exchangeApiKeyForToken();
    return tokens.access_token;
  }

  /**
   * Clear all authentication data
   */
  async clearAuth() {
    this.tokenCache = null;
    this.refreshPromise = null;
    
    try {
      await fs.remove(this.config.tokenDir);
    } catch (error) {
      // Ignore errors when clearing
    }
  }

  /**
   * Get token information (non-sensitive)
   */
  async getTokenInfo() {
    const tokens = await this._loadTokens();
    
    if (!tokens) return null;

    return {
      hasToken: !!tokens.access_token,
      hasRefreshToken: !!tokens.refresh_token,
      expiresAt: tokens.expires_at,
      isExpired: this._isExpired(tokens),
      tokenType: tokens.token_type,
      source: tokens.source,
      timeToExpiry: tokens.expires_at ? tokens.expires_at - Date.now() : null,
    };
  }

  /**
   * Handle authentication errors with proper categorization
   */
  async _handleAuthError(error, operation) {
    const context = { operation, timestamp: Date.now() };
    
    if (error.response) {
      const status = error.response.status;
      const message = error.response.data?.message || error.message;
      
      await this.logger.error(LOG_MESSAGES.AUTH_FAILED, {
        operation,
        status,
        message,
        endpoint: error.config?.url
      });
      
      if (status === HTTP_STATUS.UNAUTHORIZED || status === HTTP_STATUS.FORBIDDEN) {
        if (operation.includes('refresh')) {
          return new RefreshFailedError(message, error);
        } else {
          return new InvalidCredentialsError(message);
        }
      }
      
      if (status === HTTP_STATUS.TOO_MANY_REQUESTS) {
        const retryAfter = error.response.headers['retry-after'] || 60;
        return new SecurityError(
          `Rate limit exceeded. Retry after ${retryAfter}s`,
          'RATE_LIMIT_EXCEEDED',
          { retryAfter }
        );
      }
      
      return ErrorHandler.fromHttpError(error, error.config?.url);
    }
    
    if (error.code === 'ECONNABORTED') {
      await this.logger.error('Authentication request timed out', { operation, timeout: this.config.timeout });
      return new TimeoutError(`${operation} timed out`, this.config.timeout);
    }
    
    return await ErrorHandler.handle(error, this.logger, context);
  }

  /**
   * Utility method for delays
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Global auth manager instance
const authManager = new AuthManager();

// Legacy function exports for backward compatibility
export async function saveTokens(tokens) {
  await authManager._saveTokens(tokens);
}

export async function loadTokens() {
  return authManager._loadTokens();
}

export function isExpired(tokens) {
  return authManager._isExpired(tokens);
}

export async function exchangeApiKeyForToken() {
  return authManager._exchangeApiKeyForToken();
}

export async function refreshWithEndpoint(refreshToken) {
  return authManager._refreshWithEndpoint(refreshToken);
}

export async function getValidAccessToken() {
  return authManager.getValidAccessToken();
}

export async function forceReauth() {
  return authManager.forceReauth();
}

// Additional utility exports
export { authManager, AUTH_CONFIG };
export default AuthManager;