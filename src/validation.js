import path from 'path';
import { ValidationError } from './errors.js';

/**
 * Validation schema types
 */
const VALIDATION_TYPES = {
  STRING: 'string',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  UUID: 'uuid',
  URL: 'url',
  EMAIL: 'email',
  FILE_PATH: 'file_path',
  SAFE_PATH: 'safe_path',
  API_KEY: 'api_key',
  ENUM: 'enum'
};

/**
 * Common validation patterns
 */
const PATTERNS = {
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  EMAIL: /^[a-zA-Z0-9][a-zA-Z0-9._+-]*[a-zA-Z0-9]@[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]\.[a-zA-Z]{2,}$/,
  API_KEY: /^[a-zA-Z0-9_-]{10,}$/,
  SAFE_FILENAME: /^[a-zA-Z0-9._-]+$/,
  PROJECT_IDN: /^[a-zA-Z0-9_-]+$/,
  AGENT_IDN: /^[a-zA-Z0-9_-]+$/,
  FLOW_IDN: /^[a-zA-Z0-9_-]+$/,
  SKILL_IDN: /^[a-zA-Z0-9_-]+$/
};

/**
 * Security-related constants
 */
const SECURITY = {
  MAX_STRING_LENGTH: 10000,
  MAX_PATH_LENGTH: 1000,
  DANGEROUS_PATH_PATTERNS: [
    /\.\./,           // Directory traversal
    /^\/[^\/]/,       // Absolute paths starting with /
    /^[a-zA-Z]:\\/,   // Windows absolute paths
    /\0/,             // Null bytes
    /[<>:"|?*]/       // Windows invalid characters
  ],
  ALLOWED_FILE_EXTENSIONS: ['.guidance', '.jinja', '.json', '.yaml', '.yml', '.md', '.txt'],
  DANGEROUS_COMMANDS: ['rm', 'del', 'format', 'fdisk', 'mkfs', 'dd']
};

/**
 * Sanitization utilities
 */
class Sanitizer {
  /**
   * Sanitize string input
   */
  static sanitizeString(value, options = {}) {
    if (typeof value !== 'string') {
      throw new ValidationError('Value must be a string', null, value);
    }

    const {
      maxLength = SECURITY.MAX_STRING_LENGTH,
      allowEmpty = false,
      trim = true,
      removeControlChars = true
    } = options;

    // Ensure maxLength is valid
    const validMaxLength = maxLength && maxLength > 0 ? maxLength : SECURITY.MAX_STRING_LENGTH;

    let sanitized = value;

    // Trim whitespace
    if (trim) {
      sanitized = sanitized.trim();
    }

    // Check empty
    if (!allowEmpty && sanitized.length === 0) {
      throw new ValidationError('String cannot be empty');
    }

    // Check length
    if (sanitized.length > validMaxLength) {
      throw new ValidationError(`String too long (max ${validMaxLength} characters)`, null, sanitized.length);
    }

    // Remove control characters
    if (removeControlChars) {
      sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    }

    return sanitized;
  }

  /**
   * Sanitize file path
   */
  static sanitizePath(filePath, options = {}) {
    if (typeof filePath !== 'string') {
      throw new ValidationError('File path must be a string', null, filePath);
    }

    const {
      allowAbsolute = false,
      allowTraversal = false,
      maxLength = SECURITY.MAX_PATH_LENGTH,
      basePath = null
    } = options;

    const sanitized = path.normalize(filePath);

    // Check length
    if (sanitized.length > maxLength) {
      throw new ValidationError(`Path too long (max ${maxLength} characters)`, null, sanitized.length);
    }

    // Check for directory traversal first (more specific)
    if (!allowTraversal && sanitized.includes('..')) {
      throw new ValidationError('Directory traversal not allowed', null, sanitized);
    }

    // Check absolute paths
    if (!allowAbsolute && path.isAbsolute(sanitized)) {
      throw new ValidationError('Absolute paths not allowed', null, sanitized);
    }

    // Validate against base path
    if (basePath) {
      const resolvedPath = path.resolve(basePath, sanitized);
      const normalizedBase = path.resolve(basePath);
      
      if (!resolvedPath.startsWith(normalizedBase)) {
        throw new ValidationError('Path outside allowed directory', null, sanitized);
      }
    }

    // Check for dangerous patterns (most generic check last)
    for (const pattern of SECURITY.DANGEROUS_PATH_PATTERNS) {
      if (pattern.test(sanitized)) {
        throw new ValidationError('Path contains dangerous characters or patterns', null, sanitized);
      }
    }

    return sanitized;
  }

  /**
   * Sanitize filename
   */
  static sanitizeFilename(filename, options = {}) {
    const {
      allowedExtensions = null, // By default, don't restrict extensions
      maxLength = 255
    } = options;

    const sanitized = this.sanitizeString(filename, { maxLength, trim: true });

    // Check for safe filename pattern
    if (!PATTERNS.SAFE_FILENAME.test(sanitized)) {
      throw new ValidationError('Filename contains invalid characters', null, sanitized);
    }

    // Check extension if provided
    if (allowedExtensions && allowedExtensions.length > 0) {
      const ext = path.extname(sanitized).toLowerCase();
      if (ext && !allowedExtensions.includes(ext)) {
        throw new ValidationError(`File extension not allowed. Allowed: ${allowedExtensions.join(', ')}`, null, ext);
      }
    }

    return sanitized;
  }

  /**
   * Sanitize API key
   */
  static sanitizeApiKey(apiKey) {
    const sanitized = this.sanitizeString(apiKey, { trim: true, allowEmpty: false });

    if (!PATTERNS.API_KEY.test(sanitized)) {
      throw new ValidationError('Invalid API key format', null, '[REDACTED]');
    }

    return sanitized;
  }

  /**
   * Sanitize UUID
   */
  static sanitizeUuid(uuid) {
    const sanitized = this.sanitizeString(uuid, { trim: true, allowEmpty: false });

    if (!PATTERNS.UUID.test(sanitized)) {
      throw new ValidationError('Invalid UUID format', null, sanitized);
    }

    return sanitized.toLowerCase();
  }

  /**
   * Sanitize URL
   */
  static sanitizeUrl(url, options = {}) {
    const {
      allowedProtocols = ['http:', 'https:'],
      allowedHosts = null
    } = options;

    const sanitized = this.sanitizeString(url, { trim: true, allowEmpty: false });

    let parsed;
    try {
      parsed = new URL(sanitized);
    } catch (error) {
      throw new ValidationError('Invalid URL format', null, sanitized);
    }

    // Check protocol
    if (!allowedProtocols.includes(parsed.protocol)) {
      throw new ValidationError(`Protocol not allowed. Allowed: ${allowedProtocols.join(', ')}`, null, parsed.protocol);
    }

    // Check host if specified
    if (allowedHosts && !allowedHosts.includes(parsed.hostname)) {
      throw new ValidationError(`Host not allowed. Allowed: ${allowedHosts.join(', ')}`, null, parsed.hostname);
    }

    return sanitized;
  }
}

/**
 * Validator class for complex validation schemas
 */
class Validator {
  /**
   * Validate value against schema
   */
  static validate(value, schema, fieldName = 'value') {
    const {
      type,
      required = false,
      default: defaultValue = undefined,
      min = null,
      max = null,
      pattern = null,
      enum: enumValues = null,
      custom = null,
      sanitize = true
    } = schema;

    // Handle null/undefined
    if (value === null || value === undefined) {
      if (required) {
        throw new ValidationError(`${fieldName} is required`);
      }
      return defaultValue;
    }

    // Type-specific validation and sanitization
    let validatedValue = value;

    switch (type) {
    case VALIDATION_TYPES.STRING:
      // Handle special case for CLI arguments where _ might be an array
      if (fieldName === '_' && Array.isArray(value)) {
        validatedValue = value.length > 0 ? value[0] : '';
      } else {
        validatedValue = sanitize 
          ? Sanitizer.sanitizeString(value, { maxLength: max, allowEmpty: !required })
          : String(value);
      }
        
      if (min && validatedValue.length < min) {
        throw new ValidationError(`${fieldName} too short (min ${min} characters)`, fieldName, validatedValue.length);
      }
      break;

    case VALIDATION_TYPES.NUMBER:
      validatedValue = typeof value === 'number' ? value : Number(value);
        
      if (isNaN(validatedValue)) {
        throw new ValidationError(`${fieldName} must be a number`, fieldName, value);
      }
        
      if (min !== null && validatedValue < min) {
        throw new ValidationError(`${fieldName} too small (min ${min})`, fieldName, validatedValue);
      }
        
      if (max !== null && validatedValue > max) {
        throw new ValidationError(`${fieldName} too large (max ${max})`, fieldName, validatedValue);
      }
      break;

    case VALIDATION_TYPES.BOOLEAN:
      if (typeof value === 'boolean') {
        validatedValue = value;
      } else if (typeof value === 'string') {
        if (value.toLowerCase() === 'true') validatedValue = true;
        else if (value.toLowerCase() === 'false') validatedValue = false;
        else throw new ValidationError(`${fieldName} must be a boolean`, fieldName, value);
      } else {
        throw new ValidationError(`${fieldName} must be a boolean`, fieldName, value);
      }
      break;

    case VALIDATION_TYPES.UUID:
      validatedValue = sanitize ? Sanitizer.sanitizeUuid(value) : value;
      break;

    case VALIDATION_TYPES.URL:
      validatedValue = sanitize ? Sanitizer.sanitizeUrl(value) : value;
      break;

    case VALIDATION_TYPES.FILE_PATH:
      validatedValue = sanitize ? Sanitizer.sanitizePath(value, { allowAbsolute: true }) : value;
      break;

    case VALIDATION_TYPES.SAFE_PATH:
      validatedValue = sanitize ? Sanitizer.sanitizePath(value, { allowAbsolute: false, allowTraversal: false }) : value;
      break;

    case VALIDATION_TYPES.API_KEY:
      validatedValue = sanitize ? Sanitizer.sanitizeApiKey(value) : value;
      break;

    case VALIDATION_TYPES.ENUM:
      if (!enumValues || !enumValues.includes(value)) {
        throw new ValidationError(`${fieldName} must be one of: ${enumValues ? enumValues.join(', ') : 'undefined'}`, fieldName, value);
      }
      validatedValue = value;
      break;

    default:
      throw new ValidationError(`Unknown validation type: ${type}`, fieldName, type);
    }

    // Pattern validation
    if (pattern && !pattern.test(validatedValue)) {
      throw new ValidationError(`${fieldName} format is invalid`, fieldName, validatedValue);
    }

    // Enum validation
    if (enumValues && !enumValues.includes(validatedValue)) {
      throw new ValidationError(`${fieldName} must be one of: ${enumValues.join(', ')}`, fieldName, validatedValue);
    }

    // Custom validation
    if (custom && typeof custom === 'function') {
      const customResult = custom(validatedValue);
      if (customResult !== true) {
        const message = typeof customResult === 'string' ? customResult : `${fieldName} custom validation failed`;
        throw new ValidationError(message, fieldName, validatedValue);
      }
    }

    return validatedValue;
  }

  /**
   * Validate object against schema
   */
  static validateObject(obj, schema) {
    const validated = {};

    for (const [key, fieldSchema] of Object.entries(schema)) {
      validated[key] = this.validate(obj[key], fieldSchema, key);
    }

    return validated;
  }

  /**
   * Validate command line arguments
   */
  static validateCliArgs(args) {
    const schema = {
      _: {
        type: VALIDATION_TYPES.STRING,
        required: false,
        custom: (commands) => {
          const validCommands = ['pull', 'push', 'status', 'meta', 'import-akb', 'help'];
          if (Array.isArray(commands) && commands.length > 0) {
            const cmd = commands[0];
            return validCommands.includes(cmd) || `Unknown command: ${cmd}. Valid commands: ${validCommands.join(', ')}`;
          }
          return true;
        }
      },
      verbose: {
        type: VALIDATION_TYPES.BOOLEAN,
        required: false,
        default: false
      },
      v: {
        type: VALIDATION_TYPES.BOOLEAN,
        required: false,
        default: false
      }
    };

    return this.validateObject(args, schema);
  }

  /**
   * Validate project/agent/flow identifiers
   */
  static validateIdentifiers(obj) {
    const schema = {
      projectId: {
        type: VALIDATION_TYPES.UUID,
        required: false
      },
      projectIdn: {
        type: VALIDATION_TYPES.STRING,
        pattern: PATTERNS.PROJECT_IDN,
        required: false
      },
      agentIdn: {
        type: VALIDATION_TYPES.STRING,
        pattern: PATTERNS.AGENT_IDN,
        required: false
      },
      flowIdn: {
        type: VALIDATION_TYPES.STRING,
        pattern: PATTERNS.FLOW_IDN,
        required: false
      },
      skillIdn: {
        type: VALIDATION_TYPES.STRING,
        pattern: PATTERNS.SKILL_IDN,
        required: false
      }
    };

    return this.validateObject(obj, schema);
  }
}

/**
 * Pre-defined validation schemas for common use cases
 */
const SCHEMAS = {
  CLI_ARGS: {
    _: {
      type: VALIDATION_TYPES.STRING,
      required: false
    },
    verbose: {
      type: VALIDATION_TYPES.BOOLEAN,
      required: false,
      default: false
    }
  },

  PROJECT_CONFIG: {
    id: {
      type: VALIDATION_TYPES.UUID,
      required: true
    },
    idn: {
      type: VALIDATION_TYPES.STRING,
      pattern: PATTERNS.PROJECT_IDN,
      required: true
    },
    title: {
      type: VALIDATION_TYPES.STRING,
      required: true,
      min: 1,
      max: 200
    }
  },

  API_CREDENTIALS: {
    apiKey: {
      type: VALIDATION_TYPES.API_KEY,
      required: false
    },
    accessToken: {
      type: VALIDATION_TYPES.STRING,
      required: false,
      min: 10
    },
    refreshToken: {
      type: VALIDATION_TYPES.STRING,
      required: false,
      min: 10
    }
  },

  FILE_OPERATION: {
    filePath: {
      type: VALIDATION_TYPES.SAFE_PATH,
      required: true
    },
    operation: {
      type: VALIDATION_TYPES.ENUM,
      enum: ['read', 'write', 'delete', 'move', 'copy'],
      required: true
    }
  }
};

export {
  VALIDATION_TYPES,
  PATTERNS,
  SECURITY,
  Sanitizer,
  Validator,
  SCHEMAS
};