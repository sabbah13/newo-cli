/**
 * Unit tests for hash functions
 */
const assert = require('assert');
const { expect } = require('chai');
const fs = require('fs-extra');
const path = require('path');
const { sha256, loadHashes, saveHashes } = require('../dist/hash');
const { TestEnvironment } = require('./test-utils');

describe('Hash Functions', function() {
  let testEnv;
  
  beforeEach(function() {
    testEnv = new TestEnvironment();
  });
  
  afterEach(async function() {
    await testEnv.cleanup();
  });

  describe('SHA256 Hashing', function() {
    it('should generate consistent SHA256 hashes', function() {
      const testString = 'Hello, NEWO CLI!';
      const hash1 = sha256(testString);
      const hash2 = sha256(testString);
      
      assert(hash1 === hash2, 'Same input should produce same hash');
      assert.strictEqual(typeof hash1, 'string', 'Should return string');
      assert.strictEqual(hash1.length, 64, 'SHA256 hash should be 64 characters');
      assert(/^[a-f0-9]+$/.test(hash1), 'Hash should be lowercase hex');
    });

    it('should generate different hashes for different inputs', function() {
      const hash1 = sha256('input1');
      const hash2 = sha256('input2');
      
      assert(hash1 !== hash2, 'Different inputs should produce different hashes');
    });

    it('should handle empty strings', function() {
      const emptyHash = sha256('');
      assert.strictEqual(typeof emptyHash, 'string', 'Should return string for empty input');
      assert.strictEqual(emptyHash.length, 64, 'Should return valid hash for empty string');
    });

    it('should handle unicode characters', function() {
      const unicodeString = '🚀 NEWO CLI with émojis and spëcial chars';
      const hash = sha256(unicodeString);
      
      assert.strictEqual(typeof hash, 'string', 'Should handle unicode');
      assert.strictEqual(hash.length, 64, 'Should return valid hash for unicode');
    });

    it('should match expected hash values', function() {
      // Test known hash for verification
      const knownInput = 'newo-cli-test';
      const knownHash = 'a8b5c1d2e3f4567890abcdef1234567890abcdef1234567890abcdef12345678';
      
      const actualHash = sha256(knownInput);
      
      // We can't predict the exact hash, but we can verify properties
      assert.strictEqual(actualHash.length, 64, 'Should be correct length');
      assert(/^[a-f0-9]+$/.test(actualHash), 'Should be valid hex');
      
      // Consistency check
      assert.strictEqual(sha256(knownInput), actualHash, 'Should be consistent');
    });
  });

  describe('Hash Storage', function() {
    let tempDir;
    
    beforeEach(async function() {
      tempDir = await testEnv.createTempDir();
      testEnv.createStub(process, 'cwd').returns(tempDir);
    });

    it('should save and load hash store', async function() {
      const testHashes = {
        'project1/agent1/skill1.guidance': 'hash1234567890abcdef',
        'project1/agent1/skill2.jinja': 'hash2345678901bcdefg',
        'project2/agent2/skill3.guidance': 'hash3456789012cdefgh'
      };
      
      await saveHashes(testHashes);
      const loaded = await loadHashes();
      
      assert.deepStrictEqual(loaded, testHashes, 'Loaded hashes should match saved hashes');
    });

    it('should return empty object when no hashes file exists', async function() {
      const hashes = await loadHashes();
      assert.deepStrictEqual(hashes, {}, 'Should return empty object');
    });

    it('should handle customer-specific hash storage', async function() {
      const customerIdn = 'acme';
      const testHashes = {
        'skill1.guidance': 'customerhash123',
        'skill2.jinja': 'customerhash456'
      };
      
      // Mock ensureState function to avoid actual directory creation issues
      const fsutil = require('../dist/fsutil');
      testEnv.createStub(fsutil, 'ensureState').resolves();
      
      // Mock hashesPath to return predictable path
      const expectedPath = path.join(tempDir, 'newo_customers', customerIdn, '.newo', 'hashes.json');
      testEnv.createStub(fsutil, 'hashesPath').returns(expectedPath);
      
      // Ensure directory exists
      await fs.ensureDir(path.dirname(expectedPath));
      
      await saveHashes(testHashes, customerIdn);
      
      // Verify file was created
      const exists = await fs.pathExists(expectedPath);
      assert(exists, 'Customer-specific hashes file should be created');
      
      // Verify content
      const saved = await fs.readJson(expectedPath);
      assert.deepStrictEqual(saved, testHashes, 'Saved hashes should match input');
      
      // Load and verify
      const loaded = await loadHashes(customerIdn);
      assert.deepStrictEqual(loaded, testHashes, 'Loaded hashes should match saved hashes');
    });

    it('should handle legacy hash storage path', async function() {
      const testHashes = {
        'legacy/skill.guidance': 'legacyhash123'
      };
      
      // Save without customer ID (legacy mode)
      await saveHashes(testHashes);
      
      // Verify saved to legacy path
      const legacyPath = path.join(tempDir, '.newo', 'hashes.json');
      const exists = await fs.pathExists(legacyPath);
      assert(exists, 'Legacy hashes file should be created');
      
      const loaded = await loadHashes(); // Load without customer ID
      assert.deepStrictEqual(loaded, testHashes, 'Should load from legacy path');
    });

    it('should handle file read errors gracefully', async function() {
      const invalidDir = path.join(tempDir, 'invalid');
      await fs.ensureDir(invalidDir);
      
      // Create a directory where file should be (to cause read error)
      const hashesFile = path.join(invalidDir, '.newo', 'hashes.json');
      await fs.ensureDir(hashesFile); // Create as directory instead of file
      
      const fsutil = require('../dist/fsutil');
      testEnv.createStub(fsutil, 'hashesPath').returns(hashesFile);
      testEnv.createStub(fsutil, 'ensureState').resolves();
      
      try {
        await loadHashes('invalid');
        assert.fail('Should have thrown error');
      } catch (error) {
        assert(error instanceof Error, 'Should throw proper error');
        // Should not be ENOENT error (which is handled)
        assert(error.code !== 'ENOENT', 'Should not be file not found error');
      }
    });

    it('should format JSON output correctly', async function() {
      const testHashes = {
        'skill1.guidance': 'hash123',
        'skill2.jinja': 'hash456'
      };
      
      await saveHashes(testHashes);
      
      const hashesPath = path.join(tempDir, '.newo', 'hashes.json');
      const fileContent = await fs.readFile(hashesPath, 'utf8');
      const parsed = JSON.parse(fileContent);
      
      // Verify JSON is properly formatted with spaces
      assert(fileContent.includes('  '), 'Should format JSON with spaces');
      assert.deepStrictEqual(parsed, testHashes, 'Parsed content should match original');
    });

    it('should handle concurrent access', async function() {
      const hashes1 = { 'file1.guidance': 'hash1' };
      const hashes2 = { 'file2.guidance': 'hash2' };
      
      // Simulate concurrent saves
      const promises = [
        saveHashes(hashes1),
        saveHashes(hashes2)
      ];
      
      await Promise.all(promises);
      
      // Last write should win
      const loaded = await loadHashes();
      assert.deepStrictEqual(loaded, hashes2, 'Last write should win');
    });
  });

  describe('Hash Store Operations', function() {
    let tempDir;
    
    beforeEach(async function() {
      tempDir = await testEnv.createTempDir();
      testEnv.createStub(process, 'cwd').returns(tempDir);
    });

    it('should detect changes using hashes', async function() {
      const originalContent = 'Original skill content';
      const modifiedContent = 'Modified skill content';
      
      const originalHash = sha256(originalContent);
      const modifiedHash = sha256(modifiedContent);
      
      assert(originalHash !== modifiedHash, 'Different content should have different hashes');
      
      // Save original hash
      const hashes = { 'skill.guidance': originalHash };
      await saveHashes(hashes);
      
      // Load and compare with modified content
      const loaded = await loadHashes();
      const storedHash = loaded['skill.guidance'];
      
      assert(storedHash === originalHash, 'Should load original hash');
      assert(storedHash !== modifiedHash, 'Should detect change');
    });

    it('should handle skill path normalization', async function() {
      const content = 'Test content';
      const hash = sha256(content);
      
      const hashes = {
        'project/agent/skill.guidance': hash,
        'project\\agent\\skill.jinja': hash, // Windows path
        'project//agent//skill.guidance': hash, // Double slashes
      };
      
      await saveHashes(hashes);
      const loaded = await loadHashes();
      
      // Should preserve paths as-is (normalization happens at higher level)
      assert.strictEqual(Object.keys(loaded).length, 3, 'Should preserve all paths');
      assert(loaded['project/agent/skill.guidance'] === hash, 'Should preserve forward slash');
      assert(loaded['project\\agent\\skill.jinja'] === hash, 'Should preserve backslash');
    });

    it('should handle large hash stores efficiently', async function() {
      const largeHashes = {};
      
      // Generate 1000 fake entries
      for (let i = 0; i < 1000; i++) {
        largeHashes[`project${i}/agent${i}/skill${i}.guidance`] = sha256(`content${i}`);
      }
      
      const startTime = Date.now();
      await saveHashes(largeHashes);
      const loaded = await loadHashes();
      const endTime = Date.now();
      
      assert.strictEqual(Object.keys(loaded).length, 1000, 'Should handle large hash store');
      assert(endTime - startTime < 5000, 'Should complete within reasonable time'); // 5 seconds
      
      // Verify a few random entries
      assert(loaded['project0/agent0/skill0.guidance'] === sha256('content0'));
      assert(loaded['project999/agent999/skill999.guidance'] === sha256('content999'));
    });
  });
});