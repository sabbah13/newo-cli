/**
 * Comprehensive tests for security enhancements
 */
import { expect } from 'chai';
import fs from 'fs-extra';
import {
  EncryptionService,
  SecureTokenStorage,
  RateLimiter,
  SecurePathValidator,
  SensitiveDataProtector,
  SecurityAuditor
} from '../src/security.js';
import { SecurityError, RateLimitError } from '../src/errors.js';
import { TestEnvironment } from './test-utils.js';

describe('Security Enhancements', () => {
  let testEnv;
  let tempDir;

  beforeEach(async () => {
    testEnv = new TestEnvironment();
    tempDir = await testEnv.createTempDir();
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  describe('Encryption Service', () => {
    let encryptionService;

    beforeEach(() => {
      encryptionService = new EncryptionService();
    });

    it('should encrypt and decrypt data correctly', () => {
      const originalData = {
        secret: 'very-secret-token',
        timestamp: Date.now(),
        metadata: { user: 'test', scope: 'read' }
      };

      const encrypted = encryptionService.encrypt(originalData);
      
      expect(encrypted).to.have.property('encrypted');
      expect(encrypted).to.have.property('iv');
      expect(encrypted).to.have.property('salt');
      expect(encrypted).to.have.property('tag');
      expect(encrypted).to.have.property('algorithm');
      
      const decrypted = encryptionService.decrypt(encrypted);
      expect(decrypted).to.deep.equal(originalData);
    });

    it('should use different keys for different machines', () => {
      const data = { test: 'value' };
      
      const encrypted1 = encryptionService.encrypt(data);
      const encrypted2 = encryptionService.encrypt(data, 'custom-key-1');
      const encrypted3 = encryptionService.encrypt(data, 'custom-key-2');
      
      expect(encrypted1.encrypted).to.not.equal(encrypted2.encrypted);
      expect(encrypted2.encrypted).to.not.equal(encrypted3.encrypted);
    });

    it('should fail decryption with wrong key', () => {
      const data = { test: 'value' };
      const encrypted = encryptionService.encrypt(data, 'key1');
      
      expect(() => encryptionService.decrypt(encrypted, 'key2'))
        .to.throw(SecurityError, 'Decryption failed');
    });

    it('should fail decryption with tampered data', () => {
      const data = { test: 'value' };
      const encrypted = encryptionService.encrypt(data);
      
      // Tamper with encrypted data
      encrypted.encrypted = `${encrypted.encrypted.slice(0, -2)  }xx`;
      
      expect(() => encryptionService.decrypt(encrypted))
        .to.throw(SecurityError, 'Decryption failed');
    });

    it('should handle encryption errors gracefully', () => {
      expect(() => encryptionService.encrypt(null))
        .to.throw(SecurityError, 'Encryption failed');
    });

    it('should validate algorithm consistency', () => {
      const data = { test: 'value' };
      const encrypted = encryptionService.encrypt(data);
      
      // Change algorithm
      encrypted.algorithm = 'aes-128-gcm';
      
      expect(() => encryptionService.decrypt(encrypted))
        .to.throw(SecurityError, 'Algorithm mismatch');
    });
  });

  describe('Secure Token Storage', () => {
    let tokenStorage;

    beforeEach(async () => {
      // Mock getDirectories to use temp directory
      const mockGetDirectories = testEnv.createStub(
        await import('../src/config.js'),
        'getDirectories',
        () => ({ state: tempDir })
      );
      
      tokenStorage = new SecureTokenStorage();
      await tokenStorage._initialize();
    });

    it('should save and load tokens securely', async () => {
      const tokens = {
        access_token: 'secret-access-token',
        refresh_token: 'secret-refresh-token',
        expires_at: Date.now() + 3600000
      };

      await tokenStorage.saveTokens(tokens);
      const loadedTokens = await tokenStorage.loadTokens();
      
      expect(loadedTokens).to.deep.equal(tokens);
    });

    it('should return null for non-existent tokens', async () => {
      const tokens = await tokenStorage.loadTokens();
      expect(tokens).to.be.null;
    });

    it('should clear tokens successfully', async () => {
      const tokens = {
        access_token: 'test-token',
        refresh_token: 'test-refresh',
        expires_at: Date.now() + 3600000
      };

      await tokenStorage.saveTokens(tokens);
      expect(await tokenStorage.hasTokens()).to.be.true;
      
      await tokenStorage.clearTokens();
      expect(await tokenStorage.hasTokens()).to.be.false;
      
      const clearedTokens = await tokenStorage.loadTokens();
      expect(clearedTokens).to.be.null;
    });

    it('should check token existence correctly', async () => {
      expect(await tokenStorage.hasTokens()).to.be.false;
      
      const tokens = {
        access_token: 'test-token',
        expires_at: Date.now() + 3600000
      };
      
      await tokenStorage.saveTokens(tokens);
      expect(await tokenStorage.hasTokens()).to.be.true;
    });

    it('should handle corrupted token files gracefully', async () => {
      // Write invalid JSON to token file
      const tokenFile = require('path').join(tempDir, 'tokens.secure');
      await fs.writeFile(tokenFile, 'invalid-encrypted-data');
      
      expect(tokenStorage.loadTokens()).to.eventually.be.rejectedWith(SecurityError);
    });

    it('should set restrictive file permissions', async () => {
      const tokens = {
        access_token: 'test-token',
        expires_at: Date.now() + 3600000
      };

      // Mock fs.chmod to verify it's called with correct permissions
      const chmodStub = testEnv.createStub(fs, 'chmod');
      
      await tokenStorage.saveTokens(tokens);
      
      expect(chmodStub.calledWith(testEnv.sinon.match.string, 0o600)).to.be.true;
    });
  });

  describe('Rate Limiter', () => {
    let rateLimiter;

    beforeEach(() => {
      rateLimiter = new RateLimiter({
        windowMs: 1000, // 1 second for testing
        maxRequests: 5,
        cleanupInterval: 100
      });
    });

    afterEach(() => {
      rateLimiter.destroy();
    });

    it('should allow requests within limit', () => {
      for (let i = 0; i < 5; i++) {
        const result = rateLimiter.isAllowed('test-user');
        expect(result.allowed).to.be.true;
        expect(result.remaining).to.equal(4 - i);
      }
    });

    it('should reject requests over limit', () => {
      // Use up the limit
      for (let i = 0; i < 5; i++) {
        rateLimiter.isAllowed('test-user');
      }
      
      // Next request should be rejected
      const result = rateLimiter.isAllowed('test-user');
      expect(result.allowed).to.be.false;
      expect(result.remaining).to.equal(0);
      expect(result.retryAfter).to.be.greaterThan(0);
    });

    it('should track different users separately', () => {
      // User 1 uses up their limit
      for (let i = 0; i < 5; i++) {
        rateLimiter.isAllowed('user1');
      }
      
      // User 2 should still be allowed
      const result = rateLimiter.isAllowed('user2');
      expect(result.allowed).to.be.true;
      expect(result.remaining).to.equal(4);
    });

    it('should reset after time window', async () => {
      // Use up the limit
      for (let i = 0; i < 5; i++) {
        rateLimiter.isAllowed('test-user');
      }
      
      expect(rateLimiter.isAllowed('test-user').allowed).to.be.false;
      
      // Wait for window to reset
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      const result = rateLimiter.isAllowed('test-user');
      expect(result.allowed).to.be.true;
    });

    it('should record requests correctly', () => {
      expect(() => rateLimiter.recordRequest('test-user')).to.not.throw();
      
      // Use up remaining requests
      for (let i = 0; i < 4; i++) {
        rateLimiter.recordRequest('test-user');
      }
      
      // Should throw when over limit
      expect(() => rateLimiter.recordRequest('test-user')).to.throw(RateLimitError);
    });

    it('should provide status information', () => {
      rateLimiter.isAllowed('test-user');
      rateLimiter.isAllowed('test-user');
      
      const status = rateLimiter.getStatus('test-user');
      expect(status.remaining).to.equal(3);
      expect(status.resetTime).to.be.instanceOf(Date);
    });

    it('should reset specific user limits', () => {
      // Use up limit for user
      for (let i = 0; i < 5; i++) {
        rateLimiter.isAllowed('test-user');
      }
      
      expect(rateLimiter.isAllowed('test-user').allowed).to.be.false;
      
      rateLimiter.reset('test-user');
      
      const result = rateLimiter.isAllowed('test-user');
      expect(result.allowed).to.be.true;
    });

    it('should cleanup old entries', async () => {
      rateLimiter.isAllowed('test-user');
      
      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Internal state should be cleaned up (test implementation detail)
      expect(rateLimiter.requests.size).to.be.at.most(1);
    });
  });

  describe('Secure Path Validator', () => {
    let pathValidator;

    beforeEach(() => {
      pathValidator = new SecurePathValidator('/safe/base/path');
    });

    it('should validate safe paths', () => {
      const safePaths = [
        'projects/test/file.txt',
        'data/export.json',
        'configs/settings.yaml'
      ];

      for (const safePath of safePaths) {
        const result = pathValidator.validatePath(safePath);
        expect(result.original).to.equal(safePath);
        expect(result.sanitized).to.equal(safePath);
        expect(result.isAbsolute).to.be.false;
      }
    });

    it('should reject dangerous paths', () => {
      const dangerousPaths = [
        '../../../etc/passwd',
        'projects/../../../sensitive',
        'normal/../../../../../dangerous',
        'path/with\x00null',
        'path/with<dangerous>chars'
      ];

      for (const dangerousPath of dangerousPaths) {
        expect(() => pathValidator.validatePath(dangerousPath))
          .to.throw(SecurityError, 'Path validation failed');
      }
    });

    it('should handle absolute path restrictions', () => {
      const absolutePaths = [
        '/etc/passwd',
        'C:\\Windows\\System32',
        '/home/user/file.txt'
      ];

      for (const absolutePath of absolutePaths) {
        expect(() => pathValidator.validatePath(absolutePath, { allowAbsolute: false }))
          .to.throw(SecurityError, 'Absolute paths not allowed');
      }
    });

    it('should validate file extensions', () => {
      const allowedExtensions = ['.txt', '.json', '.js'];
      
      expect(() => pathValidator.validatePath('test.txt', { 
        requireExtension: true, 
        allowedExtensions 
      })).to.not.throw();
      
      expect(() => pathValidator.validatePath('test.exe', { 
        requireExtension: true, 
        allowedExtensions 
      })).to.throw(SecurityError, 'File extension not allowed');
    });

    it('should check if paths are safe', () => {
      expect(pathValidator.isSafePath('projects/safe/file.txt')).to.be.true;
      expect(pathValidator.isSafePath('../../../dangerous')).to.be.false;
      expect(pathValidator.isSafePath('path\x00with\x00nulls')).to.be.false;
    });

    it('should validate multiple paths', () => {
      const paths = [
        'projects/test1.txt',
        'data/test2.json',
        'configs/test3.yaml'
      ];

      const results = pathValidator.validatePaths(paths);
      expect(results).to.have.length(3);
      
      for (const result of results) {
        expect(result).to.have.property('original');
        expect(result).to.have.property('sanitized');
        expect(result).to.have.property('resolved');
      }
    });

    it('should resolve paths against base path', () => {
      const result = pathValidator.validatePath('projects/file.txt');
      expect(result.resolved).to.include('/safe/base/path');
      expect(result.resolved).to.include('projects/file.txt');
    });

    it('should provide detailed path information', () => {
      const result = pathValidator.validatePath('projects/data/file.txt');
      
      expect(result.original).to.equal('projects/data/file.txt');
      expect(result.extension).to.equal('.txt');
      expect(result.filename).to.equal('file.txt');
      expect(result.directory).to.include('projects/data');
    });
  });

  describe('Sensitive Data Protector', () => {
    let protector;

    beforeEach(() => {
      protector = new SensitiveDataProtector();
    });

    it('should redact sensitive patterns in text', () => {
      const sensitiveTexts = [
        'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
        'password: secret123',
        'api_key: abcdef123456789',
        'secret: very-secret-value'
      ];

      for (const sensitiveText of sensitiveTexts) {
        const redacted = protector.redact(sensitiveText);
        expect(redacted).to.include('[REDACTED]');
        expect(redacted).to.not.include('secret123');
        expect(redacted).to.not.include('abcdef123456789');
      }
    });

    it('should redact sensitive keys in objects', () => {
      const sensitiveObj = {
        username: 'john_doe',
        password: 'secret-password',
        api_key: 'sensitive-api-key',
        token: 'bearer-token',
        public_data: 'this-is-safe',
        nested: {
          secret: 'nested-secret',
          public: 'nested-public'
        }
      };

      const redacted = protector.redactObject(sensitiveObj);
      
      expect(redacted.username).to.equal('john_doe');
      expect(redacted.password).to.equal('[REDACTED]');
      expect(redacted.api_key).to.equal('[REDACTED]');
      expect(redacted.token).to.equal('[REDACTED]');
      expect(redacted.public_data).to.equal('this-is-safe');
      expect(redacted.nested.secret).to.equal('[REDACTED]');
      expect(redacted.nested.public).to.equal('nested-public');
    });

    it('should handle arrays of objects', () => {
      const sensitiveArray = [
        { username: 'user1', password: 'pass1' },
        { username: 'user2', api_key: 'key2' }
      ];

      const redacted = protector.redactObject(sensitiveArray);
      
      expect(redacted[0].username).to.equal('user1');
      expect(redacted[0].password).to.equal('[REDACTED]');
      expect(redacted[1].username).to.equal('user2');
      expect(redacted[1].api_key).to.equal('[REDACTED]');
    });

    it('should handle custom sensitive keys', () => {
      const obj = {
        user_id: 'user123',
        credit_card: '1234-5678-9012-3456',
        email: 'user@example.com'
      };

      const redacted = protector.redactObject(obj, ['credit_card', 'email']);
      
      expect(redacted.user_id).to.equal('user123');
      expect(redacted.credit_card).to.equal('[REDACTED]');
      expect(redacted.email).to.equal('[REDACTED]');
    });

    it('should safely log objects', () => {
      const obj = {
        request_id: 'req-123',
        password: 'secret',
        response: 'success'
      };

      const safeLogged = protector.safeLog(obj);
      expect(safeLogged.request_id).to.equal('req-123');
      expect(safeLogged.password).to.equal('[REDACTED]');
      expect(safeLogged.response).to.equal('success');
    });

    it('should handle non-object inputs gracefully', () => {
      expect(protector.redactObject(null)).to.be.null;
      expect(protector.redactObject('string')).to.equal('string');
      expect(protector.redactObject(123)).to.equal(123);
      expect(protector.redactObject(true)).to.equal(true);
    });

    it('should clear sensitive data from memory', () => {
      const sensitiveObj = {
        password: 'secret-password',
        token: 'bearer-token'
      };

      protector.clearFromMemory(sensitiveObj);
      
      // Object should be modified
      expect(Object.keys(sensitiveObj)).to.have.length(0);
    });
  });

  describe('Security Auditor', () => {
    let auditor;

    beforeEach(() => {
      auditor = new SecurityAuditor();
    });

    it('should audit file permissions', async () => {
      const testFile = require('path').join(tempDir, 'test-file.txt');
      await fs.writeFile(testFile, 'test content');
      
      // Mock fs.stat to return specific permissions
      const mockStats = {
        mode: 0o644 // readable by group and others
      };
      testEnv.createStub(fs, 'stat').resolves(mockStats);
      
      await auditor.auditFilePermissions(testFile);
      
      const report = auditor.getReport();
      expect(report.violations).to.have.length.greaterThan(0);
      
      const permissionViolation = report.violations.find(v => v.type === 'file_permissions');
      expect(permissionViolation).to.exist;
      expect(permissionViolation.severity).to.equal('medium');
    });

    it('should audit directory structure', async () => {
      // Mock getDirectories
      const mockGetDirectories = testEnv.createStub(
        await import('../src/config.js'),
        'getDirectories',
        () => ({
          state: `${tempDir  }/state`,
          logs: `${tempDir  }/logs`,
          cache: `${tempDir  }/cache`
        })
      );

      await auditor.auditDirectoryStructure(tempDir);
      
      const report = auditor.getReport();
      expect(report.violations).to.have.length.greaterThan(0);
      
      const dirViolations = report.violations.filter(v => v.type === 'directory_missing');
      expect(dirViolations.length).to.be.greaterThan(0);
    });

    it('should generate comprehensive audit report', () => {
      // Add some test violations
      auditor.violations.push(
        { type: 'test_high', severity: 'high', issue: 'High severity test' },
        { type: 'test_medium', severity: 'medium', issue: 'Medium severity test' },
        { type: 'test_low', severity: 'low', issue: 'Low severity test' }
      );

      const report = auditor.getReport();
      
      expect(report.timestamp).to.be.a('string');
      expect(report.totalViolations).to.equal(3);
      expect(report.severityBreakdown.high).to.equal(1);
      expect(report.severityBreakdown.medium).to.equal(1);
      expect(report.severityBreakdown.low).to.equal(1);
      expect(report.violations).to.have.length(3);
    });

    it('should clear audit results', () => {
      auditor.violations.push({ type: 'test', severity: 'low', issue: 'Test violation' });
      
      expect(auditor.violations).to.have.length(1);
      
      auditor.clearResults();
      
      expect(auditor.violations).to.have.length(0);
    });

    it('should handle file access errors gracefully', async () => {
      const nonExistentFile = '/path/to/nonexistent/file';
      
      await auditor.auditFilePermissions(nonExistentFile);
      
      const report = auditor.getReport();
      const accessViolation = report.violations.find(v => v.type === 'file_access');
      expect(accessViolation).to.exist;
      expect(accessViolation.severity).to.equal('low');
    });
  });

  describe('Integration Security Tests', () => {
    it('should demonstrate complete security workflow', async () => {
      // 1. Test secure token storage
      const tokenStorage = new SecureTokenStorage();
      const mockGetDirectories = testEnv.createStub(
        await import('../src/config.js'),
        'getDirectories',
        () => ({ state: tempDir })
      );
      
      await tokenStorage._initialize();
      
      const tokens = {
        access_token: 'super-secret-token',
        refresh_token: 'super-secret-refresh',
        expires_at: Date.now() + 3600000
      };
      
      await tokenStorage.saveTokens(tokens);
      const retrievedTokens = await tokenStorage.loadTokens();
      expect(retrievedTokens).to.deep.equal(tokens);

      // 2. Test rate limiting
      const rateLimiter = new RateLimiter({ maxRequests: 3, windowMs: 1000 });
      
      for (let i = 0; i < 3; i++) {
        expect(rateLimiter.isAllowed('user').allowed).to.be.true;
      }
      expect(rateLimiter.isAllowed('user').allowed).to.be.false;

      // 3. Test path validation
      const pathValidator = new SecurePathValidator();
      expect(pathValidator.isSafePath('projects/safe.txt')).to.be.true;
      expect(pathValidator.isSafePath('../../../etc/passwd')).to.be.false;

      // 4. Test data protection
      const protector = new SensitiveDataProtector();
      const sensitiveData = { password: 'secret', public: 'data' };
      const redacted = protector.redactObject(sensitiveData);
      expect(redacted.password).to.equal('[REDACTED]');
      expect(redacted.public).to.equal('data');

      // 5. Test security audit
      const auditor = new SecurityAuditor();
      await auditor.auditDirectoryStructure(tempDir);
      const report = auditor.getReport();
      expect(report.totalViolations).to.be.a('number');

      // Cleanup
      rateLimiter.destroy();
    });

    it('should handle concurrent security operations safely', async () => {
      const operations = [];
      
      // Create multiple security operations
      for (let i = 0; i < 10; i++) {
        operations.push(async () => {
          const rateLimiter = new RateLimiter();
          const result = rateLimiter.isAllowed(`user-${i}`);
          rateLimiter.destroy();
          return result.allowed;
        });
        
        operations.push(async () => {
          const protector = new SensitiveDataProtector();
          return protector.redact(`secret-${i}: sensitive-data-${i}`);
        });
        
        operations.push(async () => {
          const pathValidator = new SecurePathValidator();
          return pathValidator.isSafePath(`projects/file-${i}.txt`);
        });
      }
      
      const results = await Promise.all(operations.map(op => op()));
      
      // All operations should complete successfully
      expect(results).to.have.length(30);
      expect(results.every(result => result !== undefined)).to.be.true;
    });
  });
});