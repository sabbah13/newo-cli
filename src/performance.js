import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import { getDirectories } from './config.js';
import { logger } from './logger.js';
import { NewoError } from './errors.js';

/**
 * Performance monitoring utilities
 */
class PerformanceMonitor {
  constructor() {
    this.metrics = new Map();
    this.timers = new Map();
  }

  /**
   * Start timing an operation
   */
  startTimer(label) {
    this.timers.set(label, {
      start: process.hrtime.bigint(),
      memory: process.memoryUsage()
    });
  }

  /**
   * End timing and record metrics
   */
  endTimer(label, metadata = {}) {
    const timer = this.timers.get(label);
    if (!timer) {
      logger.warn(`Timer '${label}' not found`);
      return null;
    }

    const end = process.hrtime.bigint();
    const duration = Number(end - timer.start) / 1e6; // Convert to milliseconds
    const endMemory = process.memoryUsage();

    const metric = {
      label,
      duration,
      memoryDelta: {
        rss: endMemory.rss - timer.memory.rss,
        heapUsed: endMemory.heapUsed - timer.memory.heapUsed,
        heapTotal: endMemory.heapTotal - timer.memory.heapTotal,
        external: endMemory.external - timer.memory.external
      },
      timestamp: Date.now(),
      metadata
    };

    this.metrics.set(label, metric);
    this.timers.delete(label);

    return metric;
  }

  /**
   * Get performance metrics
   */
  getMetrics() {
    return Object.fromEntries(this.metrics);
  }

  /**
   * Clear metrics
   */
  clearMetrics() {
    this.metrics.clear();
    this.timers.clear();
  }

  /**
   * Log performance summary
   */
  async logSummary() {
    const metrics = this.getMetrics();
    const summary = {
      totalOperations: Object.keys(metrics).length,
      totalTime: Object.values(metrics).reduce((sum, m) => sum + m.duration, 0),
      averageTime: Object.values(metrics).reduce((sum, m) => sum + m.duration, 0) / Object.keys(metrics).length,
      slowestOperation: Object.values(metrics).reduce((max, m) => m.duration > (max?.duration || 0) ? m : max, null),
      metrics
    };

    await logger.info('Performance Summary', summary);
    return summary;
  }
}

/**
 * Intelligent caching system with TTL and LRU eviction
 */
class CacheManager {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 1000;
    this.defaultTtl = options.defaultTtl || 300000; // 5 minutes
    this.cache = new Map();
    this.accessOrder = new Map();
    this.timers = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0
    };
  }

  /**
   * Generate cache key from object
   */
  _generateKey(data) {
    if (typeof data === 'string') return data;
    
    // Create deterministic string representation by sorting object keys
    const deterministic = JSON.stringify(data, Object.keys(data).sort());
    return crypto.createHash('md5').update(deterministic).digest('hex');
  }

  /**
   * Update access order for LRU
   */
  _updateAccessOrder(key) {
    this.accessOrder.delete(key);
    this.accessOrder.set(key, Date.now());
  }

  /**
   * Evict least recently used items
   */
  _evictLRU() {
    const sortedByAccess = Array.from(this.accessOrder.entries())
      .sort((a, b) => a[1] - b[1]);

    const toEvict = sortedByAccess.slice(0, Math.ceil(this.maxSize * 0.1)); // Evict 10%

    for (const [key] of toEvict) {
      this._delete(key);
      this.stats.evictions++;
    }
  }

  /**
   * Internal delete without stats
   */
  _delete(key) {
    this.cache.delete(key);
    this.accessOrder.delete(key);
    
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }
  }

  /**
   * Set cache entry
   */
  set(key, value, ttl = null) {
    const cacheKey = this._generateKey(key);
    
    // Check if we need to evict
    if (this.cache.size >= this.maxSize) {
      this._evictLRU();
    }

    // Clear existing timer
    if (this.timers.has(cacheKey)) {
      clearTimeout(this.timers.get(cacheKey));
    }

    // Set value
    this.cache.set(cacheKey, {
      value,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTtl
    });

    this._updateAccessOrder(cacheKey);

    // Set TTL timer
    const effectiveTtl = ttl || this.defaultTtl;
    const timer = setTimeout(() => {
      this._delete(cacheKey);
    }, effectiveTtl);
    this.timers.set(cacheKey, timer);

    this.stats.sets++;
    return true;
  }

  /**
   * Get cache entry
   */
  get(key) {
    const cacheKey = this._generateKey(key);
    const entry = this.cache.get(cacheKey);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check if expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      this._delete(cacheKey);
      this.stats.misses++;
      return null;
    }

    this._updateAccessOrder(cacheKey);
    this.stats.hits++;
    return entry.value;
  }

  /**
   * Check if key exists
   */
  has(key) {
    return this.get(key) !== null;
  }

  /**
   * Delete cache entry
   */
  delete(key) {
    const cacheKey = this._generateKey(key);
    const existed = this.cache.has(cacheKey);
    
    if (existed) {
      this._delete(cacheKey);
      this.stats.deletes++;
    }
    
    return existed;
  }

  /**
   * Clear all cache
   */
  clear() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    
    this.cache.clear();
    this.accessOrder.clear();
    this.timers.clear();
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const hitRate = this.stats.hits / (this.stats.hits + this.stats.misses) || 0;
    return {
      ...this.stats,
      hitRate: Math.round(hitRate * 100) / 100,
      size: this.cache.size,
      maxSize: this.maxSize
    };
  }

  /**
   * Cached function wrapper
   */
  memoize(fn, options = {}) {
    const { keyGenerator = (...args) => JSON.stringify(args), ttl = null } = options;
    
    return async (...args) => {
      const key = keyGenerator(...args);
      const cached = this.get(key);
      
      if (cached !== null) {
        return cached;
      }
      
      const result = await fn(...args);
      this.set(key, result, ttl);
      return result;
    };
  }
}

