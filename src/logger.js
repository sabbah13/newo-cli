import fs from 'fs-extra';
import path from 'path';
import { config, getDirectories } from './config.js';

/**
 * Log levels with numeric values for comparison
 */
const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
  TRACE: 4
};

/**
 * ANSI color codes for console output
 */
const COLORS = {
  ERROR: '\x1b[31m', // Red
  WARN: '\x1b[33m',  // Yellow
  INFO: '\x1b[36m',  // Cyan
  DEBUG: '\x1b[35m', // Magenta
  TRACE: '\x1b[37m', // White
  RESET: '\x1b[0m'
};

/**
 * Emoji indicators for log levels
 */
const EMOJIS = {
  ERROR: '❌',
  WARN: '⚠️',
  INFO: 'ℹ️',
  DEBUG: '🐛',
  TRACE: '🔍'
};

/**
 * Logger class with structured logging capabilities
 */
class Logger {
  constructor(options = {}) {
    this.level = options.level || (config.NODE_ENV === 'production' ? 'INFO' : 'DEBUG');
    this.enableConsole = options.enableConsole !== false;
    this.enableFile = options.enableFile !== false;
    this.enableColors = options.enableColors !== false && process.stdout.isTTY;
    this.simple = options.simple || false; // Simple mode - no JSON metadata
    this.logDir = null;
    this.logFile = null;
    
    // Initialize async
    this._initPromise = this._initialize();
  }

  async _initialize() {
    if (this.enableFile) {
      const dirs = getDirectories();
      this.logDir = dirs.logs;
      await fs.ensureDir(this.logDir);
      
      const timestamp = new Date().toISOString().split('T')[0];
      this.logFile = path.join(this.logDir, `newo-cli-${timestamp}.log`);
    }
  }

  /**
   * Ensure logger is initialized before logging
   */
  async _ensureInitialized() {
    if (this._initPromise) {
      await this._initPromise;
      this._initPromise = null;
    }
  }

  /**
   * Check if level should be logged
   */
  _shouldLog(level) {
    return LOG_LEVELS[level] <= LOG_LEVELS[this.level];
  }

  /**
   * Format log entry
   */
  _formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const levelStr = level.padEnd(5);
    
    const baseMessage = typeof message === 'object' 
      ? JSON.stringify(message) 
      : String(message);

