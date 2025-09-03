/**
 * Comprehensive tests for validation and sanitization system
 */
import { expect } from 'chai';
import {
  VALIDATION_TYPES,
  PATTERNS,
  SECURITY,
  Sanitizer,
  Validator,
  SCHEMAS
} from '../src/validation.js';
import { ValidationError } from '../src/errors.js';
import { TestEnvironment } from './test-utils.js';

describe('Validation and Sanitization System', () => {
  let testEnv;

  beforeEach(() => {
    testEnv = new TestEnvironment();
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  describe('Sanitizer Class', () => {
    describe('sanitizeString', () => {
      it('should sanitize basic string values', () => {
        expect(Sanitizer.sanitizeString('  hello world  ', { trim: true })).to.equal('hello world');
        expect(Sanitizer.sanitizeString('hello world', { trim: false })).to.equal('hello world');
      });

      it('should enforce maximum length limits', () => {
        const longString = 'a'.repeat(1000);
        expect(() => Sanitizer.sanitizeString(longString, { maxLength: 100 }))
          .to.throw(ValidationError, 'String too long');
      });

      it('should handle empty string validation', () => {
        expect(() => Sanitizer.sanitizeString('', { allowEmpty: false }))
          .to.throw(ValidationError, 'String cannot be empty');
        
        expect(Sanitizer.sanitizeString('', { allowEmpty: true })).to.equal('');
      });

      it('should remove control characters', () => {
        const stringWithControlChars = 'hello\x00\x01\x02world';
        const sanitized = Sanitizer.sanitizeString(stringWithControlChars, { removeControlChars: true });
        expect(sanitized).to.equal('helloworld');
      });

      it('should validate string type', () => {
        expect(() => Sanitizer.sanitizeString(123))
          .to.throw(ValidationError, 'Value must be a string');
        
        expect(() => Sanitizer.sanitizeString(null))
          .to.throw(ValidationError, 'Value must be a string');
      });
    });

    describe('sanitizePath', () => {
      it('should sanitize safe file paths', () => {
        const safePath = 'projects/test-project/file.txt';
        expect(Sanitizer.sanitizePath(safePath)).to.equal(safePath);
      });

      it('should reject directory traversal attempts', () => {
        const maliciousPaths = [
          '../../../etc/passwd',
          'projects/../../../sensitive/file',
          '..\\..\\windows\\system32',
          'normal/path/../../dangerous'
        ];

        for (const maliciousPath of maliciousPaths) {
          expect(() => Sanitizer.sanitizePath(maliciousPath, { allowTraversal: false }))
            .to.throw(ValidationError, 'Directory traversal not allowed');
        }
      });

      it('should reject absolute paths when not allowed', () => {
        const absolutePaths = [
          '/etc/passwd',
          'C:\\Windows\\System32',
          '/home/user/file.txt'
        ];

        for (const absolutePath of absolutePaths) {
          expect(() => Sanitizer.sanitizePath(absolutePath, { allowAbsolute: false }))
            .to.throw(ValidationError, 'Absolute paths not allowed');
        }
      });

      it('should validate against dangerous patterns', () => {
        const dangerousPaths = [
          'file\x00.txt',
          'file<script>.txt',
          'file|pipe.txt',
          'file?.txt'
        ];

        for (const dangerousPath of dangerousPaths) {
          expect(() => Sanitizer.sanitizePath(dangerousPath))
            .to.throw(ValidationError, 'Path contains dangerous characters');
        }
      });

      it('should enforce maximum path length', () => {
        const longPath = `${'a'.repeat(2000)  }/file.txt`;
        expect(() => Sanitizer.sanitizePath(longPath))
          .to.throw(ValidationError, 'Path too long');
      });

      it('should validate against base path when provided', () => {
        const basePath = '/safe/directory';
        const validPath = 'subdirectory/file.txt';
        const invalidPath = '../outside/file.txt';

        expect(Sanitizer.sanitizePath(validPath, { basePath })).to.equal(validPath);
        
        expect(() => Sanitizer.sanitizePath(invalidPath, { basePath }))
          .to.throw(ValidationError, 'Path outside allowed directory');
      });
    });

    describe('sanitizeFilename', () => {
      it('should sanitize safe filenames', () => {
        const safeFilenames = [
          'document.txt',
          'my-file_v2.json',
          'data.2023.csv',
          'skill.guidance'
        ];

        for (const filename of safeFilenames) {
          expect(Sanitizer.sanitizeFilename(filename)).to.equal(filename);
        }
      });

      it('should reject unsafe filename characters', () => {
        const unsafeFilenames = [
          'file<script>.txt',
          'file|pipe.txt',
          'file?.txt',
          'file*.txt',
          'file".txt'
        ];

        for (const filename of unsafeFilenames) {
          expect(() => Sanitizer.sanitizeFilename(filename))
            .to.throw(ValidationError, 'Filename contains invalid characters');
        }
      });

      it('should validate file extensions', () => {
        const allowedExtensions = ['.txt', '.json', '.js'];
        
        expect(Sanitizer.sanitizeFilename('file.txt', { allowedExtensions })).to.equal('file.txt');
        expect(Sanitizer.sanitizeFilename('file.json', { allowedExtensions })).to.equal('file.json');
        
        expect(() => Sanitizer.sanitizeFilename('file.exe', { allowedExtensions }))
          .to.throw(ValidationError, 'File extension not allowed');
      });

      it('should enforce maximum filename length', () => {
        const longFilename = `${'a'.repeat(300)  }.txt`;
        expect(() => Sanitizer.sanitizeFilename(longFilename))
          .to.throw(ValidationError, 'String too long');
      });
    });

    describe('sanitizeApiKey', () => {
      it('should sanitize valid API keys', () => {
        const validApiKeys = [
          'abcdef123456789',
          'API_KEY_WITH_UNDERSCORES',
          'api-key-with-dashes',
          'MixedCase123ApiKey'
        ];

        for (const apiKey of validApiKeys) {
          expect(Sanitizer.sanitizeApiKey(apiKey)).to.equal(apiKey);
        }
      });

      it('should reject invalid API key formats', () => {
        const invalidApiKeys = [
          'short',
          'key with spaces',
          'key@with!symbols',
          'key\nwith\nnewlines'
        ];

        for (const apiKey of invalidApiKeys) {
          expect(() => Sanitizer.sanitizeApiKey(apiKey))
            .to.throw(ValidationError, 'Invalid API key format');
        }
      });
    });

    describe('sanitizeUuid', () => {
      it('should sanitize valid UUIDs', () => {
        const validUuids = [
          '123e4567-e89b-12d3-a456-426614174000',
          'F47AC10B-58CC-4372-A567-0E02B2C3D479', // Should convert to lowercase
          '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
        ];

        expect(Sanitizer.sanitizeUuid(validUuids[0])).to.equal(validUuids[0]);
        expect(Sanitizer.sanitizeUuid(validUuids[1])).to.equal(validUuids[1].toLowerCase());
        expect(Sanitizer.sanitizeUuid(validUuids[2])).to.equal(validUuids[2]);
      });

      it('should reject invalid UUID formats', () => {
        const invalidUuids = [
          'not-a-uuid',
          '123-456-789',
          '123e4567-e89b-12d3-a456-42661417400', // too short
          '123e4567-e89b-12d3-a456-426614174000-extra', // too long
          '123e4567e89b12d3a456426614174000' // missing dashes
        ];

        for (const uuid of invalidUuids) {
          expect(() => Sanitizer.sanitizeUuid(uuid))
            .to.throw(ValidationError, 'Invalid UUID format');
        }
      });
    });

    describe('sanitizeUrl', () => {
      it('should sanitize valid URLs', () => {
        const validUrls = [
          'https://example.com',
          'http://localhost:3000',
          'https://api.newo.ai/v1/endpoint',
          'https://subdomain.example.org/path?query=value'
        ];

        for (const url of validUrls) {
          expect(Sanitizer.sanitizeUrl(url)).to.equal(url);
        }
      });

      it('should reject invalid URL formats', () => {
        const invalidUrls = [
          'not-a-url',
          'http://',
          'https://',
          'ftp://example.com', // Invalid protocol
          'javascript:alert("xss")'
        ];

        for (const url of invalidUrls) {
          expect(() => Sanitizer.sanitizeUrl(url))
            .to.throw(ValidationError);
        }
      });

      it('should validate allowed protocols', () => {
        const allowedProtocols = ['https:'];
        
        expect(Sanitizer.sanitizeUrl('https://example.com', { allowedProtocols }))
          .to.equal('https://example.com');
        
        expect(() => Sanitizer.sanitizeUrl('http://example.com', { allowedProtocols }))
          .to.throw(ValidationError, 'Protocol not allowed');
      });

      it('should validate allowed hosts', () => {
        const allowedHosts = ['api.newo.ai', 'localhost'];
        
        expect(Sanitizer.sanitizeUrl('https://api.newo.ai/endpoint', { allowedHosts }))
          .to.equal('https://api.newo.ai/endpoint');
        
        expect(() => Sanitizer.sanitizeUrl('https://malicious.com', { allowedHosts }))
          .to.throw(ValidationError, 'Host not allowed');
      });
    });
  });

  describe('Validator Class', () => {
    describe('validate', () => {
      it('should validate string types', () => {
        const schema = { type: VALIDATION_TYPES.STRING, required: true };
        
        expect(Validator.validate('hello', schema)).to.equal('hello');
        expect(() => Validator.validate(123, schema))
          .to.throw(ValidationError, 'must be a string');
      });

      it('should validate number types', () => {
        const schema = { type: VALIDATION_TYPES.NUMBER, min: 0, max: 100 };
        
        expect(Validator.validate(50, schema)).to.equal(50);
        expect(Validator.validate('75', schema)).to.equal(75);
        
        expect(() => Validator.validate(-10, schema))
          .to.throw(ValidationError, 'too small');
        
        expect(() => Validator.validate(150, schema))
          .to.throw(ValidationError, 'too large');
        
        expect(() => Validator.validate('not-a-number', schema))
          .to.throw(ValidationError, 'must be a number');
      });

      it('should validate boolean types', () => {
        const schema = { type: VALIDATION_TYPES.BOOLEAN };
        
        expect(Validator.validate(true, schema)).to.equal(true);
        expect(Validator.validate(false, schema)).to.equal(false);
        expect(Validator.validate('true', schema)).to.equal(true);
        expect(Validator.validate('false', schema)).to.equal(false);
        
        expect(() => Validator.validate('maybe', schema))
          .to.throw(ValidationError, 'must be a boolean');
      });

      it('should validate UUID types', () => {
        const schema = { type: VALIDATION_TYPES.UUID };
        const validUuid = '123e4567-e89b-12d3-a456-426614174000';
        
        expect(Validator.validate(validUuid, schema)).to.equal(validUuid);
        
        expect(() => Validator.validate('not-a-uuid', schema))
          .to.throw(ValidationError, 'Invalid UUID format');
      });

      it('should validate enum types', () => {
        const schema = { 
          type: VALIDATION_TYPES.ENUM, 
          enum: ['option1', 'option2', 'option3'] 
        };
        
        expect(Validator.validate('option2', schema)).to.equal('option2');
        
        expect(() => Validator.validate('invalid-option', schema))
          .to.throw(ValidationError, 'must be one of');
      });

      it('should handle required fields', () => {
        const schema = { type: VALIDATION_TYPES.STRING, required: true };
        
        expect(() => Validator.validate(null, schema))
          .to.throw(ValidationError, 'is required');
        
        expect(() => Validator.validate(undefined, schema))
          .to.throw(ValidationError, 'is required');
      });

      it('should use default values', () => {
        const schema = { 
          type: VALIDATION_TYPES.STRING, 
          required: false, 
          default: 'default-value' 
        };
        
        expect(Validator.validate(null, schema)).to.equal('default-value');
        expect(Validator.validate(undefined, schema)).to.equal('default-value');
        expect(Validator.validate('custom-value', schema)).to.equal('custom-value');
      });

      it('should validate patterns', () => {
        const schema = { 
          type: VALIDATION_TYPES.STRING, 
          pattern: /^[a-zA-Z0-9_-]+$/ 
        };
        
        expect(Validator.validate('valid_name-123', schema)).to.equal('valid_name-123');
        
        expect(() => Validator.validate('invalid name!', schema))
          .to.throw(ValidationError, 'format is invalid');
      });

      it('should apply custom validation functions', () => {
        const schema = { 
          type: VALIDATION_TYPES.STRING,
          custom: (value) => value.length >= 5 || 'Must be at least 5 characters'
        };
        
        expect(Validator.validate('hello', schema)).to.equal('hello');
        
        expect(() => Validator.validate('hi', schema))
          .to.throw(ValidationError, 'Must be at least 5 characters');
      });

      it('should handle sanitization option', () => {
        const schema = { 
          type: VALIDATION_TYPES.STRING, 
          sanitize: true 
        };
        
        expect(Validator.validate('  hello  ', schema)).to.equal('hello');
        
        const noSanitizeSchema = { 
          type: VALIDATION_TYPES.STRING, 
          sanitize: false 
        };
        
        expect(Validator.validate('  hello  ', noSanitizeSchema)).to.equal('  hello  ');
      });
    });

    describe('validateObject', () => {
      it('should validate complete objects', () => {
        const schema = {
          name: { type: VALIDATION_TYPES.STRING, required: true },
          age: { type: VALIDATION_TYPES.NUMBER, min: 0, max: 150 },
          email: { type: VALIDATION_TYPES.STRING, pattern: PATTERNS.EMAIL },
          active: { type: VALIDATION_TYPES.BOOLEAN, default: false }
        };
        
        const data = {
          name: 'John Doe',
          age: 30,
          email: 'john@example.com'
        };
        
        const validated = Validator.validateObject(data, schema);
        
        expect(validated.name).to.equal('John Doe');
        expect(validated.age).to.equal(30);
        expect(validated.email).to.equal('john@example.com');
        expect(validated.active).to.equal(false); // default value
      });

      it('should validate CLI arguments', () => {
        const args = {
          _: ['pull'],
          verbose: 'true',
          v: false
        };
        
        const validated = Validator.validateCliArgs(args);
        
        expect(validated._).to.equal('pull');
        expect(validated.verbose).to.equal(true);
        expect(validated.v).to.equal(false);
      });

      it('should validate project identifiers', () => {
        const identifiers = {
          projectId: '123e4567-e89b-12d3-a456-426614174000',
          projectIdn: 'test-project',
          agentIdn: 'test_agent',
          flowIdn: 'test-flow-123'
        };
        
        const validated = Validator.validateIdentifiers(identifiers);
        
        expect(validated.projectId).to.equal(identifiers.projectId);
        expect(validated.projectIdn).to.equal(identifiers.projectIdn);
        expect(validated.agentIdn).to.equal(identifiers.agentIdn);
        expect(validated.flowIdn).to.equal(identifiers.flowIdn);
      });
    });
  });

  describe('Validation Patterns', () => {
    it('should validate UUID pattern', () => {
      const validUuids = [
        '123e4567-e89b-12d3-a456-426614174000',
        'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
      ];
      
      const invalidUuids = [
        'not-a-uuid',
        '123-456-789',
        '123e4567-e89b-12d3-a456-42661417400',
        'x23e4567-e89b-12d3-a456-426614174000'
      ];
      
      for (const uuid of validUuids) {
        expect(PATTERNS.UUID.test(uuid)).to.be.true;
      }
      
      for (const uuid of invalidUuids) {
        expect(PATTERNS.UUID.test(uuid)).to.be.false;
      }
    });

    it('should validate email pattern', () => {
      const validEmails = [
        'test@example.com',
        'user.name+tag@domain.co.uk',
        'valid.email@subdomain.example.org'
      ];
      
      const invalidEmails = [
        'not-an-email',
        '@example.com',
        'test@',
        'test..test@example.com'
      ];
      
      for (const email of validEmails) {
        expect(PATTERNS.EMAIL.test(email)).to.be.true;
      }
      
      for (const email of invalidEmails) {
        expect(PATTERNS.EMAIL.test(email)).to.be.false;
      }
    });

    it('should validate API key pattern', () => {
      const validApiKeys = [
        'abcdef1234567890',
        'API_KEY_WITH_UNDERSCORES',
        'api-key-with-dashes'
      ];
      
      const invalidApiKeys = [
        'short',
        'key with spaces',
        'key@with!symbols'
      ];
      
      for (const apiKey of validApiKeys) {
        expect(PATTERNS.API_KEY.test(apiKey)).to.be.true;
      }
      
      for (const apiKey of invalidApiKeys) {
        expect(PATTERNS.API_KEY.test(apiKey)).to.be.false;
      }
    });

    it('should validate identifier patterns', () => {
      const validIdentifiers = [
        'test-project',
        'test_agent',
        'flow123',
        'skill-name_v2'
      ];
      
      const invalidIdentifiers = [
        'invalid space',
        'invalid@symbol',
        'invalid.dot',
        ''
      ];
      
      const patterns = [
        PATTERNS.PROJECT_IDN,
        PATTERNS.AGENT_IDN,
        PATTERNS.FLOW_IDN,
        PATTERNS.SKILL_IDN
      ];
      
      for (const pattern of patterns) {
        for (const identifier of validIdentifiers) {
          expect(pattern.test(identifier)).to.be.true;
        }
        
        for (const identifier of invalidIdentifiers) {
          expect(pattern.test(identifier)).to.be.false;
        }
      }
    });
  });

  describe('Security Constants', () => {
    it('should have appropriate security limits', () => {
      expect(SECURITY.MAX_STRING_LENGTH).to.equal(10000);
      expect(SECURITY.MAX_PATH_LENGTH).to.equal(1000);
      expect(SECURITY.ALLOWED_FILE_EXTENSIONS).to.include('.guidance');
      expect(SECURITY.ALLOWED_FILE_EXTENSIONS).to.include('.jinja');
      expect(SECURITY.DANGEROUS_COMMANDS).to.include('rm');
      expect(SECURITY.DANGEROUS_COMMANDS).to.include('format');
    });

    it('should have dangerous path patterns', () => {
      expect(SECURITY.DANGEROUS_PATH_PATTERNS).to.be.an('array');
      expect(SECURITY.DANGEROUS_PATH_PATTERNS.length).to.be.greaterThan(0);
      
      // Test that patterns catch dangerous paths
      const dangerousPath = '../../../etc/passwd';
      const caught = SECURITY.DANGEROUS_PATH_PATTERNS.some(pattern => pattern.test(dangerousPath));
      expect(caught).to.be.true;
    });
  });

  describe('Predefined Schemas', () => {
    it('should have valid CLI arguments schema', () => {
      expect(SCHEMAS.CLI_ARGS).to.have.property('_');
      expect(SCHEMAS.CLI_ARGS).to.have.property('verbose');
      expect(SCHEMAS.CLI_ARGS.verbose.type).to.equal(VALIDATION_TYPES.BOOLEAN);
      expect(SCHEMAS.CLI_ARGS.verbose.default).to.equal(false);
    });

    it('should have valid project configuration schema', () => {
      expect(SCHEMAS.PROJECT_CONFIG).to.have.property('id');
      expect(SCHEMAS.PROJECT_CONFIG).to.have.property('idn');
      expect(SCHEMAS.PROJECT_CONFIG).to.have.property('title');
      expect(SCHEMAS.PROJECT_CONFIG.id.type).to.equal(VALIDATION_TYPES.UUID);
      expect(SCHEMAS.PROJECT_CONFIG.id.required).to.be.true;
    });

    it('should have valid API credentials schema', () => {
      expect(SCHEMAS.API_CREDENTIALS).to.have.property('apiKey');
      expect(SCHEMAS.API_CREDENTIALS).to.have.property('accessToken');
      expect(SCHEMAS.API_CREDENTIALS).to.have.property('refreshToken');
      expect(SCHEMAS.API_CREDENTIALS.apiKey.type).to.equal(VALIDATION_TYPES.API_KEY);
    });

    it('should have valid file operation schema', () => {
      expect(SCHEMAS.FILE_OPERATION).to.have.property('filePath');
      expect(SCHEMAS.FILE_OPERATION).to.have.property('operation');
      expect(SCHEMAS.FILE_OPERATION.filePath.type).to.equal(VALIDATION_TYPES.SAFE_PATH);
      expect(SCHEMAS.FILE_OPERATION.operation.type).to.equal(VALIDATION_TYPES.ENUM);
    });
  });
});