/**
 * Parallel operation utilities
 */
class ParallelExecutor {
  constructor(options = {}) {
    this.maxConcurrency = options.maxConcurrency || 10;
    this.defaultTimeout = options.defaultTimeout || 30000;
  }

  /**
   * Execute operations in parallel with concurrency limit
   */
  async executeParallel(operations, options = {}) {
    const {
      concurrency = this.maxConcurrency,
      timeout = this.defaultTimeout,
      failFast = false,
      retries = 0
    } = options;

    if (!Array.isArray(operations)) {
      throw new NewoError('Operations must be an array');
    }

    const results = [];
    const errors = [];
    const executing = [];
    let index = 0;

    const executeNext = async () => {
      if (index >= operations.length) return;

      const currentIndex = index++;
      const operation = operations[currentIndex];

      try {
        let result;
        let attempts = 0;
        
        while (attempts <= retries) {
          try {
            if (timeout > 0) {
              result = await Promise.race([
                typeof operation === 'function' ? operation() : operation,
                new Promise((_, reject) => 
                  setTimeout(() => reject(new Error('Operation timeout')), timeout)
                )
              ]);
            } else {
              result = await (typeof operation === 'function' ? operation() : operation);
            }
            break;
          } catch (error) {
            attempts++;
            if (attempts > retries) throw error;
            await new Promise(resolve => setTimeout(resolve, 1000 * attempts)); // Exponential backoff
          }
        }

        results[currentIndex] = { success: true, result };
      } catch (error) {
        results[currentIndex] = { success: false, error };
        errors.push({ index: currentIndex, error });
        
        if (failFast) {
          throw error;
        }
      }

      await executeNext();
    };

    // Start initial concurrent operations
    for (let i = 0; i < Math.min(concurrency, operations.length); i++) {
      executing.push(executeNext());
    }

    await Promise.all(executing);

    return {
      results,
      errors,
      successCount: results.filter(r => r.success).length,
      errorCount: errors.length,
      totalCount: operations.length
    };
  }

  /**
   * Execute operations in batches
   */
  async executeBatches(operations, batchSize = null, options = {}) {
    const effectiveBatchSize = batchSize || this.maxConcurrency;
    const batches = [];
    
    for (let i = 0; i < operations.length; i += effectiveBatchSize) {
      batches.push(operations.slice(i, i + effectiveBatchSize));
    }

    const allResults = [];
    const allErrors = [];

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchResult = await this.executeParallel(batch, options);
      
      allResults.push(...batchResult.results);
      allErrors.push(...batchResult.errors);

      // Progress callback
      if (options.onProgress) {
        options.onProgress({
          batchIndex: i,
          totalBatches: batches.length,
          batchResults: batchResult,
          overallProgress: (i + 1) / batches.length
        });
      }
    }

    return {
      results: allResults,
      errors: allErrors,
      successCount: allResults.filter(r => r.success).length,
      errorCount: allErrors.length,
      totalCount: operations.length
    };
  }

  /**
   * Map operations with parallel execution
   */
  async parallelMap(items, mapper, options = {}) {
    const operations = items.map((item, index) => () => mapper(item, index));
    const result = await this.executeParallel(operations, options);
    
    return result.results.map(r => r.success ? r.result : null);
  }

  /**
   * Filter items with parallel execution
   */
  async parallelFilter(items, predicate, options = {}) {
    const operations = items.map((item, index) => () => predicate(item, index));
    const result = await this.executeParallel(operations, options);
    
    return items.filter((_, index) => 
      result.results[index]?.success && result.results[index]?.result
    );
  }
}

