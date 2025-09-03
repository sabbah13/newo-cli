import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { getDirectories } from './config.js';
import { NewoError, RateLimitError } from './errors.js';
import { Sanitizer } from './validation.js';

/**
 * Security-specific error class
 */
class SecurityError extends NewoError {
  constructor(message, details = {}) {
    super(message, 'SECURITY_ERROR', null, details);
  }

  getUserMessage() {
    return 'Security validation failed. Please check your input and try again.';
  }
}

/**
 * Encryption utilities for secure token storage
 */
class EncryptionService {
  constructor() {
    this.algorithm = 'aes-256-cbc';
    this.keyLength = 32;
    this.ivLength = 16;
    this.tagLength = 16;
    this.saltLength = 32;
  }

  /**
   * Generate a secure key from password and salt
   */
  _deriveKey(password, salt) {
    return crypto.pbkdf2Sync(password, salt, 100000, this.keyLength, 'sha256');
  }

  /**
   * Get machine-specific key for token encryption
   */
  _getMachineKey() {
    const machineId = os.hostname() + os.userInfo().username + os.platform();
    return crypto.createHash('sha256').update(machineId).digest();
  }

  /**
   * Encrypt sensitive data
   */
  encrypt(data, customKey = null) {
    try {
      const key = customKey || this._getMachineKey();
      const iv = crypto.randomBytes(this.ivLength);
      const salt = crypto.randomBytes(this.saltLength);
      const derivedKey = this._deriveKey(key, salt);
      
      const cipher = crypto.createCipheriv(this.algorithm, derivedKey, iv);
      
      let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      return {
        encrypted,
        iv: iv.toString('hex'),
        salt: salt.toString('hex'),
        algorithm: this.algorithm
      };
    } catch (error) {
      throw new SecurityError('Encryption failed', { originalError: error.message });
    }
  }

  /**
   * Decrypt sensitive data
   */
  decrypt(encryptedData, customKey = null) {
    try {
      const { encrypted, iv, salt, algorithm } = encryptedData;
      
      if (algorithm !== this.algorithm) {
        throw new SecurityError('Algorithm mismatch in encrypted data');
      }
      
      const key = customKey || this._getMachineKey();
      const derivedKey = this._deriveKey(key, Buffer.from(salt, 'hex'));
      const ivBuffer = Buffer.from(iv, 'hex');
      
      const decipher = crypto.createDecipheriv(this.algorithm, derivedKey, ivBuffer);
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return JSON.parse(decrypted);
    } catch (error) {
      throw new SecurityError('Decryption failed', { originalError: error.message });
    }
  }
}

/**
 * Secure token storage with encryption
 */
class SecureTokenStorage {
  constructor() {
    this.encryption = new EncryptionService();
    this.tokenFile = null;
    this._initPromise = this._initialize();
  }

  async _initialize() {
    const dirs = await getDirectories();
    this.tokenFile = path.join(dirs.state, 'tokens.secure');
  }

  async _ensureInitialized() {
    if (this._initPromise) {
      await this._initPromise;
      this._initPromise = null;
    }
  }

  /**
   * Save tokens securely
   */
  async saveTokens(tokens) {
    await this._ensureInitialized();
    
    try {
      // Add metadata
      const tokenData = {
        tokens,
        savedAt: Date.now(),
        version: '1.0'
      };
      
      const encrypted = this.encryption.encrypt(tokenData);
      await fs.writeJson(this.tokenFile, encrypted, { spaces: 2 });
      
      // Set restrictive permissions
      await fs.chmod(this.tokenFile, 0o600);
      
    } catch (error) {
      throw new SecurityError('Failed to save secure tokens', { originalError: error.message });
    }
  }

  /**
   * Load tokens securely
   */
  async loadTokens() {
    await this._ensureInitialized();
    
    try {
      if (!(await fs.pathExists(this.tokenFile))) {
        return null;
      }
      
      const encrypted = await fs.readJson(this.tokenFile);
      const decrypted = this.encryption.decrypt(encrypted);
      
      // Validate token structure
      if (!decrypted.tokens || !decrypted.savedAt) {
        throw new SecurityError('Invalid token file structure');
      }
      
      return decrypted.tokens;
    } catch (error) {
      if (error instanceof SecurityError) {
        throw error;
      }
      throw new SecurityError('Failed to load secure tokens', { originalError: error.message });
    }
  }

  /**
   * Clear stored tokens
   */
  async clearTokens() {
    await this._ensureInitialized();
    
    try {
      if (await fs.pathExists(this.tokenFile)) {
        await fs.remove(this.tokenFile);
      }
    } catch (error) {
      throw new SecurityError('Failed to clear tokens', { originalError: error.message });
    }
  }

  /**
   * Check if tokens exist
   */
  async hasTokens() {
    await this._ensureInitialized();
    return fs.pathExists(this.tokenFile);
  }
}

/**
 * Rate limiting for API calls
 */
