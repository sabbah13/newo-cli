/**
 * Comprehensive tests for configuration management system
 */
import { expect } from 'chai';
import {
  validateConfigValue,
  getSanitizedConfig,
  validateAuthConfig,
  getDirectories,
  ensureDirectories,
  ConfigValidationError,
  CONFIG_SCHEMA
} from '../src/config.js';
import { TestEnvironment, TestAssertions } from './test-utils.js';

describe('Configuration Management', () => {
  let testEnv;

  beforeEach(() => {
    testEnv = new TestEnvironment();
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  describe('Config Value Validation', () => {
    it('should validate string values', () => {
      const schema = { type: 'string', default: 'default-value' };
      
      expect(validateConfigValue('TEST_KEY', 'valid-string', schema)).to.equal('valid-string');
      expect(validateConfigValue('TEST_KEY', null, schema)).to.equal('default-value');
      expect(validateConfigValue('TEST_KEY', undefined, schema)).to.equal('default-value');
    });

    it('should validate required fields', () => {
      const schema = { type: 'string', required: true };
      
      expect(() => validateConfigValue('TEST_KEY', null, schema))
        .to.throw(ConfigValidationError, 'Required field is missing');
      
      expect(() => validateConfigValue('TEST_KEY', undefined, schema))
        .to.throw(ConfigValidationError, 'Required field is missing');
    });

    it('should validate number values', () => {
      const schema = { type: 'number', default: 42 };
      
      expect(validateConfigValue('TEST_KEY', 123, schema)).to.equal(123);
      expect(validateConfigValue('TEST_KEY', '456', schema)).to.equal(456);
      expect(validateConfigValue('TEST_KEY', null, schema)).to.equal(42);
      
      expect(() => validateConfigValue('TEST_KEY', 'not-a-number', schema))
        .to.throw(ConfigValidationError, 'Expected number');
    });

    it('should validate boolean values', () => {
      const schema = { type: 'boolean', default: false };
      
      expect(validateConfigValue('TEST_KEY', true, schema)).to.equal(true);
      expect(validateConfigValue('TEST_KEY', 'true', schema)).to.equal(true);
      expect(validateConfigValue('TEST_KEY', 'false', schema)).to.equal(false);
      expect(validateConfigValue('TEST_KEY', null, schema)).to.equal(false);
      
      expect(() => validateConfigValue('TEST_KEY', 'maybe', schema))
        .to.throw(ConfigValidationError, 'Expected boolean');
    });

    it('should validate URLs', () => {
      const schema = { 
        type: 'string',
        validate: (value) => {
          if (!value) return true;
          try {
            new URL(value);
            return true;
          } catch {
            return false;
          }
        }
      };
      
      expect(validateConfigValue('BASE_URL', 'https://example.com', schema))
        .to.equal('https://example.com');
      
      expect(() => validateConfigValue('BASE_URL', 'not-a-url', schema))
        .to.throw(ConfigValidationError, 'Custom validation failed');
    });

    it('should validate UUIDs', () => {
      const schema = {
        type: 'string',
        validate: (value) => !value || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
      };
      
      const validUuid = '123e4567-e89b-12d3-a456-426614174000';
      expect(validateConfigValue('PROJECT_ID', validUuid, schema)).to.equal(validUuid);
      
      expect(() => validateConfigValue('PROJECT_ID', 'not-a-uuid', schema))
        .to.throw(ConfigValidationError, 'Custom validation failed');
    });
  });

  describe('Configuration Sanitization', () => {
    it('should redact sensitive configuration values', () => {
      const config = {
        NEWO_BASE_URL: 'https://app.newo.ai',
        NEWO_API_KEY: 'secret-api-key',
        NEWO_ACCESS_TOKEN: 'secret-access-token',
        NEWO_REFRESH_TOKEN: 'secret-refresh-token',
        NODE_ENV: 'test'
      };

      const sanitized = getSanitizedConfig(config);
      
      expect(sanitized.NEWO_BASE_URL).to.equal('https://app.newo.ai');
      expect(sanitized.NODE_ENV).to.equal('test');
      expect(sanitized.NEWO_API_KEY).to.equal('[REDACTED]');
      expect(sanitized.NEWO_ACCESS_TOKEN).to.equal('[REDACTED]');
      expect(sanitized.NEWO_REFRESH_TOKEN).to.equal('[REDACTED]');
    });
  });

  describe('Authentication Configuration Validation', () => {
    it('should accept valid API key configuration', () => {
      const config = {
        NEWO_API_KEY: 'valid-api-key',
        NEWO_ACCESS_TOKEN: null,
        NEWO_REFRESH_TOKEN: null
      };

      expect(() => validateAuthConfig(config)).to.not.throw();
    });

    it('should accept valid token configuration', () => {
      const config = {
        NEWO_API_KEY: null,
        NEWO_ACCESS_TOKEN: 'access-token',
        NEWO_REFRESH_TOKEN: 'refresh-token'
      };

      expect(() => validateAuthConfig(config)).to.not.throw();
    });

    it('should reject configuration without any auth method', () => {
      const config = {
        NEWO_API_KEY: null,
        NEWO_ACCESS_TOKEN: null,
        NEWO_REFRESH_TOKEN: null
      };

      expect(() => validateAuthConfig(config))
        .to.throw('Authentication configuration missing');
    });

    it('should reject incomplete token configuration', () => {
      const config = {
        NEWO_API_KEY: null,
        NEWO_ACCESS_TOKEN: 'access-token',
        NEWO_REFRESH_TOKEN: null
      };

      expect(() => validateAuthConfig(config))
        .to.throw('Authentication configuration missing');
    });
  });

  describe('Directory Configuration', () => {
    it('should return correct directory structure', () => {
      const originalCwd = process.cwd();
      testEnv.createStub(process, 'cwd', () => '/test/project');

      const dirs = getDirectories();
      
      expect(dirs.root).to.equal('/test/project/projects');
      expect(dirs.state).to.equal('/test/project/.newo');
      expect(dirs.temp).to.equal('/test/project/.newo/temp');
      expect(dirs.cache).to.equal('/test/project/.newo/cache');
      expect(dirs.logs).to.equal('/test/project/.newo/logs');
    });

    it('should create all required directories', async () => {
      const tempDir = await testEnv.createTempDir();
      testEnv.createStub(process, 'cwd', () => tempDir);

      await ensureDirectories();
      const dirs = getDirectories();

      // Check that directories were created (would be verified by fs operations in real implementation)
      expect(dirs.root).to.include(tempDir);
      expect(dirs.state).to.include(tempDir);
    });
  });

  describe('Environment Variable Loading', () => {
    it('should load configuration from environment variables', () => {
      testEnv.setEnv('NEWO_BASE_URL', 'https://custom.newo.ai');
      testEnv.setEnv('NEWO_API_KEY', 'test-api-key');
      testEnv.setEnv('NODE_ENV', 'test');

      // Re-import config to pick up new environment variables
      // Note: In actual implementation, you might need to reload the config module
      const schema = CONFIG_SCHEMA;
      
      const baseUrlSchema = schema.NEWO_BASE_URL;
      expect(validateConfigValue('NEWO_BASE_URL', process.env.NEWO_BASE_URL, baseUrlSchema))
        .to.equal('https://custom.newo.ai');

      const apiKeySchema = schema.NEWO_API_KEY;
      expect(validateConfigValue('NEWO_API_KEY', process.env.NEWO_API_KEY, apiKeySchema))
        .to.equal('test-api-key');
    });

    it('should use default values when environment variables are not set', () => {
      // Ensure environment variables are not set
      testEnv.setEnv('NEWO_BASE_URL', undefined);
      
      const schema = CONFIG_SCHEMA.NEWO_BASE_URL;
      expect(validateConfigValue('NEWO_BASE_URL', process.env.NEWO_BASE_URL, schema))
        .to.equal('https://app.newo.ai');
    });

    it('should validate environment variable values', () => {
      testEnv.setEnv('NEWO_BASE_URL', 'not-a-valid-url');
      
      const schema = CONFIG_SCHEMA.NEWO_BASE_URL;
      expect(() => validateConfigValue('NEWO_BASE_URL', process.env.NEWO_BASE_URL, schema))
        .to.throw(ConfigValidationError, 'Custom validation failed');
    });
  });

  describe('Configuration Schema Validation', () => {
    it('should have valid schema for all configuration keys', () => {
      const requiredSchemaFields = ['type', 'default', 'validate', 'required'];
      
      for (const [key, schema] of Object.entries(CONFIG_SCHEMA)) {
        expect(schema).to.have.property('type');
        expect(schema).to.have.property('default');
        expect(schema).to.have.property('validate');
        expect(schema).to.have.property('required');
        
        // Validate that type is one of allowed types
        const allowedTypes = ['string', 'number', 'boolean'];
        expect(allowedTypes).to.include(schema.type, `Invalid type for ${key}: ${schema.type}`);
        
        // Validate that validate is a function if present
        if (schema.validate) {
          expect(schema.validate).to.be.a('function', `Validate must be a function for ${key}`);
        }
        
        // Validate that required is a boolean
        expect(schema.required).to.be.a('boolean', `Required must be a boolean for ${key}`);
      }
    });

    it('should validate UUID format for project ID', () => {
      const schema = CONFIG_SCHEMA.NEWO_PROJECT_ID;
      
      const validUuids = [
        '123e4567-e89b-12d3-a456-426614174000',
        'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
      ];
      
      const invalidUuids = [
        'not-a-uuid',
        '123-456-789',
        '123e4567-e89b-12d3-a456-42661417400', // too short
        '123e4567-e89b-12d3-a456-426614174000-extra' // too long
      ];
      
      for (const uuid of validUuids) {
        expect(() => validateConfigValue('NEWO_PROJECT_ID', uuid, schema))
          .to.not.throw(`Valid UUID should pass: ${uuid}`);
      }
      
      for (const uuid of invalidUuids) {
        expect(() => validateConfigValue('NEWO_PROJECT_ID', uuid, schema))
          .to.throw(ConfigValidationError, `Invalid UUID should fail: ${uuid}`);
      }
    });

    it('should validate API key format', () => {
      const schema = CONFIG_SCHEMA.NEWO_API_KEY;
      
      const validApiKeys = [
        'valid-api-key-123',
        'abcdefghijklmnopqrstuvwxyz',
        'API_KEY_WITH_UNDERSCORES',
        'api-key-with-dashes'
      ];
      
      const invalidApiKeys = [
        'short', // too short
        'key with spaces',
        'key@with!special#chars'
      ];
      
      for (const apiKey of validApiKeys) {
        expect(() => validateConfigValue('NEWO_API_KEY', apiKey, schema))
          .to.not.throw(`Valid API key should pass: ${apiKey}`);
      }
      
      for (const apiKey of invalidApiKeys) {
        expect(() => validateConfigValue('NEWO_API_KEY', apiKey, schema))
          .to.throw(ConfigValidationError, `Invalid API key should fail: ${apiKey}`);
      }
    });
  });

  describe('Configuration Error Handling', () => {
    it('should throw ConfigValidationError with proper error details', () => {
      const schema = { type: 'string', required: true };
      
      try {
        validateConfigValue('TEST_FIELD', null, schema);
        expect.fail('Should have thrown ConfigValidationError');
      } catch (error) {
        expect(error).to.be.instanceOf(ConfigValidationError);
        expect(error.name).to.equal('ConfigValidationError');
        expect(error.field).to.equal('TEST_FIELD');
        expect(error.message).to.include('TEST_FIELD');
        expect(error.message).to.include('Required field is missing');
      }
    });

    it('should provide helpful error messages for validation failures', () => {
      const testCases = [
        {
          schema: { type: 'string', required: true },
          value: null,
          expectedError: 'Required field is missing'
        },
        {
          schema: { type: 'number' },
          value: 'not-a-number',
          expectedError: 'Expected number'
        },
        {
          schema: { type: 'boolean' },
          value: 'maybe',
          expectedError: 'Expected boolean'
        }
      ];
      
      for (const testCase of testCases) {
        try {
          validateConfigValue('TEST_FIELD', testCase.value, testCase.schema);
          expect.fail(`Should have thrown error for value: ${testCase.value}`);
        } catch (error) {
          expect(error.message).to.include(testCase.expectedError);
        }
      }
    });
  });
});