/**
 * Connection pooling for HTTP requests
 */
class ConnectionPool {
  constructor(options = {}) {
    this.maxConnections = options.maxConnections || 10;
    this.maxIdleTime = options.maxIdleTime || 30000;
    this.connections = new Map();
    this.stats = {
      created: 0,
      reused: 0,
      destroyed: 0,
      timeouts: 0
    };
  }

  /**
   * Get connection key
   */
  _getConnectionKey(host, port = 443) {
    return `${host}:${port}`;
  }

  /**
   * Create new connection
   */
  _createConnection(key) {
    // This is a placeholder - in a real implementation,
    // you would create actual HTTP/HTTPS connections
    const connection = {
      id: crypto.randomUUID(),
      key,
      created: Date.now(),
      lastUsed: Date.now(),
      inUse: false
    };

    this.stats.created++;
    return connection;
  }

  /**
   * Get connection from pool
   */
  getConnection(host, port = 443) {
    const key = this._getConnectionKey(host, port);
    const now = Date.now();

    // Clean up expired connections
    this._cleanupExpired();

    // Try to find available connection
    const hostConnections = Array.from(this.connections.values())
      .filter(conn => conn.key === key && !conn.inUse);

    if (hostConnections.length > 0) {
      const connection = hostConnections[0];
      connection.inUse = true;
      connection.lastUsed = now;
      this.stats.reused++;
      return connection;
    }

    // Create new connection if under limit
    const totalConnections = this.connections.size;
    if (totalConnections < this.maxConnections) {
      const connection = this._createConnection(key);
      connection.inUse = true;
      this.connections.set(connection.id, connection);
      return connection;
    }

    // Pool is full, return null or throw error
    throw new NewoError('Connection pool exhausted');
  }

  /**
   * Release connection back to pool
   */
  releaseConnection(connectionId) {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.inUse = false;
      connection.lastUsed = Date.now();
    }
  }

  /**
   * Clean up expired connections
   */
  _cleanupExpired() {
    const now = Date.now();
    const expired = [];

    for (const [id, connection] of this.connections.entries()) {
      if (!connection.inUse && (now - connection.lastUsed) > this.maxIdleTime) {
        expired.push(id);
      }
    }

    for (const id of expired) {
      this.connections.delete(id);
      this.stats.destroyed++;
      this.stats.timeouts++;
    }
  }

  /**
   * Get pool statistics
   */
  getStats() {
    return {
      ...this.stats,
      totalConnections: this.connections.size,
      activeConnections: Array.from(this.connections.values()).filter(c => c.inUse).length,
      idleConnections: Array.from(this.connections.values()).filter(c => !c.inUse).length,
      maxConnections: this.maxConnections
    };
  }

  /**
   * Close all connections
   */
  closeAll() {
    this.connections.clear();
  }
}

/**
 * Rate limiter for API requests
 */
class RateLimiter {
  constructor(options = {}) {
    this.limits = new Map();
    this.defaultLimit = options.defaultLimit || 100;
    this.defaultWindow = options.defaultWindow || 60000; // 1 minute
  }

  /**
   * Configure rate limit for a specific key
   */
  configure(key, limit, windowMs) {
    this.limits.set(key, {
      limit,
      windowMs,
      requests: [],
      blocked: false
    });
  }

  /**
   * Check if request is allowed
   */
  isAllowed(key, cost = 1) {
    const now = Date.now();
    
    // Get or create limit config
    if (!this.limits.has(key)) {
      this.configure(key, this.defaultLimit, this.defaultWindow);
    }
    
    const config = this.limits.get(key);
    
    // Clean old requests outside the window
    config.requests = config.requests.filter(time => now - time < config.windowMs);
    
    // Check if under limit
    if (config.requests.length + cost <= config.limit) {
      // Add new request timestamps
      for (let i = 0; i < cost; i++) {
        config.requests.push(now);
      }
      config.blocked = false;
      return {
        allowed: true,
        remaining: config.limit - config.requests.length,
        resetAt: config.requests[0] ? config.requests[0] + config.windowMs : null
      };
    }
    
    // Request blocked
    config.blocked = true;
    const resetAt = config.requests[0] + config.windowMs;
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      retryAfter: Math.ceil((resetAt - now) / 1000)
    };
  }

  /**
   * Reset rate limit for a key
   */
  reset(key) {
    if (this.limits.has(key)) {
      const config = this.limits.get(key);
      config.requests = [];
      config.blocked = false;
    }
  }

  /**
   * Get current status for a key
   */
  getStatus(key) {
    if (!this.limits.has(key)) {
      return null;
    }
    
    const config = this.limits.get(key);
    const now = Date.now();
    
    // Clean old requests
    config.requests = config.requests.filter(time => now - time < config.windowMs);
    
    return {
      limit: config.limit,
      remaining: config.limit - config.requests.length,
      windowMs: config.windowMs,
      blocked: config.blocked,
      resetAt: config.requests[0] ? config.requests[0] + config.windowMs : null
    };
  }

  /**
   * Clear all rate limits
   */
  clearAll() {
    this.limits.clear();
  }
}

