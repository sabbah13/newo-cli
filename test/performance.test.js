/**
 * Comprehensive tests for performance optimization utilities
 */
import { expect } from 'chai';
import fs from 'fs-extra';
import {
  PerformanceMonitor,
  CacheManager,
  ParallelExecutor,
  ConnectionPool,
  FileOperationOptimizer
} from '../src/performance.js';
import { NewoError } from '../src/errors.js';
import { TestEnvironment, MockLogger } from './test-utils.js';

describe('Performance Optimization System', () => {
  let testEnv;

  beforeEach(() => {
    testEnv = new TestEnvironment();
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  describe('Performance Monitor', () => {
    let monitor;

    beforeEach(() => {
      monitor = new PerformanceMonitor();
    });

    it('should track operation timing correctly', () => {
      monitor.startTimer('test-operation');
      
      // Simulate some work
      const start = Date.now();
      while (Date.now() - start < 10) {
        // Busy wait for ~10ms
      }
      
      const metrics = monitor.endTimer('test-operation', { context: 'test' });
      
      expect(metrics).to.not.be.null;
      expect(metrics.label).to.equal('test-operation');
      expect(metrics.duration).to.be.greaterThan(5);
      expect(metrics.duration).to.be.lessThan(100);
      expect(metrics.metadata.context).to.equal('test');
      expect(metrics.timestamp).to.be.a('number');
    });

    it('should track memory usage deltas', () => {
      monitor.startTimer('memory-test');
      
      // Allocate some memory
      const data = new Array(1000).fill('test-data');
      
      const metrics = monitor.endTimer('memory-test');
      
      expect(metrics.memoryDelta).to.be.an('object');
      expect(metrics.memoryDelta).to.have.property('rss');
      expect(metrics.memoryDelta).to.have.property('heapUsed');
      expect(metrics.memoryDelta).to.have.property('heapTotal');
      expect(metrics.memoryDelta).to.have.property('external');
    });

    it('should handle missing timers gracefully', () => {
      const metrics = monitor.endTimer('non-existent-timer');
      expect(metrics).to.be.null;
    });

    it('should store and retrieve metrics', () => {
      monitor.startTimer('test1');
      monitor.startTimer('test2');
      
      monitor.endTimer('test1');
      monitor.endTimer('test2');
      
      const allMetrics = monitor.getMetrics();
      expect(Object.keys(allMetrics)).to.have.length(2);
      expect(allMetrics.test1).to.exist;
      expect(allMetrics.test2).to.exist;
    });

    it('should clear metrics', () => {
      monitor.startTimer('test');
      monitor.endTimer('test');
      
      expect(Object.keys(monitor.getMetrics())).to.have.length(1);
      
      monitor.clearMetrics();
      
      expect(Object.keys(monitor.getMetrics())).to.have.length(0);
    });

    it('should generate performance summary', async () => {
      const mockLogger = new MockLogger();
      
      // Track multiple operations
      for (let i = 0; i < 5; i++) {
        monitor.startTimer(`operation-${i}`);
        await new Promise(resolve => setTimeout(resolve, 1));
        monitor.endTimer(`operation-${i}`);
      }
      
      const summary = await monitor.logSummary();
      
      expect(summary.totalOperations).to.equal(5);
      expect(summary.totalTime).to.be.greaterThan(0);
      expect(summary.averageTime).to.be.greaterThan(0);
      expect(summary.slowestOperation).to.exist;
      expect(summary.metrics).to.be.an('object');
    });
  });

  describe('Cache Manager', () => {
    let cache;

    beforeEach(() => {
      cache = new CacheManager({
        maxSize: 5,
        defaultTtl: 100 // Short TTL for testing
      });
    });

    afterEach(() => {
      cache.clear();
    });

    it('should store and retrieve values', () => {
      cache.set('key1', 'value1');
      cache.set('key2', { data: 'complex value' });
      
      expect(cache.get('key1')).to.equal('value1');
      expect(cache.get('key2')).to.deep.equal({ data: 'complex value' });
    });

    it('should handle cache misses', () => {
      expect(cache.get('non-existent')).to.be.null;
    });

    it('should respect TTL expiration', async () => {
      cache.set('expiring-key', 'value', 50);
      
      expect(cache.get('expiring-key')).to.equal('value');
      
      await new Promise(resolve => setTimeout(resolve, 60));
      
      expect(cache.get('expiring-key')).to.be.null;
    });

    it('should implement LRU eviction', () => {
      // Fill cache to max capacity
      for (let i = 0; i < 5; i++) {
        cache.set(`key${i}`, `value${i}`);
      }
      
      // Access some keys to update their order
      cache.get('key1');
      cache.get('key3');
      
      // Add one more item to trigger eviction
      cache.set('key5', 'value5');
      
      // Least recently used items should be evicted
      expect(cache.get('key0')).to.be.null; // Should be evicted
      expect(cache.get('key1')).to.equal('value1'); // Should still exist
      expect(cache.get('key3')).to.equal('value3'); // Should still exist
    });

    it('should check key existence', () => {
      cache.set('existing-key', 'value');
      
      expect(cache.has('existing-key')).to.be.true;
      expect(cache.has('non-existent-key')).to.be.false;
    });

    it('should delete entries', () => {
      cache.set('key-to-delete', 'value');
      
      expect(cache.has('key-to-delete')).to.be.true;
      
      const deleted = cache.delete('key-to-delete');
      expect(deleted).to.be.true;
      expect(cache.has('key-to-delete')).to.be.false;
      
      const deletedAgain = cache.delete('key-to-delete');
      expect(deletedAgain).to.be.false;
    });

    it('should generate cache keys from objects', () => {
      const obj1 = { a: 1, b: 2 };
      const obj2 = { b: 2, a: 1 }; // Same data, different order
      const obj3 = { a: 1, b: 3 }; // Different data
      
      cache.set(obj1, 'value1');
      cache.set(obj3, 'value3');
      
      // Same object structure should retrieve same value
      expect(cache.get(obj1)).to.equal('value1');
      expect(cache.get(obj2)).to.equal('value1'); // Order shouldn't matter for JSON
      expect(cache.get(obj3)).to.equal('value3');
    });

    it('should provide cache statistics', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      
      cache.get('key1'); // hit
      cache.get('key1'); // hit
      cache.get('key3'); // miss
      
      const stats = cache.getStats();
      
      expect(stats.hits).to.equal(2);
      expect(stats.misses).to.equal(1);
      expect(stats.sets).to.equal(2);
      expect(stats.hitRate).to.be.approximately(0.67, 0.01);
      expect(stats.size).to.equal(2);
    });

    it('should memoize function calls', async () => {
      let callCount = 0;
      
      const expensiveFunction = async (x, y) => {
        callCount++;
        await new Promise(resolve => setTimeout(resolve, 10));
        return x + y;
      };
      
      const memoizedFunction = cache.memoize(expensiveFunction);
      
      // First calls should execute function
      const result1 = await memoizedFunction(1, 2);
      const result2 = await memoizedFunction(3, 4);
      expect(result1).to.equal(3);
      expect(result2).to.equal(7);
      expect(callCount).to.equal(2);
      
      // Repeat calls should use cache
      const result3 = await memoizedFunction(1, 2);
      const result4 = await memoizedFunction(3, 4);
      expect(result3).to.equal(3);
      expect(result4).to.equal(7);
      expect(callCount).to.equal(2); // No additional calls
    });

    it('should clear all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      
      expect(cache.getStats().size).to.equal(2);
      
      cache.clear();
      
      expect(cache.getStats().size).to.equal(0);
      expect(cache.get('key1')).to.be.null;
      expect(cache.get('key2')).to.be.null;
    });
  });

  describe('Parallel Executor', () => {
    let executor;

    beforeEach(() => {
      executor = new ParallelExecutor({
        maxConcurrency: 3,
        defaultTimeout: 1000
      });
    });

    it('should execute operations in parallel', async () => {
      const operations = [
        async () => { await new Promise(resolve => setTimeout(resolve, 50)); return 'result1'; },
        async () => { await new Promise(resolve => setTimeout(resolve, 50)); return 'result2'; },
        async () => { await new Promise(resolve => setTimeout(resolve, 50)); return 'result3'; }
      ];
      
      const startTime = Date.now();
      const result = await executor.executeParallel(operations);
      const duration = Date.now() - startTime;
      
      expect(result.successCount).to.equal(3);
      expect(result.errorCount).to.equal(0);
      expect(result.totalCount).to.equal(3);
      expect(duration).to.be.lessThan(150); // Should be faster than sequential
      
      expect(result.results[0].success).to.be.true;
      expect(result.results[0].result).to.equal('result1');
    });

    it('should respect concurrency limits', async () => {
      let concurrentCount = 0;
      let maxConcurrent = 0;
      
      const operations = Array.from({ length: 10 }, () => async () => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        
        await new Promise(resolve => setTimeout(resolve, 20));
        
        concurrentCount--;
        return 'completed';
      });
      
      await executor.executeParallel(operations, { concurrency: 3 });
      
      expect(maxConcurrent).to.be.at.most(3);
    });

    it('should handle operation failures', async () => {
      const operations = [
        async () => 'success1',
        async () => { throw new Error('Operation failed'); },
        async () => 'success2',
        async () => { throw new Error('Another failure'); }
      ];
      
      const result = await executor.executeParallel(operations, { failFast: false });
      
      expect(result.successCount).to.equal(2);
      expect(result.errorCount).to.equal(2);
      expect(result.totalCount).to.equal(4);
      
      expect(result.results[0].success).to.be.true;
      expect(result.results[1].success).to.be.false;
      expect(result.results[2].success).to.be.true;
      expect(result.results[3].success).to.be.false;
      
      expect(result.errors).to.have.length(2);
    });

    it('should support fail-fast mode', async () => {
      const operations = [
        async () => { await new Promise(resolve => setTimeout(resolve, 10)); return 'success'; },
        async () => { await new Promise(resolve => setTimeout(resolve, 5)); throw new Error('Early failure'); },
        async () => { await new Promise(resolve => setTimeout(resolve, 20)); return 'late success'; }
      ];
      
      try {
        await executor.executeParallel(operations, { failFast: true });
        expect.fail('Should have thrown error in fail-fast mode');
      } catch (error) {
        expect(error.message).to.equal('Early failure');
      }
    });

    it('should implement timeout for operations', async () => {
      const operations = [
        async () => { await new Promise(resolve => setTimeout(resolve, 200)); return 'slow'; },
        async () => 'fast'
      ];
      
      const result = await executor.executeParallel(operations, { 
        timeout: 100, 
        failFast: false 
      });
      
      expect(result.successCount).to.equal(1);
      expect(result.errorCount).to.equal(1);
      expect(result.results[0].success).to.be.false; // Timed out
      expect(result.results[1].success).to.be.true;
    });

    it('should retry failed operations', async () => {
      let attempts = 0;
      
      const operations = [
        async () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('Temporary failure');
          }
          return 'success after retries';
        }
      ];
      
      const result = await executor.executeParallel(operations, { 
        retries: 3,
        failFast: false 
      });
      
      expect(result.successCount).to.equal(1);
      expect(result.results[0].result).to.equal('success after retries');
      expect(attempts).to.equal(3);
    });

    it('should execute batches sequentially', async () => {
      const operations = Array.from({ length: 8 }, (_, i) => 
        async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return `result-${i}`;
        }
      );
      
      const batchProgress = [];
      
      const result = await executor.executeBatches(operations, 3, {
        onProgress: (progress) => {
          batchProgress.push(progress.batchIndex);
        }
      });
      
      expect(result.successCount).to.equal(8);
      expect(batchProgress).to.deep.equal([0, 1, 2]); // 3 batches (3, 3, 2 items)
    });

    it('should map items in parallel', async () => {
      const items = [1, 2, 3, 4, 5];
      
      const mapper = async (item) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return item * 2;
      };
      
      const results = await executor.parallelMap(items, mapper, { concurrency: 3 });
      
      expect(results).to.deep.equal([2, 4, 6, 8, 10]);
    });

    it('should filter items in parallel', async () => {
      const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      
      const predicate = async (item) => {
        await new Promise(resolve => setTimeout(resolve, 5));
        return item % 2 === 0; // Even numbers
      };
      
      const results = await executor.parallelFilter(items, predicate, { concurrency: 4 });
      
      expect(results).to.deep.equal([2, 4, 6, 8, 10]);
    });
  });

  describe('Connection Pool', () => {
    let pool;

    beforeEach(() => {
      pool = new ConnectionPool({
        maxConnections: 3,
        maxIdleTime: 100 // Short idle time for testing
      });
    });

    afterEach(() => {
      pool.closeAll();
    });

    it('should create and reuse connections', () => {
      const conn1 = pool.getConnection('example.com', 443);
      const conn2 = pool.getConnection('example.com', 443);
      
      expect(conn1).to.exist;
      expect(conn2).to.exist;
      expect(conn1.id).to.not.equal(conn2.id); // Different connections
      
      pool.releaseConnection(conn1.id);
      
      const conn3 = pool.getConnection('example.com', 443);
      expect(conn3.id).to.equal(conn1.id); // Reused connection
    });

    it('should enforce connection limits', () => {
      const connections = [];
      
      // Create max number of connections
      for (let i = 0; i < 3; i++) {
        connections.push(pool.getConnection('example.com', 443));
      }
      
      // Should throw when trying to exceed limit
      expect(() => pool.getConnection('example.com', 443)).to.throw(NewoError, 'Connection pool exhausted');
    });

    it('should track connection statistics', () => {
      const conn1 = pool.getConnection('example.com', 443);
      const conn2 = pool.getConnection('api.example.com', 443);
      
      const stats = pool.getStats();
      
      expect(stats.totalConnections).to.equal(2);
      expect(stats.activeConnections).to.equal(2);
      expect(stats.idleConnections).to.equal(0);
      expect(stats.created).to.equal(2);
      
      pool.releaseConnection(conn1.id);
      
      const updatedStats = pool.getStats();
      expect(updatedStats.activeConnections).to.equal(1);
      expect(updatedStats.idleConnections).to.equal(1);
    });

    it('should cleanup idle connections', async () => {
      const conn = pool.getConnection('example.com', 443);
      pool.releaseConnection(conn.id);
      
      expect(pool.getStats().totalConnections).to.equal(1);
      
      // Wait for idle timeout
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Trigger cleanup by trying to get a connection
      pool.getConnection('other.com', 443);
      
      const stats = pool.getStats();
      expect(stats.timeouts).to.be.greaterThan(0);
    });

    it('should handle different hosts separately', () => {
      const conn1 = pool.getConnection('host1.com', 443);
      const conn2 = pool.getConnection('host2.com', 443);
      
      expect(conn1.key).to.equal('host1.com:443');
      expect(conn2.key).to.equal('host2.com:443');
      expect(conn1.id).to.not.equal(conn2.id);
    });
  });

  describe('File Operation Optimizer', () => {
    let optimizer;
    let mockFs;

    beforeEach(() => {
      optimizer = new FileOperationOptimizer();
      
      // Mock file system operations
      mockFs = {
        files: new Map(),
        readFile: async (path) => {
          const file = mockFs.files.get(path);
          if (!file) throw new Error(`File not found: ${path}`);
          return file.content;
        },
        stat: async (path) => {
          const file = mockFs.files.get(path);
          if (!file) throw new Error(`File not found: ${path}`);
          return file.stats;
        }
      };
      
      testEnv.createStub(fs, 'readFile', mockFs.readFile);
      testEnv.createStub(fs, 'stat', mockFs.stat);
    });

    afterEach(() => {
      optimizer.cache.clear();
    });

    it('should optimize file reading with caching', async () => {
      const filePath = '/test/file.txt';
      const fileContent = 'Test file content';
      const fileStats = { size: fileContent.length, mtime: new Date() };
      
      mockFs.files.set(filePath, { content: fileContent, stats: fileStats });
      
      // First read - should cache
      const result1 = await optimizer.readFileOptimized(filePath);
      expect(result1.content).to.equal(fileContent);
      expect(result1.size).to.equal(fileContent.length);
      
      // Second read - should use cache
      const result2 = await optimizer.readFileOptimized(filePath);
      expect(result2).to.deep.equal(result1);
      
      // Verify cache usage
      const cacheStats = optimizer.cache.getStats();
      expect(cacheStats.hits).to.equal(1);
    });

    it('should respect cache settings', async () => {
      const filePath = '/test/file.txt';
      const fileContent = 'Test content';
      
      mockFs.files.set(filePath, { 
        content: fileContent, 
        stats: { size: fileContent.length, mtime: new Date() }
      });
      
      // Read without cache
      await optimizer.readFileOptimized(filePath, { useCache: false });
      
      // Cache should be empty
      const cacheStats = optimizer.cache.getStats();
      expect(cacheStats.size).to.equal(0);
    });

    it('should not cache large files', async () => {
      const filePath = '/test/large-file.txt';
      const largeContent = 'x'.repeat(2 * 1024 * 1024); // 2MB
      
      mockFs.files.set(filePath, {
        content: largeContent,
        stats: { size: largeContent.length, mtime: new Date() }
      });
      
      await optimizer.readFileOptimized(filePath);
      
      // Large files should not be cached
      const cacheStats = optimizer.cache.getStats();
      expect(cacheStats.size).to.equal(0);
    });

    it('should handle file read errors gracefully', async () => {
      try {
        await optimizer.readFileOptimized('/nonexistent/file.txt');
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).to.be.instanceOf(NewoError);
        expect(error.message).to.include('Failed to read file');
      }
    });

    it('should execute file operations in parallel', async () => {
      const operations = [
        () => Promise.resolve('operation1'),
        () => Promise.resolve('operation2'),
        () => Promise.resolve('operation3')
      ];
      
      const startTime = Date.now();
      const result = await optimizer.batchFileOperations(operations, { concurrency: 3 });
      const duration = Date.now() - startTime;
      
      expect(result.successCount).to.equal(3);
      expect(duration).to.be.lessThan(50); // Should be fast with parallel execution
    });

    it('should scan directories optimally', async () => {
      // Mock directory structure
      const mockReaddir = testEnv.createStub(await import('fs-extra'), 'readdir');
      mockReaddir.withArgs('/test/dir').resolves([
        { name: 'file1.txt', isDirectory: () => false, isFile: () => true },
        { name: 'subdir', isDirectory: () => true, isFile: () => false }
      ]);
      
      const result = await optimizer.scanDirectoryOptimized('/test/dir', {
        includeStats: false,
        recursive: false
      });
      
      expect(result).to.have.length(2);
      expect(result[0].name).to.equal('file1.txt');
      expect(result[0].isFile).to.be.true;
      expect(result[1].name).to.equal('subdir');
      expect(result[1].isDirectory).to.be.true;
    });

    it('should cache directory scan results', async () => {
      const mockReaddir = testEnv.createStub(await import('fs-extra'), 'readdir');
      mockReaddir.resolves([]);
      
      // First scan
      await optimizer.scanDirectoryOptimized('/test/dir');
      expect(mockReaddir.callCount).to.equal(1);
      
      // Second scan - should use cache
      await optimizer.scanDirectoryOptimized('/test/dir');
      expect(mockReaddir.callCount).to.equal(1); // No additional calls
    });
  });

  describe('Performance Integration Tests', () => {
    it('should demonstrate complete performance optimization workflow', async function() {
      this.timeout(10000); // 10 second timeout
      const monitor = new PerformanceMonitor();
      const cache = new CacheManager({ maxSize: 100 });
      const executor = new ParallelExecutor({ maxConcurrency: 5 });
      
      monitor.startTimer('complete-workflow');
      
      // 1. Test parallel execution with caching
      const cachedOperation = cache.memoize(async (x) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return x * 2;
      });
      
      // First call each number to populate cache
      await cachedOperation(1);
      await cachedOperation(2);
      await cachedOperation(3);
      
      const parallelResults = await executor.parallelMap([1, 2, 3, 4, 5], 
        async (item) => cachedOperation(item), 
        { concurrency: 3 }
      );
      
      expect(parallelResults).to.deep.equal([2, 4, 6, 8, 10]);
      
      // 2. Test cache efficiency
      const cacheStats = cache.getStats();
      expect(cacheStats.hits).to.be.greaterThan(0);
      
      // 3. Test performance monitoring
      const metrics = monitor.endTimer('complete-workflow');
      expect(metrics.duration).to.be.greaterThan(0);
      
      // Test monitor summary without async logging that might hang
      const summary = monitor.getMetrics();
      expect(Object.keys(summary)).to.include('complete-workflow');
      
      cache.clear();
    });

    it('should handle high-load scenarios efficiently', async () => {
      const cache = new CacheManager({ maxSize: 1000 });
      const executor = new ParallelExecutor({ maxConcurrency: 10 });
      const monitor = new PerformanceMonitor();
      
      monitor.startTimer('high-load-test');
      
      // Simulate high-load operations
      const operations = Array.from({ length: 100 }, (_, i) => 
        async () => {
          // Mix of cache operations
          cache.set(`key-${i}`, `value-${i}`);
          const cached = cache.get(`key-${i}`);
          
          // Some computation
          const result = await new Promise(resolve => 
            setTimeout(() => resolve(i * 2), Math.random() * 5)
          );
          
          return { index: i, result, cached };
        }
      );
      
      const results = await executor.executeParallel(operations, {
        concurrency: 10,
        failFast: false
      });
      
      expect(results.successCount).to.equal(100);
      expect(results.errorCount).to.equal(0);
      
      const metrics = monitor.endTimer('high-load-test');
      expect(metrics.duration).to.be.lessThan(1000); // Should complete within 1 second
      
      const cacheStats = cache.getStats();
      expect(cacheStats.size).to.equal(100);
      
      cache.clear();
    });
  });
});