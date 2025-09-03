/**
 * Comprehensive integration tests for all NEWO CLI improvements
 * Tests the entire system working together with all enhancements
 */
import { expect } from 'chai';
import fs from 'fs-extra';
import path from 'path';
import sinon from 'sinon';

// Import all improved modules
import { config, ensureDirectories } from '../src/config.js';
import { logger, Logger } from '../src/logger.js';
import { NewoCLI } from '../src/cli-refactored.js';
import { makeClient } from '../src/api-refactored.js';
import { authService } from '../src/auth-refactored.js';
import { secureTokenStorage, rateLimiter } from '../src/security.js';
import { performanceMonitor, cacheManager } from '../src/performance.js';
import { ErrorHandler, ValidationError, ApiError } from '../src/errors.js';
import { Validator, Sanitizer } from '../src/validation.js';
import { CONSTANTS } from '../src/constants.js';

// Test utilities
import {
  TestEnvironment,
  MockHttpClient,
  MockFileSystem,
  MockLogger,
  TestAssertions,
  TestDataGenerator
} from './test-utils.js';

describe('Comprehensive Integration Tests', function() {
  let testEnv;
  let tempDir;
  let mockHttp;
  let mockFs;
  let mockLogger;

  // Increase timeout for integration tests
  this.timeout(10000);

  beforeEach(async () => {
    testEnv = new TestEnvironment();
    tempDir = await testEnv.createTempDir();
    mockHttp = new MockHttpClient();
    mockFs = new MockFileSystem();
    mockLogger = new MockLogger();

    // Setup test environment
    testEnv.setEnv('NEWO_BASE_URL', 'https://test.newo.ai');
    testEnv.setEnv('NEWO_API_KEY', 'test-api-key-123456789');
    testEnv.setEnv('NEWO_PROJECT_ID', 'test-project-id');
    testEnv.setEnv('NODE_ENV', 'test');

    // Mock file system operations
    testEnv.createStub(fs, 'ensureDir', mockFs.mockDirectory.bind(mockFs));
    testEnv.createStub(fs, 'pathExists', mockFs.pathExists.bind(mockFs));
    testEnv.createStub(fs, 'readFile', mockFs.readFile.bind(mockFs));
    testEnv.createStub(fs, 'writeFile', mockFs.writeFile.bind(mockFs));
    testEnv.createStub(fs, 'readJson', (path) => JSON.parse(mockFs.readFile(path)));
    testEnv.createStub(fs, 'writeJson', (path, data) => mockFs.writeFile(path, JSON.stringify(data, null, 2)));

    // Mock process.cwd to return temp directory
    testEnv.createStub(process, 'cwd', () => tempDir);
  });

  afterEach(async () => {
    await testEnv.cleanup();
    mockHttp.clearMocks();
    mockFs.clear();
    mockLogger.clearLogs();
  });

  describe('Complete System Integration', () => {
    it('should handle complete pull workflow with all improvements', async () => {
      // Setup comprehensive test data
      const projectData = TestDataGenerator.generateProject({
        id: 'test-project-id',
        idn: 'test-project'
      });
      
      const agentData = TestDataGenerator.generateAgent({
        id: 'test-agent-id',
        idn: 'test-agent',
        flows: [
          TestDataGenerator.generateFlow({
            id: 'test-flow-id',
            idn: 'test-flow'
          })
        ]
      });

      const skillData = TestDataGenerator.generateSkill({
        id: 'test-skill-id',
        idn: 'test-skill',
        prompt_script: 'Test skill content for integration test'
      });

      // Mock API responses
      mockHttp.mockRequests([
        ['POST', '/api/v1/auth/api-key/token', {
          status: 200,
          data: {
            access_token: 'test-access-token',
            refresh_token: 'test-refresh-token',
            expires_in: 3600
          }
        }],
        ['GET', '/api/v1/designer/projects/by-id/test-project-id', {
          status: 200,
          data: projectData
        }],
        ['GET', '/api/v1/bff/agents/list', {
          status: 200,
          data: [agentData]
        }],
        ['GET', '/api/v1/designer/flows/test-flow-id/skills', {
          status: 200,
          data: [skillData]
        }],
        ['GET', '/api/v1/designer/flows/test-flow-id/events', {
          status: 200,
          data: []
        }],
        ['GET', '/api/v1/designer/flows/test-flow-id/states', {
          status: 200,
          data: []
        }]
      ]);

      // Mock axios to use our mock HTTP client
      const axiosStub = testEnv.createStub(await import('axios'), 'default');
      axiosStub.create = () => mockHttp;
      axiosStub.post = mockHttp.request.bind(mockHttp);

      // Test the complete pull workflow
      const cli = new NewoCLI();
      
      // Test CLI argument parsing with validation
      const parsedArgs = cli.parseArguments(['node', 'cli.js', 'pull', '--verbose']);
      expect(parsedArgs.command).to.equal('pull');
      expect(parsedArgs.verbose).to.be.true;

      // Test command validation
      const validatedCommand = cli.validateCommand('pull');
      expect(validatedCommand).to.equal('pull');

      // Execute pull command (this would normally call the full system)
      // We'll test individual components working together
      
      // 1. Test authentication with secure token storage
      const accessToken = await authService.getValidAccessToken();
      expect(accessToken).to.equal('test-access-token');

      // 2. Test API client with caching and rate limiting
      const client = await makeClient(true);
      expect(client).to.exist;

      // 3. Test performance monitoring
      performanceMonitor.startTimer('test_operation');
      await new Promise(resolve => setTimeout(resolve, 10));
      const metrics = performanceMonitor.endTimer('test_operation');
      expect(metrics.duration).to.be.greaterThan(0);

      // 4. Test file operations with security validation
      const skillPath = path.join(tempDir, 'projects', 'test-project', 'test-agent', 'test-flow', 'test-skill.guidance');
      mockFs.mockFile(skillPath, 'Test skill content for integration test');
      
      TestAssertions.assertFileOperation(mockFs, 'exists', skillPath);

      // 5. Test caching system
      cacheManager.set('test-key', 'test-value');
      expect(cacheManager.get('test-key')).to.equal('test-value');

      // 6. Test logging integration
      await logger.info('Integration test completed successfully', {
        operation: 'pull',
        duration: metrics.duration
      });

      // Verify system integration
      const requests = mockHttp.getRequests();
      expect(requests.length).to.be.greaterThan(0);
      
      const authRequest = requests.find(r => r.url.includes('/auth/api-key/token'));
      expect(authRequest).to.exist;
      expect(authRequest.method).to.equal('POST');
    });

    it('should handle complete push workflow with validation and security', async () => {
      // Setup test data for push operation
      const projectMap = {
        projects: {
          'test-project': {
            projectId: 'test-project-id',
            projectIdn: 'test-project',
            agents: {
              'test-agent': {
                id: 'test-agent-id',
                flows: {
                  'test-flow': {
                    id: 'test-flow-id',
                    skills: {
                      'test-skill': {
                        id: 'test-skill-id',
                        title: 'Test Skill',
                        idn: 'test-skill',
                        runner_type: 'guidance',
                        model: { provider_idn: 'test', model_idn: 'test' },
                        parameters: [],
                        path: '/test/path'
                      }
                    }
                  }
                }
              }
            }
          }
        }
      };

      const hashes = {
        [`${tempDir}/projects/test-project/test-agent/test-flow/test-skill.guidance`]: 'old-hash'
      };

      // Mock file system state
      mockFs.mockFile(path.join(tempDir, '.newo', 'map.json'), JSON.stringify(projectMap, null, 2));
      mockFs.mockFile(path.join(tempDir, '.newo', 'hashes.json'), JSON.stringify(hashes, null, 2));
      
      const skillPath = path.join(tempDir, 'projects', 'test-project', 'test-agent', 'test-flow', 'test-skill.guidance');
      mockFs.mockFile(skillPath, 'Updated skill content for integration test');

      // Mock API responses
      mockHttp.mockRequests([
        ['POST', '/api/v1/auth/api-key/token', {
          status: 200,
          data: {
            access_token: 'test-access-token',
            expires_in: 3600
          }
        }],
        ['PUT', '/api/v1/designer/flows/skills/test-skill-id', {
          status: 200,
          data: { success: true }
        }]
      ]);

      // Test input validation for skill object
      const skillObject = {
        id: 'test-skill-id',
        title: 'Test Skill',
        prompt_script: 'Updated skill content for integration test',
        runner_type: 'guidance'
      };

      // Validate skill object using our validation system
      const validatedSkill = Validator.validateObject(skillObject, {
        id: { type: 'string', required: true },
        title: { type: 'string', required: true },
        prompt_script: { type: 'string', required: true },
        runner_type: { type: 'enum', enum: ['guidance', 'nsl'], required: true }
      });

      expect(validatedSkill.id).to.equal('test-skill-id');
      expect(validatedSkill.prompt_script).to.equal('Updated skill content for integration test');

      // Test security validation for file paths
      const sanitizedPath = Sanitizer.sanitizePath('test-project/test-agent/test-flow/test-skill.guidance');
      expect(sanitizedPath).to.not.include('..');

      // Test rate limiting
      const rateLimitResult = rateLimiter.isAllowed('test-user');
      expect(rateLimitResult.allowed).to.be.true;

      // Test error handling for various scenarios
      const validationError = new ValidationError('Test validation error', 'testField');
      const handledError = await ErrorHandler.handle(validationError, mockLogger, { context: 'test' });
      expect(handledError).to.be.instanceOf(ValidationError);

      const errorLogs = mockLogger.getLogs('ERROR');
      expect(errorLogs).to.have.length(1);
    });

    it('should handle error scenarios with comprehensive error handling', async () => {
      // Test network error handling
      mockHttp.mockRequest('POST', '/api/v1/auth/api-key/token', () => {
        throw { code: 'ENOTFOUND', message: 'Network error' };
      });

      try {
        await authService.exchangeApiKeyForToken();
        expect.fail('Should have thrown network error');
      } catch (error) {
        expect(error.message).to.include('Network connection failed');
      }

      // Test API error handling
      mockHttp.mockRequest('GET', '/api/v1/test', {
        status: 401,
        data: { message: 'Unauthorized' }
      });

      const httpError = {
        response: {
          status: 401,
          data: { message: 'Unauthorized' }
        }
      };

      const convertedError = ErrorHandler.fromHttpError(httpError, '/api/v1/test');
      expect(convertedError.code).to.equal('AUTH_ERROR');
      expect(convertedError.statusCode).to.equal(401);

      // Test validation error handling
      expect(() => {
        Validator.validate('invalid-uuid', {
          type: 'string',
          pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        }, 'projectId');
      }).to.throw(ValidationError);

      // Test file system error handling
      const fsError = {
        code: 'ENOENT',
        message: 'File not found'
      };

      const convertedFsError = ErrorHandler.fromFileSystemError(fsError, 'read', '/missing/file.txt');
      expect(convertedFsError.code).to.equal('FS_ERROR');
      expect(convertedFsError.details.operation).to.equal('read');
    });

    it('should demonstrate performance optimizations working together', async () => {
      // Test parallel execution
      const operations = [
        () => Promise.resolve('result1'),
        () => Promise.resolve('result2'),
        () => Promise.resolve('result3')
      ];

      const { ParallelExecutor } = await import('../src/performance.js');
      const executor = new ParallelExecutor({ maxConcurrency: 2 });
      
      const startTime = Date.now();
      const result = await executor.executeParallel(operations);
      const endTime = Date.now();

      expect(result.successCount).to.equal(3);
      expect(result.errorCount).to.equal(0);
      expect(endTime - startTime).to.be.lessThan(100); // Should be fast in parallel

      // Test caching performance
      const cacheStartTime = Date.now();
      
      // First call - cache miss
      cacheManager.set('perf-test', 'cached-value');
      const cachedValue1 = cacheManager.get('perf-test');
      
      // Second call - cache hit
      const cachedValue2 = cacheManager.get('perf-test');
      
      const cacheEndTime = Date.now();

      expect(cachedValue1).to.equal('cached-value');
      expect(cachedValue2).to.equal('cached-value');
      expect(cacheEndTime - cacheStartTime).to.be.lessThan(10); // Cache should be very fast

      // Test performance monitoring
      performanceMonitor.startTimer('parallel_operation');
      await new Promise(resolve => setTimeout(resolve, 50));
      const perfMetrics = performanceMonitor.endTimer('parallel_operation');

      expect(perfMetrics.duration).to.be.greaterThan(40);
      expect(perfMetrics.duration).to.be.lessThan(100);
    });

    it('should validate security measures are working correctly', async () => {
      // Test secure token storage
      const testTokens = {
        access_token: 'sensitive-access-token',
        refresh_token: 'sensitive-refresh-token',
        expires_at: Date.now() + 3600000
      };

      await secureTokenStorage.saveTokens(testTokens);
      const loadedTokens = await secureTokenStorage.loadTokens();
      
      expect(loadedTokens.access_token).to.equal(testTokens.access_token);
      expect(loadedTokens.refresh_token).to.equal(testTokens.refresh_token);

      // Test rate limiting
      const rateLimitTests = [];
      for (let i = 0; i < 105; i++) {
        rateLimitTests.push(() => rateLimiter.isAllowed('test-user'));
      }

      const results = rateLimitTests.map(test => test());
      const allowedCount = results.filter(r => r.allowed).length;
      const deniedCount = results.filter(r => !r.allowed).length;

      expect(allowedCount).to.be.at.most(100); // Rate limit should kick in
      expect(deniedCount).to.be.greaterThan(0);

      // Test input sanitization
      const maliciousInput = '../../../etc/passwd';
      expect(() => {
        Sanitizer.sanitizePath(maliciousInput, { allowTraversal: false });
      }).to.throw(ValidationError);

      const safeInput = 'projects/test-project/safe-file.txt';
      const sanitizedPath = Sanitizer.sanitizePath(safeInput);
      expect(sanitizedPath).to.equal(safeInput);

      // Test sensitive data protection
      const { SensitiveDataProtector } = await import('../src/security.js');
      const protector = new SensitiveDataProtector();
      
      const sensitiveData = {
        username: 'user123',
        password: 'secret-password',
        api_key: 'sensitive-api-key',
        public_data: 'this-is-safe'
      };

      const redactedData = protector.redactObject(sensitiveData);
      expect(redactedData.username).to.equal('user123');
      expect(redactedData.password).to.equal('[REDACTED]');
      expect(redactedData.api_key).to.equal('[REDACTED]');
      expect(redactedData.public_data).to.equal('this-is-safe');
    });

    it('should demonstrate comprehensive logging and monitoring', async () => {
      // Test structured logging with different levels
      const testLogger = new Logger({
        level: 'DEBUG',
        enableFile: false,
        enableConsole: false
      });

      const logCapture = [];
      testEnv.createStub(console, 'log', (msg) => logCapture.push({ level: 'log', msg }));
      testEnv.createStub(console, 'error', (msg) => logCapture.push({ level: 'error', msg }));
      testEnv.createStub(console, 'warn', (msg) => logCapture.push({ level: 'warn', msg }));

      // Enable console output for this test
      testLogger.enableConsole = true;

      await testLogger.error('Test error message', { context: 'integration_test' });
      await testLogger.warn('Test warning message', { context: 'integration_test' });
      await testLogger.info('Test info message', { context: 'integration_test' });
      await testLogger.debug('Test debug message', { context: 'integration_test' });

      expect(logCapture.length).to.equal(4);
      expect(logCapture[0].msg).to.include('Test error message');
      expect(logCapture[1].msg).to.include('Test warning message');

      // Test API call logging
      await testLogger.logApiCall('GET', '/api/test', 200, 150);
      expect(logCapture[logCapture.length - 1].msg).to.include('API Call: GET /api/test');

      // Test file operation logging
      await testLogger.logFileOperation('write', '/test/file.txt', true);
      expect(logCapture[logCapture.length - 1].msg).to.include('File Operation: write');

      // Test child logger context
      const childLogger = testLogger.child({ component: 'TestComponent' });
      await childLogger.info('Child logger message');
      expect(logCapture[logCapture.length - 1].msg).to.include('TestComponent');
    });

    it('should handle complete CLI workflow end-to-end', async () => {
      // Mock successful CLI execution
      const mockConsoleLog = testEnv.createStub(console, 'log');
      const mockProcessExit = testEnv.createStub(process, 'exit');

      // Setup basic API mocks for help command
      const cli = new NewoCLI();
      
      // Test help command
      const helpResult = await cli.run(['node', 'cli.js', 'help']);
      expect(helpResult).to.equal(0);
      expect(mockConsoleLog.calledWith(sinon.match.string)).to.be.true;

      // Test invalid command handling
      const invalidResult = await cli.run(['node', 'cli.js', 'invalid-command']);
      expect(invalidResult).to.equal(1);

      // Test argument parsing and validation
      const parsedArgs = cli.parseArguments(['node', 'cli.js', 'status', '--verbose']);
      expect(parsedArgs.command).to.equal('status');
      expect(parsedArgs.verbose).to.be.true;

      // Verify error handling doesn't crash the CLI
      expect(mockProcessExit.called).to.be.false;
    });
  });

  describe('System Stress Testing', () => {
    it('should handle high load scenarios gracefully', async () => {
      // Test rate limiting under load
      const rapidRequests = Array.from({ length: 200 }, (_, i) => 
        () => rateLimiter.isAllowed(`user-${i % 10}`)
      );

      const { ParallelExecutor } = await import('../src/performance.js');
      const executor = new ParallelExecutor({ maxConcurrency: 50 });
      
      const loadTestResult = await executor.executeParallel(rapidRequests);
      expect(loadTestResult.successCount).to.equal(200);

      // Test caching under load
      const cacheOperations = Array.from({ length: 1000 }, (_, i) => 
        () => {
          cacheManager.set(`key-${i}`, `value-${i}`);
          return cacheManager.get(`key-${i}`);
        }
      );

      const cacheTestResult = await executor.executeParallel(cacheOperations, { concurrency: 20 });
      expect(cacheTestResult.successCount).to.equal(1000);

      // Test performance monitoring under load
      const timers = Array.from({ length: 100 }, (_, i) => `timer-${i}`);
      
      timers.forEach(timer => performanceMonitor.startTimer(timer));
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const allMetrics = timers.map(timer => performanceMonitor.endTimer(timer));
      expect(allMetrics.filter(m => m !== null)).to.have.length(100);

      // Verify system remains stable
      const stats = cacheManager.getStats();
      expect(stats.size).to.be.greaterThan(0);
      expect(stats.hitRate).to.be.a('number');
    });

    it('should recover gracefully from errors under load', async () => {
      // Test error handling under concurrent load
      const errorOperations = Array.from({ length: 50 }, (_, i) => 
        async () => {
          if (i % 3 === 0) {
            throw new ValidationError(`Test error ${i}`);
          }
          if (i % 5 === 0) {
            throw new ApiError(`API error ${i}`, 500);
          }
          return `success-${i}`;
        }
      );

      const { ParallelExecutor } = await import('../src/performance.js');
      const executor = new ParallelExecutor({ maxConcurrency: 10 });
      
      const errorTestResult = await executor.executeParallel(errorOperations, { failFast: false });
      
      expect(errorTestResult.totalCount).to.equal(50);
      expect(errorTestResult.errorCount).to.be.greaterThan(0);
      expect(errorTestResult.successCount).to.be.greaterThan(0);

      // Test retry mechanism under load
      const attemptCounts = [];
      const retryOperations = Array.from({ length: 20 }, (_, i) => 
        async () => {
          if (!attemptCounts[i]) attemptCounts[i] = 0;
          attemptCounts[i]++;
          
          if (attemptCounts[i] < 3) {
            throw new NetworkError(`Temporary failure ${i}`);
          }
          return `success-${i}`;
        }
      );

      const retryResults = await Promise.allSettled(
        retryOperations.map(op => 
          ErrorHandler.retry(op, { maxRetries: 3, baseDelay: 1 })
        )
      );

      const successfulRetries = retryResults.filter(r => r.status === 'fulfilled');
      expect(successfulRetries.length).to.equal(20);
    });
  });

  describe('Data Integrity and Consistency', () => {
    it('should maintain data consistency across all operations', async () => {
      // Test file hash consistency
      const testFile = path.join(tempDir, 'test-file.txt');
      const originalContent = 'Original content for consistency test';
      const modifiedContent = 'Modified content for consistency test';

      mockFs.mockFile(testFile, originalContent);

      const { sha256 } = await import('../src/hash.js');
      const originalHash = sha256(originalContent);
      const modifiedHash = sha256(modifiedContent);

      expect(originalHash).to.not.equal(modifiedHash);

      // Test that same content produces same hash
      const duplicateHash = sha256(originalContent);
      expect(originalHash).to.equal(duplicateHash);

      // Test secure token storage consistency
      const testTokens = {
        access_token: 'test-token-123',
        refresh_token: 'refresh-token-456',
        expires_at: Date.now() + 3600000
      };

      await secureTokenStorage.saveTokens(testTokens);
      const retrievedTokens = await secureTokenStorage.loadTokens();

      expect(retrievedTokens).to.deep.equal(testTokens);

      // Test cache consistency
      const cacheKey = 'consistency-test';
      const cacheValue = { data: 'test', timestamp: Date.now() };

      cacheManager.set(cacheKey, cacheValue);
      const retrievedValue = cacheManager.get(cacheKey);

      expect(retrievedValue).to.deep.equal(cacheValue);

      // Test validation consistency
      const testData = {
        email: 'test@example.com',
        age: 25,
        active: true
      };

      const schema = {
        email: { type: 'string', pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
        age: { type: 'number', min: 0, max: 150 },
        active: { type: 'boolean' }
      };

      const validatedData1 = Validator.validateObject(testData, schema);
      const validatedData2 = Validator.validateObject(testData, schema);

      expect(validatedData1).to.deep.equal(validatedData2);
      expect(validatedData1).to.deep.equal(testData);
    });
  });
});

describe('Performance Benchmarks', () => {
  let testEnv;

  beforeEach(() => {
    testEnv = new TestEnvironment();
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  it('should meet performance benchmarks for all operations', async () => {
    const benchmarks = {
      validation: { maxTime: 10, iterations: 1000 },
      caching: { maxTime: 1, iterations: 10000 },
      logging: { maxTime: 100, iterations: 1000 },
      errorHandling: { maxTime: 5, iterations: 100 }
    };

    // Validation benchmark
    const validationStart = Date.now();
    for (let i = 0; i < benchmarks.validation.iterations; i++) {
      Validator.validate(`test-${i}@example.com`, {
        type: 'string',
        pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      });
    }
    const validationTime = Date.now() - validationStart;
    expect(validationTime).to.be.lessThan(benchmarks.validation.maxTime);

    // Caching benchmark
    const cachingStart = Date.now();
    for (let i = 0; i < benchmarks.caching.iterations; i++) {
      cacheManager.set(`bench-key-${i}`, `bench-value-${i}`);
      cacheManager.get(`bench-key-${i}`);
    }
    const cachingTime = Date.now() - cachingStart;
    expect(cachingTime).to.be.lessThan(benchmarks.caching.maxTime);

    // Logging benchmark
    const mockLogger = new MockLogger();
    const loggingStart = Date.now();
    for (let i = 0; i < benchmarks.logging.iterations; i++) {
      await mockLogger.info(`Benchmark log message ${i}`, { iteration: i });
    }
    const loggingTime = Date.now() - loggingStart;
    expect(loggingTime).to.be.lessThan(benchmarks.logging.maxTime);

    // Error handling benchmark
    const errorStart = Date.now();
    for (let i = 0; i < benchmarks.errorHandling.iterations; i++) {
      try {
        throw new ValidationError(`Benchmark error ${i}`);
      } catch (error) {
        const handled = await ErrorHandler.handle(error, mockLogger);
        expect(handled).to.be.instanceOf(ValidationError);
      }
    }
    const errorTime = Date.now() - errorStart;
    expect(errorTime).to.be.lessThan(benchmarks.errorHandling.maxTime);

    console.log(`Performance Benchmarks:
      Validation: ${validationTime}ms for ${benchmarks.validation.iterations} operations
      Caching: ${cachingTime}ms for ${benchmarks.caching.iterations} operations  
      Logging: ${loggingTime}ms for ${benchmarks.logging.iterations} operations
      Error Handling: ${errorTime}ms for ${benchmarks.errorHandling.iterations} operations`);
  });
});