/**
 * File operation optimization utilities
 */
class FileOperationOptimizer {
  constructor() {
    this.cache = new CacheManager({ maxSize: 500, defaultTtl: 60000 });
  }

  /**
   * Optimized file reading with caching
   */
  async readFileOptimized(filePath, options = {}) {
    const { useCache = true, encoding = 'utf8' } = options;
    const cacheKey = `file:${filePath}:${encoding}`;

    if (useCache) {
      const cached = this.cache.get(cacheKey);
      if (cached !== null) {
        return cached;
      }
    }

    try {
      const stats = await fs.stat(filePath);
      const content = await fs.readFile(filePath, encoding);
      
      const result = {
        content,
        size: stats.size,
        mtime: stats.mtime,
        path: filePath
      };

      if (useCache && stats.size < 1024 * 1024) { // Cache files under 1MB
        this.cache.set(cacheKey, result);
      }

      return result;
    } catch (error) {
      throw new NewoError(`Failed to read file: ${filePath}`, 'FILE_READ_ERROR', null, { 
        filePath, 
        originalError: error.message 
      });
    }
  }

  /**
   * Batch file operations
   */
  async batchFileOperations(operations, options = {}) {
    const { concurrency = 5 } = options;
    const executor = new ParallelExecutor({ maxConcurrency: concurrency });

    return executor.executeParallel(operations, options);
  }

  /**
   * Optimized directory scanning
   */
  async scanDirectoryOptimized(dirPath, options = {}) {
    const {
      recursive = false,
      filter = null,
      includeStats = false,
      useCache = true
    } = options;

    const cacheKey = `dir:${dirPath}:${recursive}:${includeStats}`;

    if (useCache) {
      const cached = this.cache.get(cacheKey);
      if (cached !== null) {
        return cached;
      }
    }

    try {
      const scan = async (currentPath) => {
        const entries = await fs.readdir(currentPath, { withFileTypes: true });
        const results = [];

        for (const entry of entries) {
          const fullPath = path.join(currentPath, entry.name);
          
          if (filter && !filter(entry.name, entry.isDirectory())) {
            continue;
          }

          const item = {
            name: entry.name,
            path: fullPath,
            isDirectory: entry.isDirectory(),
            isFile: entry.isFile()
          };

          if (includeStats) {
            try {
              const stats = await fs.stat(fullPath);
              item.stats = {
                size: stats.size,
                mtime: stats.mtime,
                ctime: stats.ctime
              };
            } catch (error) {
              item.statsError = error.message;
            }
          }

          results.push(item);

          if (recursive && entry.isDirectory()) {
            const subItems = await scan(fullPath);
            results.push(...subItems);
          }
        }

        return results;
      };

      const result = await scan(dirPath);

      if (useCache) {
        this.cache.set(cacheKey, result, 30000); // Cache for 30 seconds
      }

      return result;
    } catch (error) {
      throw new NewoError(`Failed to scan directory: ${dirPath}`, 'DIR_SCAN_ERROR', null, {
        dirPath,
        originalError: error.message
      });
    }
  }
}

// Create default instances
const performanceMonitor = new PerformanceMonitor();
const cacheManager = new CacheManager();
const parallelExecutor = new ParallelExecutor();
const connectionPool = new ConnectionPool();
const rateLimiter = new RateLimiter();
const fileOperationOptimizer = new FileOperationOptimizer();

export {
  PerformanceMonitor,
  CacheManager,
  ParallelExecutor,
  ConnectionPool,
  RateLimiter,
  FileOperationOptimizer,
  performanceMonitor,
  cacheManager,
  parallelExecutor,
  connectionPool,
  rateLimiter,
  fileOperationOptimizer
};