class RateLimiter {
  constructor(options = {}) {
    this.requests = new Map();
    this.windowMs = options.windowMs || 60000; // 1 minute
    this.maxRequests = options.maxRequests || 100;
    this.cleanupInterval = options.cleanupInterval || 300000; // 5 minutes
    
    // Cleanup old entries periodically
    this.cleanupTimer = setInterval(() => this._cleanup(), this.cleanupInterval);
  }

  /**
   * Check if request is allowed
   */
  isAllowed(identifier = 'default') {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    if (!this.requests.has(identifier)) {
      this.requests.set(identifier, []);
    }
    
    const userRequests = this.requests.get(identifier);
    
    // Remove old requests outside the window
    const validRequests = userRequests.filter(timestamp => timestamp > windowStart);
    this.requests.set(identifier, validRequests);
    
    // Check if under limit
    if (validRequests.length >= this.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: validRequests[0] + this.windowMs,
        retryAfter: Math.ceil((validRequests[0] + this.windowMs - now) / 1000)
      };
    }
    
    // Add current request
    validRequests.push(now);
    
    return {
      allowed: true,
      remaining: this.maxRequests - validRequests.length,
      resetTime: now + this.windowMs,
      retryAfter: 0
    };
  }

  /**
   * Record a request (call after isAllowed returns true)
   */
  recordRequest(identifier = 'default') {
    const result = this.isAllowed(identifier);
    if (!result.allowed) {
      throw new RateLimitError('Rate limit exceeded', result.retryAfter);
    }
    return result;
  }

  /**
   * Cleanup old entries
   */
  _cleanup() {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    for (const [identifier, requests] of this.requests.entries()) {
      const validRequests = requests.filter(timestamp => timestamp > windowStart);
      if (validRequests.length === 0) {
        this.requests.delete(identifier);
      } else {
        this.requests.set(identifier, validRequests);
      }
    }
  }

  /**
   * Get current status for identifier
   */
  getStatus(identifier = 'default') {
    const result = this.isAllowed(identifier);
    return {
      remaining: result.remaining,
      resetTime: new Date(result.resetTime),
      retryAfter: result.retryAfter
    };
  }

  /**
   * Reset rate limit for identifier
   */
  reset(identifier = 'default') {
    this.requests.delete(identifier);
  }

  /**
   * Cleanup and stop rate limiter
   */
  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.requests.clear();
  }
}

/**
 * Secure path operations
 */
