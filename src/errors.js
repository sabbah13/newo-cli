/**
 * Base error class for NEWO CLI
 */
class NewoError extends Error {
  constructor(message, code = 'NEWO_ERROR', statusCode = null, details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.timestamp = new Date().toISOString();
    
    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert error to JSON for logging
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      details: this.details,
      timestamp: this.timestamp,
      stack: this.stack
    };
  }

  /**
   * Get user-friendly error message
   */
  getUserMessage() {
    return this.message;
  }

  /**
   * Check if error is retryable
   */
  isRetryable() {
    return false;
  }
}

/**
 * Authentication related errors
 */
class AuthenticationError extends NewoError {
  constructor(message, details = {}) {
    super(message, 'AUTH_ERROR', 401, details);
  }

  getUserMessage() {
    return 'Authentication failed. Please check your API key or tokens.';
  }

  isRetryable() {
    return this.details.retryable !== false;
  }
}

/**
 * Authorization errors (forbidden)
 */
class AuthorizationError extends NewoError {
  constructor(message, details = {}) {
    super(message, 'AUTHZ_ERROR', 403, details);
  }

  getUserMessage() {
    return 'Access denied. You may not have permission to perform this operation.';
  }
}

/**
 * API related errors
 */
class ApiError extends NewoError {
  constructor(message, statusCode, endpoint = null, details = {}) {
    super(message, 'API_ERROR', statusCode, { ...details, endpoint });
  }

  getUserMessage() {
    if (this.statusCode >= 500) {
      return 'NEWO service is temporarily unavailable. Please try again later.';
    }
    if (this.statusCode === 429) {
      return 'Rate limit exceeded. Please wait before making more requests.';
    }
    if (this.statusCode === 404) {
      return 'Resource not found. Please check if the project/agent/flow exists.';
    }
    return this.message;
  }

  isRetryable() {
    return this.statusCode >= 500 || this.statusCode === 429;
  }
}

/**
 * Network connectivity errors
 */
class NetworkError extends NewoError {
  constructor(message, details = {}) {
    super(message, 'NETWORK_ERROR', null, details);
  }

  getUserMessage() {
    return 'Network connection failed. Please check your internet connection and try again.';
  }

  isRetryable() {
    return true;
  }
}

/**
 * File system related errors
 */
class FileSystemError extends NewoError {
  constructor(message, operation, filePath, details = {}) {
    super(message, 'FS_ERROR', null, { ...details, operation, filePath });
  }

  getUserMessage() {
    const operation = this.details.operation || 'file operation';
    return `Failed to ${operation}. Please check file permissions and disk space.`;
  }
}

/**
 * Validation errors
 */
class ValidationError extends NewoError {
  constructor(message, field = null, value = null, details = {}) {
    super(message, 'VALIDATION_ERROR', 400, { ...details, field, value });
  }

  getUserMessage() {
    if (this.details.field) {
      return `Invalid ${this.details.field}: ${this.message}`;
    }
    return `Validation error: ${this.message}`;
  }
}

/**
 * Configuration errors
 */
class ConfigurationError extends NewoError {
  constructor(message, configKey = null, details = {}) {
    super(message, 'CONFIG_ERROR', null, { ...details, configKey });
  }

  getUserMessage() {
    return `Configuration error: ${this.message}`;
  }
}

/**
 * Sync operation errors
 */
class SyncError extends NewoError {
  constructor(message, operation, details = {}) {
    super(message, 'SYNC_ERROR', null, { ...details, operation });
  }

  getUserMessage() {
    const op = this.details.operation || 'sync operation';
    return `Sync failed during ${op}: ${this.message}`;
  }

  isRetryable() {
    return this.details.retryable !== false;
  }
}

/**
 * AKB import errors
 */
class AkbImportError extends NewoError {
  constructor(message, articleId = null, details = {}) {
    super(message, 'AKB_IMPORT_ERROR', null, { ...details, articleId });
  }

  getUserMessage() {
    if (this.details.articleId) {
      return `Failed to import article ${this.details.articleId}: ${this.message}`;
    }
    return `AKB import failed: ${this.message}`;
  }
}

/**
 * Rate limiting errors
 */
