/**
 * Comprehensive tests for error handling system
 */
import { expect } from 'chai';
import {
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
  TimeoutError,
  ErrorHandler
} from '../src/errors.js';
import { TestEnvironment, MockLogger } from './test-utils.js';

describe('Error Handling System', () => {
  let testEnv;
  let mockLogger;

  beforeEach(() => {
    testEnv = new TestEnvironment();
    mockLogger = new MockLogger();
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  describe('Base NewoError Class', () => {
    it('should create error with default values', () => {
      const error = new NewoError('Test error message');
      
      expect(error.name).to.equal('NewoError');
      expect(error.message).to.equal('Test error message');
      expect(error.code).to.equal('NEWO_ERROR');
      expect(error.statusCode).to.be.null;
      expect(error.details).to.deep.equal({});
      expect(error.timestamp).to.be.a('string');
      expect(error.stack).to.be.a('string');
    });

    it('should create error with custom parameters', () => {
      const details = { context: 'test', userId: '123' };
      const error = new NewoError('Custom error', 'CUSTOM_CODE', 500, details);
      
      expect(error.message).to.equal('Custom error');
      expect(error.code).to.equal('CUSTOM_CODE');
      expect(error.statusCode).to.equal(500);
      expect(error.details).to.deep.equal(details);
    });

    it('should serialize to JSON correctly', () => {
      const error = new NewoError('Test error', 'TEST_CODE', 400, { key: 'value' });
      const json = error.toJSON();
      
      expect(json).to.have.property('name', 'NewoError');
      expect(json).to.have.property('message', 'Test error');
      expect(json).to.have.property('code', 'TEST_CODE');
      expect(json).to.have.property('statusCode', 400);
      expect(json).to.have.property('details');
      expect(json.details).to.deep.equal({ key: 'value' });
      expect(json).to.have.property('timestamp');
      expect(json).to.have.property('stack');
    });

    it('should provide user-friendly message', () => {
      const error = new NewoError('Technical error message');
      expect(error.getUserMessage()).to.equal('Technical error message');
    });

    it('should indicate if error is not retryable by default', () => {
      const error = new NewoError('Test error');
      expect(error.isRetryable()).to.be.false;
    });
  });

  describe('Authentication Error', () => {
    it('should create authentication error correctly', () => {
      const error = new AuthenticationError('Invalid credentials', { token: 'expired' });
      
      expect(error.name).to.equal('AuthenticationError');
      expect(error.code).to.equal('AUTH_ERROR');
      expect(error.statusCode).to.equal(401);
      expect(error.details.token).to.equal('expired');
    });

    it('should provide user-friendly authentication message', () => {
      const error = new AuthenticationError('Token expired');
      expect(error.getUserMessage()).to.equal('Authentication failed. Please check your API key or tokens.');
    });

    it('should be retryable by default', () => {
      const error = new AuthenticationError('Auth failed');
      expect(error.isRetryable()).to.be.true;
    });

    it('should respect retryable setting in details', () => {
      const error = new AuthenticationError('Auth failed', { retryable: false });
      expect(error.isRetryable()).to.be.false;
    });
  });

  describe('Authorization Error', () => {
    it('should create authorization error correctly', () => {
      const error = new AuthorizationError('Access denied', { resource: '/admin' });
      
      expect(error.name).to.equal('AuthorizationError');
      expect(error.code).to.equal('AUTHZ_ERROR');
      expect(error.statusCode).to.equal(403);
      expect(error.details.resource).to.equal('/admin');
    });

    it('should provide user-friendly authorization message', () => {
      const error = new AuthorizationError('Forbidden');
      expect(error.getUserMessage()).to.equal('Access denied. You may not have permission to perform this operation.');
    });

    it('should not be retryable', () => {
      const error = new AuthorizationError('Forbidden');
      expect(error.isRetryable()).to.be.false;
    });
  });

  describe('API Error', () => {
    it('should create API error with status code', () => {
      const error = new ApiError('Bad request', 400, '/api/test', { field: 'invalid' });
      
      expect(error.name).to.equal('ApiError');
      expect(error.code).to.equal('API_ERROR');
      expect(error.statusCode).to.equal(400);
      expect(error.details.endpoint).to.equal('/api/test');
      expect(error.details.field).to.equal('invalid');
    });

    it('should provide appropriate user messages for different status codes', () => {
      const serverError = new ApiError('Internal error', 500);
      expect(serverError.getUserMessage()).to.equal('NEWO service is temporarily unavailable. Please try again later.');

      const rateLimitError = new ApiError('Too many requests', 429);
      expect(rateLimitError.getUserMessage()).to.equal('Rate limit exceeded. Please wait before making more requests.');

      const notFoundError = new ApiError('Not found', 404);
      expect(notFoundError.getUserMessage()).to.equal('Resource not found. Please check if the project/agent/flow exists.');

      const clientError = new ApiError('Bad request', 400);
      expect(clientError.getUserMessage()).to.equal('Bad request');
    });

    it('should be retryable for server errors and rate limits', () => {
      const serverError = new ApiError('Internal error', 500);
      expect(serverError.isRetryable()).to.be.true;

      const rateLimitError = new ApiError('Too many requests', 429);
      expect(rateLimitError.isRetryable()).to.be.true;

      const clientError = new ApiError('Bad request', 400);
      expect(clientError.isRetryable()).to.be.false;
    });
  });

  describe('Network Error', () => {
    it('should create network error correctly', () => {
      const error = new NetworkError('Connection failed', { host: 'api.example.com' });
      
      expect(error.name).to.equal('NetworkError');
      expect(error.code).to.equal('NETWORK_ERROR');
      expect(error.statusCode).to.be.null;
      expect(error.details.host).to.equal('api.example.com');
    });

    it('should provide user-friendly network message', () => {
      const error = new NetworkError('ECONNREFUSED');
      expect(error.getUserMessage()).to.equal('Network connection failed. Please check your internet connection and try again.');
    });

    it('should be retryable', () => {
      const error = new NetworkError('Connection timeout');
      expect(error.isRetryable()).to.be.true;
    });
  });

  describe('File System Error', () => {
    it('should create file system error with operation context', () => {
      const error = new FileSystemError('Permission denied', 'write', '/tmp/test.txt', { errno: -13 });
      
      expect(error.name).to.equal('FileSystemError');
      expect(error.code).to.equal('FS_ERROR');
      expect(error.details.operation).to.equal('write');
      expect(error.details.filePath).to.equal('/tmp/test.txt');
      expect(error.details.errno).to.equal(-13);
    });

    it('should provide user-friendly file system message', () => {
      const error = new FileSystemError('ENOENT', 'read', '/missing/file.txt');
      expect(error.getUserMessage()).to.equal('Failed to read. Please check file permissions and disk space.');
    });
  });

  describe('Validation Error', () => {
    it('should create validation error with field context', () => {
      const error = new ValidationError('Invalid email format', 'email', 'not-an-email', { pattern: 'email' });
      
      expect(error.name).to.equal('ValidationError');
      expect(error.code).to.equal('VALIDATION_ERROR');
      expect(error.statusCode).to.equal(400);
      expect(error.details.field).to.equal('email');
      expect(error.details.value).to.equal('not-an-email');
      expect(error.details.pattern).to.equal('email');
    });

    it('should provide contextual validation messages', () => {
      const errorWithField = new ValidationError('Required field', 'username');
      expect(errorWithField.getUserMessage()).to.equal('Invalid username: Required field');

      const errorWithoutField = new ValidationError('Invalid format');
      expect(errorWithoutField.getUserMessage()).to.equal('Validation error: Invalid format');
    });
  });

  describe('Configuration Error', () => {
    it('should create configuration error with config key', () => {
      const error = new ConfigurationError('Invalid URL format', 'NEWO_BASE_URL', { value: 'not-a-url' });
      
      expect(error.name).to.equal('ConfigurationError');
      expect(error.code).to.equal('CONFIG_ERROR');
      expect(error.details.configKey).to.equal('NEWO_BASE_URL');
      expect(error.details.value).to.equal('not-a-url');
    });

    it('should provide user-friendly configuration message', () => {
      const error = new ConfigurationError('Missing API key');
      expect(error.getUserMessage()).to.equal('Configuration error: Missing API key');
    });
  });

  describe('Rate Limit Error', () => {
    it('should create rate limit error with retry after', () => {
      const error = new RateLimitError('Rate limited', 60, { limit: 100 });
      
      expect(error.name).to.equal('RateLimitError');
      expect(error.code).to.equal('RATE_LIMIT_ERROR');
      expect(error.statusCode).to.equal(429);
      expect(error.details.retryAfter).to.equal(60);
      expect(error.details.limit).to.equal(100);
    });

    it('should provide user-friendly rate limit messages', () => {
      const errorWithRetryAfter = new RateLimitError('Rate limited', 30);
      expect(errorWithRetryAfter.getUserMessage()).to.equal('Rate limit exceeded. Please wait 30 seconds before trying again.');

      const errorWithoutRetryAfter = new RateLimitError('Rate limited');
      expect(errorWithoutRetryAfter.getUserMessage()).to.equal('Rate limit exceeded. Please wait before making more requests.');
    });

    it('should be retryable', () => {
      const error = new RateLimitError('Rate limited');
      expect(error.isRetryable()).to.be.true;
    });
  });

  describe('Timeout Error', () => {
    it('should create timeout error with timeout value', () => {
      const error = new TimeoutError('Operation timed out', 5000, { operation: 'api_call' });
      
      expect(error.name).to.equal('TimeoutError');
      expect(error.code).to.equal('TIMEOUT_ERROR');
      expect(error.details.timeout).to.equal(5000);
      expect(error.details.operation).to.equal('api_call');
    });

    it('should provide user-friendly timeout message', () => {
      const error = new TimeoutError('Request timeout', 30000);
      expect(error.getUserMessage()).to.equal('Operation timed out after 30000ms. Please try again.');
    });

    it('should be retryable', () => {
      const error = new TimeoutError('Timeout');
      expect(error.isRetryable()).to.be.true;
    });
  });

  describe('Error Handler Utilities', () => {
    describe('fromHttpError', () => {
      it('should convert network errors correctly', () => {
        const httpError = {
          code: 'ENOTFOUND',
          message: 'getaddrinfo ENOTFOUND api.example.com'
        };

        const converted = ErrorHandler.fromHttpError(httpError, '/api/test');
        
        expect(converted).to.be.instanceOf(NetworkError);
        expect(converted.message).to.include('Network connection failed');
        expect(converted.details.originalError).to.equal('ENOTFOUND');
      });

      it('should convert timeout errors correctly', () => {
        const httpError = {
          code: 'ECONNABORTED',
          message: 'timeout of 5000ms exceeded',
          config: { timeout: 5000 }
        };

        const converted = ErrorHandler.fromHttpError(httpError);
        
        expect(converted).to.be.instanceOf(TimeoutError);
        expect(converted.details.timeout).to.equal(5000);
      });

      it('should convert HTTP status errors correctly', () => {
        const httpError = {
          response: {
            status: 401,
            data: { message: 'Unauthorized' },
            headers: {}
          },
          message: 'Request failed with status code 401'
        };

        const converted = ErrorHandler.fromHttpError(httpError, '/api/test');
        
        expect(converted).to.be.instanceOf(AuthenticationError);
        expect(converted.statusCode).to.equal(401);
      });

      it('should convert rate limit errors with retry-after header', () => {
        const httpError = {
          response: {
            status: 429,
            data: { message: 'Too Many Requests' },
            headers: { 'retry-after': '60' }
          },
          message: 'Request failed with status code 429'
        };

        const converted = ErrorHandler.fromHttpError(httpError);
        
        expect(converted).to.be.instanceOf(RateLimitError);
        expect(converted.details.retryAfter).to.equal('60');
      });

      it('should fallback to generic API error for unknown errors', () => {
        const httpError = {
          response: {
            status: 418,
            data: { message: 'I\'m a teapot' }
          },
          message: 'Request failed with status code 418'
        };

        const converted = ErrorHandler.fromHttpError(httpError, '/api/test');
        
        expect(converted).to.be.instanceOf(ApiError);
        expect(converted.statusCode).to.equal(418);
        expect(converted.details.endpoint).to.equal('/api/test');
      });
    });

    describe('fromFileSystemError', () => {
      it('should convert file system errors correctly', () => {
        const fsError = {
          code: 'ENOENT',
          errno: -2,
          syscall: 'open',
          message: 'ENOENT: no such file or directory, open \'/missing/file.txt\''
        };

        const converted = ErrorHandler.fromFileSystemError(fsError, 'read', '/missing/file.txt');
        
        expect(converted).to.be.instanceOf(FileSystemError);
        expect(converted.details.operation).to.equal('read');
        expect(converted.details.filePath).to.equal('/missing/file.txt');
        expect(converted.details.originalError).to.equal('ENOENT');
      });
    });

    describe('handle', () => {
      it('should handle known errors', async () => {
        const originalError = new ValidationError('Test validation error');
        const context = { operation: 'test' };

        const handledError = await ErrorHandler.handle(originalError, mockLogger, context);
        
        expect(handledError).to.equal(originalError);
        
        const errorLogs = mockLogger.getLogs('ERROR');
        expect(errorLogs).to.have.length(1);
        expect(errorLogs[0].message).to.equal('Error occurred');
        expect(errorLogs[0].meta.context).to.deep.equal(context);
      });

      it('should convert unknown errors to NewoError', async () => {
        const originalError = new Error('Unknown error');
        const context = { operation: 'test' };

        const handledError = await ErrorHandler.handle(originalError, mockLogger, context);
        
        expect(handledError).to.be.instanceOf(NewoError);
        expect(handledError.code).to.equal('UNKNOWN_ERROR');
        expect(handledError.details.originalError).to.equal('Error');
        expect(handledError.details.context).to.deep.equal(context);
      });
    });

    describe('retry', () => {
      it('should retry retryable operations', async () => {
        let attempts = 0;
        const operation = async () => {
          attempts++;
          if (attempts < 3) {
            throw new NetworkError('Connection failed');
          }
          return 'success';
        };

        const result = await ErrorHandler.retry(operation, {
          maxRetries: 3,
          baseDelay: 1, // Short delay for testing
          logger: mockLogger
        });

        expect(result).to.equal('success');
        expect(attempts).to.equal(3);
        
        const warnLogs = mockLogger.getLogs('WARN');
        expect(warnLogs).to.have.length(2); // Two retry attempts
      });

      it('should not retry non-retryable operations', async () => {
        let attempts = 0;
        const operation = async () => {
          attempts++;
          throw new ValidationError('Invalid input');
        };

        try {
          await ErrorHandler.retry(operation, { maxRetries: 3, baseDelay: 1 });
          expect.fail('Should have thrown error');
        } catch (error) {
          expect(error).to.be.instanceOf(ValidationError);
          expect(attempts).to.equal(1);
        }
      });

      it('should respect maximum retry limit', async () => {
        let attempts = 0;
        const operation = async () => {
          attempts++;
          throw new NetworkError('Always fails');
        };

        try {
          await ErrorHandler.retry(operation, { maxRetries: 2, baseDelay: 1 });
          expect.fail('Should have thrown error');
        } catch (error) {
          expect(error).to.be.instanceOf(NetworkError);
          expect(attempts).to.equal(3); // Initial attempt + 2 retries
        }
      });

      it('should apply exponential backoff', async () => {
        const delays = [];
        const originalSetTimeout = setTimeout;
        
        testEnv.createStub(global, 'setTimeout', (callback, delay) => {
          delays.push(delay);
          return originalSetTimeout(callback, 1); // Speed up test
        });

        let attempts = 0;
        const operation = async () => {
          attempts++;
          if (attempts < 3) {
            throw new TimeoutError('Timeout');
          }
          return 'success';
        };

        await ErrorHandler.retry(operation, {
          maxRetries: 2,
          baseDelay: 100,
          backoffMultiplier: 2
        });

        expect(delays).to.have.length(2);
        expect(delays[0]).to.equal(100);
        expect(delays[1]).to.equal(200);
      });
    });

    describe('wrapAsync', () => {
      it('should wrap async functions with error handling', async () => {
        const originalFunction = async (value) => {
          if (value === 'error') {
            throw new Error('Test error');
          }
          return `result: ${value}`;
        };

        const wrappedFunction = ErrorHandler.wrapAsync(originalFunction, mockLogger, { context: 'test' });

        const successResult = await wrappedFunction('success');
        expect(successResult).to.equal('result: success');

        try {
          await wrappedFunction('error');
          expect.fail('Should have thrown error');
        } catch (error) {
          expect(error).to.be.instanceOf(NewoError);
        }

        const errorLogs = mockLogger.getLogs('ERROR');
        expect(errorLogs).to.have.length(1);
      });
    });
  });
});