class SecurePathValidator {
  constructor(basePath = null) {
    this.basePath = basePath ? path.resolve(basePath) : null;
    this.allowedExtensions = ['.guidance', '.jinja', '.json', '.yaml', '.yml', '.md', '.txt'];
    this.dangerousPatterns = [
      /\.\./,                    // Directory traversal
      /^\/[^\/]/,               // Absolute paths starting with /
      /^[a-zA-Z]:\\/,           // Windows absolute paths
      /\0/,                     // Null bytes
      /[<>:"|?*]/,              // Windows invalid characters
      /^\.newo[\/\\]/,          // Access to .newo directory
      /node_modules[\/\\]/,     // Access to node_modules
      /\.git[\/\\]/,            // Access to .git directory
    ];
  }

  /**
   * Validate and sanitize file path
   */
  validatePath(inputPath, options = {}) {
    const {
      allowAbsolute = false,
      allowTraversal = false,
      requireExtension = false,
      allowedExtensions = this.allowedExtensions
    } = options;

    try {
      // Basic sanitization
      const sanitized = Sanitizer.sanitizePath(inputPath, {
        allowAbsolute,
        allowTraversal,
        basePath: this.basePath
      });

      // Check dangerous patterns
      for (const pattern of this.dangerousPatterns) {
        if (pattern.test(sanitized)) {
          throw new SecurityError(`Path contains dangerous pattern: ${sanitized}`);
        }
      }

      // Resolve path if base path is set
      let resolvedPath = sanitized;
      if (this.basePath && !path.isAbsolute(sanitized)) {
        resolvedPath = path.resolve(this.basePath, sanitized);
        
        // Ensure resolved path is within base path
        if (!resolvedPath.startsWith(this.basePath)) {
          throw new SecurityError(`Path outside allowed directory: ${sanitized}`);
        }
      }

      // Check file extension
      if (requireExtension) {
        const ext = path.extname(resolvedPath).toLowerCase();
        if (!ext) {
          throw new SecurityError(`File must have an extension: ${sanitized}`);
        }
        
        if (allowedExtensions && !allowedExtensions.includes(ext)) {
          throw new SecurityError(`File extension not allowed: ${ext}. Allowed: ${allowedExtensions.join(', ')}`);
        }
      }

      return {
        original: inputPath,
        sanitized,
        resolved: resolvedPath,
        isAbsolute: path.isAbsolute(resolvedPath),
        extension: path.extname(resolvedPath).toLowerCase(),
        directory: path.dirname(resolvedPath),
        filename: path.basename(resolvedPath)
      };

    } catch (error) {
      throw new SecurityError(`Path validation failed: ${error.message}`, { 
        path: inputPath,
        originalError: error.message 
      });
    }
  }

  /**
   * Validate multiple paths
   */
  validatePaths(paths, options = {}) {
    return paths.map(p => this.validatePath(p, options));
  }

  /**
   * Check if path is safe for operations
   */
  isSafePath(inputPath) {
    try {
      this.validatePath(inputPath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Sensitive data protection utilities
 */
class SensitiveDataProtector {
  constructor() {
    this.sensitivePatterns = [
      /[a-zA-Z0-9_-]{20,}/,          // API keys and tokens
      /Bearer\s+[a-zA-Z0-9_-]+/i,   // Bearer tokens
      /password['":\s]*[a-zA-Z0-9_-]+/i, // Passwords
      /api[_-]?key['":\s]*[a-zA-Z0-9_-]+/i, // API keys
      /secret['":\s]*[a-zA-Z0-9_-]+/i, // Secrets
    ];
    this.redactionText = '[REDACTED]';
  }

  /**
   * Redact sensitive information from text
   */
  redact(text) {
    if (typeof text !== 'string') {
      return text;
    }

    let redacted = text;
    for (const pattern of this.sensitivePatterns) {
      redacted = redacted.replace(pattern, this.redactionText);
    }
    
    return redacted;
  }

  /**
   * Redact sensitive information from object
   */
  redactObject(obj, sensitiveKeys = ['password', 'token', 'key', 'secret', 'auth']) {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.redactObject(item, sensitiveKeys));
    }

    const redacted = {};
    for (const [key, value] of Object.entries(obj)) {
      const keyLower = key.toLowerCase();
      const isSensitive = sensitiveKeys.some(sensitiveKey => keyLower.includes(sensitiveKey));
      
      if (isSensitive && typeof value === 'string') {
        redacted[key] = this.redactionText;
      } else if (typeof value === 'object') {
        redacted[key] = this.redactObject(value, sensitiveKeys);
      } else {
        redacted[key] = value;
      }
    }
    
    return redacted;
  }

  /**
   * Safely log object by redacting sensitive data
   */
  safeLog(obj) {
    return this.redactObject(obj);
  }

  /**
   * Clear sensitive data from memory (best effort)
   */
  clearFromMemory(obj) {
    if (typeof obj === 'object' && obj !== null) {
      for (const key of Object.keys(obj)) {
        if (typeof obj[key] === 'string') {
          // Overwrite string with random data
          obj[key] = crypto.randomBytes(obj[key].length).toString('hex');
        }
        delete obj[key];
      }
    }
  }
}

/**
 * Security audit utilities
 */
class SecurityAuditor {
  constructor() {
    this.violations = [];
  }

  /**
   * Audit file permissions
   */
  async auditFilePermissions(filePath) {
    try {
      const stats = await fs.stat(filePath);
      const mode = stats.mode & parseInt('777', 8);
      
      // Check for overly permissive permissions
      if (mode & parseInt('077', 8)) {
        this.violations.push({
          type: 'file_permissions',
          path: filePath,
          issue: 'File is readable by group or others',
          severity: 'medium',
          mode: mode.toString(8)
        });
      }
      
      return mode;
    } catch (error) {
      this.violations.push({
        type: 'file_access',
        path: filePath,
        issue: 'Cannot access file for permission audit',
        severity: 'low',
        error: error.message
      });
    }
  }

  /**
   * Audit directory structure
   */
  async auditDirectoryStructure(basePath) {
    const dirs = getDirectories();
    
    for (const [name, dirPath] of Object.entries(dirs)) {
      try {
        const exists = await fs.pathExists(dirPath);
        if (!exists) {
          this.violations.push({
            type: 'directory_missing',
            path: dirPath,
            issue: `Required directory ${name} does not exist`,
            severity: 'medium'
          });
          continue;
        }
        
        await this.auditFilePermissions(dirPath);
      } catch (error) {
        this.violations.push({
          type: 'directory_audit',
          path: dirPath,
          issue: `Failed to audit directory ${name}`,
          severity: 'low',
          error: error.message
        });
      }
    }
  }

  /**
   * Get audit report
   */
  getReport() {
    const report = {
      timestamp: new Date().toISOString(),
      totalViolations: this.violations.length,
      severityBreakdown: {
        high: this.violations.filter(v => v.severity === 'high').length,
        medium: this.violations.filter(v => v.severity === 'medium').length,
        low: this.violations.filter(v => v.severity === 'low').length
      },
      violations: this.violations
    };
    
    return report;
  }

  /**
   * Clear audit results
   */
  clearResults() {
    this.violations = [];
  }
}

// Create default instances
const secureTokenStorage = new SecureTokenStorage();
const rateLimiter = new RateLimiter();
const sensitiveDataProtector = new SensitiveDataProtector();
const securityAuditor = new SecurityAuditor();

export {
  EncryptionService,
  SecureTokenStorage,
  RateLimiter,
  SecurePathValidator,
  SensitiveDataProtector,
  SecurityAuditor,
  secureTokenStorage,
  rateLimiter,
  sensitiveDataProtector,
  securityAuditor
};