    return {
      timestamp,
      level,
      message: baseMessage,
      meta,
      pid: process.pid,
      formatted: `${timestamp} [${levelStr}] ${baseMessage}${Object.keys(meta).length ? ` ${  JSON.stringify(meta)}` : ''}`
    };
  }

  /**
   * Format for console output with colors and emojis
   */
  _formatConsoleMessage(entry) {
    const { timestamp, level, message, meta } = entry;
    const time = timestamp.split('T')[1].split('.')[0];
    const emoji = EMOJIS[level] || '';
    const color = this.enableColors ? COLORS[level] : '';
    const reset = this.enableColors ? COLORS.RESET : '';
    
    if (this.simple) {
      // Simple mode: just message, no timestamp or JSON
      return `${color}${message}${reset}`;
    }
    
    let output = `${color}${emoji} ${time} ${message}${reset}`;
    
    if (Object.keys(meta).length > 0) {
      output += `\n${color}   ${JSON.stringify(meta, null, 2).split('\n').join('\n   ')}${reset}`;
    }
    
    return output;
  }

  /**
   * Write log entry
   */
  async _writeLog(level, message, meta = {}) {
    if (!this._shouldLog(level)) return;

    await this._ensureInitialized();
    
    const entry = this._formatMessage(level, message, meta);

    // Console output
    if (this.enableConsole) {
      const consoleMessage = this._formatConsoleMessage(entry);
      
      if (level === 'ERROR') {
        console.error(consoleMessage);
      } else if (level === 'WARN') {
        console.warn(consoleMessage);
      } else {
        console.log(consoleMessage);
      }
    }

    // File output
    if (this.enableFile && this.logFile) {
      try {
        await fs.appendFile(this.logFile, `${entry.formatted  }\n`);
      } catch (error) {
        console.error('Failed to write to log file:', error.message);
      }
    }
  }

  /**
   * Log methods for each level
   */
  async error(message, meta = {}) {
    await this._writeLog('ERROR', message, meta);
  }

  async warn(message, meta = {}) {
    await this._writeLog('WARN', message, meta);
  }

  async info(message, meta = {}) {
    await this._writeLog('INFO', message, meta);
  }

  async debug(message, meta = {}) {
    await this._writeLog('DEBUG', message, meta);
  }

  async trace(message, meta = {}) {
    await this._writeLog('TRACE', message, meta);
  }

  /**
   * Log API request/response
   */
  async logApiCall(method, url, status, duration, error = null) {
    const meta = {
      method: method?.toUpperCase(),
      url,
      status,
      duration: `${duration}ms`
    };

    if (error) {
      await this.error(`API Error: ${method} ${url}`, { ...meta, error: error.message });
    } else if (status >= 400) {
      await this.warn(`API Warning: ${method} ${url}`, meta);
    } else {
      await this.debug(`API Call: ${method} ${url}`, meta);
    }
  }

  /**
   * Log file operation
   */
  async logFileOperation(operation, filePath, success = true, error = null) {
    const meta = {
      operation,
      filePath,
      success
    };

    if (error) {
      await this.error(`File Operation Failed: ${operation}`, { ...meta, error: error.message });
    } else {
      await this.debug(`File Operation: ${operation}`, meta);
    }
  }

  /**
   * Create child logger with additional context
   */
  child(context) {
    const childLogger = Object.create(this);
    childLogger._childContext = { ...this._childContext, ...context };
    
    // Override _writeLog to include child context
    const originalWriteLog = this._writeLog.bind(this);
    childLogger._writeLog = async function(level, message, meta = {}) {
      const combinedMeta = { ...this._childContext, ...meta };
      return originalWriteLog(level, message, combinedMeta);
    };
    
    return childLogger;
  }

  /**
   * Flush any pending log writes
   */
  async flush() {
    // For file logging, this is handled by fs.appendFile automatically
    // This method is for compatibility and future enhancements
    return Promise.resolve();
  }

  /**
   * Close logger and cleanup resources
   */
  async close() {
    await this.flush();
    // Additional cleanup if needed
  }

  /**
   * Set log level dynamically
   */
  setLevel(level) {
    if (LOG_LEVELS[level] === undefined) {
      throw new Error(`Invalid log level: ${level}. Valid levels: ${Object.keys(LOG_LEVELS).join(', ')}`);
    }
    this.level = level;
  }

  /**
   * Get current log level
   */
  getLevel() {
    return this.level;
  }

  /**
   * Check if level is enabled
   */
  isEnabled(level) {
    return this._shouldLog(level);
  }
}

/**
 * Create default logger instance
 */
const defaultLogger = new Logger({
  level: 'WARN', // Changed to WARN to reduce noise - CLI can override with verbose mode
  enableConsole: true,
  enableFile: true,
  enableColors: true
});

/**
 * Progress logger for long-running operations
 */
class ProgressLogger {
  constructor(logger, total, message = 'Processing') {
    this.logger = logger;
    this.total = total;
    this.current = 0;
    this.message = message;
    this.startTime = Date.now();
    this.lastUpdate = 0;
  }

  async update(increment = 1, currentMessage = null) {
    this.current += increment;
    const now = Date.now();
    
    // Only update every 500ms to avoid spam
    if (now - this.lastUpdate < 500 && this.current < this.total) {
      return;
    }
    
    this.lastUpdate = now;
    const percentage = Math.round((this.current / this.total) * 100);
    const elapsed = now - this.startTime;
    const estimated = this.current > 0 ? (elapsed / this.current) * this.total : 0;
    const remaining = Math.max(0, estimated - elapsed);
    
    const progress = `[${this.current}/${this.total}] ${percentage}% (${Math.round(remaining / 1000)}s remaining)`;
    const message = currentMessage || this.message;
    
    await this.logger.info(`${message}: ${progress}`);
  }

  async complete(finalMessage = null) {
    const elapsed = Date.now() - this.startTime;
    const message = finalMessage ? `${finalMessage} - completed` : `${this.message} completed`;
    await this.logger.info(`${message} in ${Math.round(elapsed / 1000)}s`);
  }
}

export {
  Logger,
  ProgressLogger,
  LOG_LEVELS,
  defaultLogger as logger
};