class RateLimitError extends NewoError {
  constructor(message, retryAfter = null, details = {}) {
    super(message, 'RATE_LIMIT_ERROR', 429, { ...details, retryAfter });
  }

  getUserMessage() {
    const retryAfter = this.details.retryAfter;
    if (retryAfter) {
      return `Rate limit exceeded. Please wait ${retryAfter} seconds before trying again.`;
    }
    return 'Rate limit exceeded. Please wait before making more requests.';
  }

  isRetryable() {
    return true;
  }
}

/**
 * Security related errors
 */
class SecurityError extends NewoError {
  constructor(message, securityType = null, details = {}) {
    super(message, 'SECURITY_ERROR', 403, { ...details, securityType });
  }

  getUserMessage() {
    return `Security violation: ${this.message}`;
  }
}

/**
 * Timeout errors
 */
class TimeoutError extends NewoError {
  constructor(message, timeout, details = {}) {
    super(message, 'TIMEOUT_ERROR', null, { ...details, timeout });
  }

  getUserMessage() {
    return `Operation timed out after ${this.details.timeout}ms. Please try again.`;
  }

  isRetryable() {
    return true;
  }
}

/**
 * Error handler utility functions
 */
class ErrorHandler {
  /**
   * Create appropriate error from HTTP response
   */
  static fromHttpError(error, endpoint = null) {
    const status = error.response?.status;
    const message = error.response?.data?.message || error.message;
    const details = {
      originalError: error.code,
      responseData: error.response?.data
    };

    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return new NetworkError(`Network connection failed: ${message}`, details);
    }

    if (error.code === 'ECONNABORTED') {
      const timeout = error.config?.timeout || 'unknown';
      return new TimeoutError(`Request timed out: ${message}`, timeout, details);
    }

    if (status === 401) {
      return new AuthenticationError(message, details);
    }

    if (status === 403) {
      return new AuthorizationError(message, details);
    }

    if (status === 429) {
      const retryAfter = error.response?.headers['retry-after'];
      return new RateLimitError(message, retryAfter, details);
    }

    return new ApiError(message, status, endpoint, details);
  }

  /**
   * Create error from file system operation
   */
  static fromFileSystemError(error, operation, filePath) {
    const details = {
      originalError: error.code,
      errno: error.errno,
      syscall: error.syscall
    };

    return new FileSystemError(error.message, operation, filePath, details);
  }

  /**
   * Handle error with appropriate logging and user feedback
   */
  static async handle(error, logger, context = {}) {
    // Convert unknown errors to NewoError
    if (!(error instanceof NewoError)) {
      error = new NewoError(error.message || 'Unknown error occurred', 'UNKNOWN_ERROR', null, {
        originalError: error.name,
        context
      });
    }

    // Log error details
    await logger.error('Error occurred', {
      ...error.toJSON(),
      context
    });

    return error;
  }

  /**
   * Retry logic for retryable errors
   */
  static async retry(operation, options = {}) {
    const {
      maxRetries = 3,
      baseDelay = 1000,
      maxDelay = 10000,
      backoffMultiplier = 2,
      logger = null
    } = options;

    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        // Don't retry if not retryable or max attempts reached
        if (!error.isRetryable || !error.isRetryable() || attempt > maxRetries) {
          break;
        }

        // Calculate delay with exponential backoff
        const delay = Math.min(
          baseDelay * Math.pow(backoffMultiplier, attempt - 1),
          maxDelay
        );

        if (logger) {
          await logger.warn(`Attempt ${attempt} failed, retrying in ${delay}ms`, {
            error: error.message,
            attempt,
            maxRetries
          });
        }

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  /**
   * Wrap async function with error handling
   */
  static wrapAsync(fn, logger = null, context = {}) {
    return async (...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        const handledError = await ErrorHandler.handle(error, logger, context);
        throw handledError;
      }
    };
  }
}

export {
  NewoError,
  AuthenticationError,
  AuthorizationError,
  ApiError,
  NetworkError,
  FileSystemError,
  ValidationError,
  ConfigurationError,
  SyncError,
  AkbImportError,
  RateLimitError,
  SecurityError,
  TimeoutError,
  ErrorHandler
};