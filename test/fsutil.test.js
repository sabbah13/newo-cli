/**
 * Unit tests for file system utilities
 */
import assert from 'assert';
import { expect } from 'chai';
import fs from 'fs-extra';
import path from 'path';
import { 
  customerDir,
  customerProjectsDir, 
  customerStateDir,
  mapPath,
  hashesPath,
  ensureState,
  projectDir,
  flowsYamlPath,
  skillPath,
  metadataPath,
  writeFileSafe,
  readIfExists,
  NEWO_CUSTOMERS_DIR,
  STATE_DIR,
  ROOT_DIR,
  MAP_PATH,
  HASHES_PATH
} from '../dist/fsutil.js';
import { TestEnvironment } from './test-utils.js';

describe('File System Utilities', function() {
  let testEnv;
  let tempDir;
  
  beforeEach(async function() {
    testEnv = new TestEnvironment();
    tempDir = await testEnv.createTempDir();
    testEnv.createStub(process, 'cwd').returns(tempDir);
  });
  
  afterEach(async function() {
    await testEnv.cleanup();
  });

  describe('Path Generation', function() {
    it('should generate correct customer directory path', function() {
      const customerIdn = 'acme';
      const result = customerDir(customerIdn);
      const expected = path.posix.join(tempDir, 'newo_customers', 'acme');
      assert.strictEqual(result, expected, 'Should generate correct customer directory path');
    });

    it('should generate correct customer projects directory path', function() {
      const customerIdn = 'globex';
      const result = customerProjectsDir(customerIdn);
      const expected = path.posix.join(tempDir, 'newo_customers', 'globex', 'projects');
      assert.strictEqual(result, expected, 'Should generate correct customer projects path');
    });

    it('should generate correct customer state directory path', function() {
      const customerIdn = 'wayne-enterprises';
      const result = customerStateDir(customerIdn);
      const expected = path.join(tempDir, '.newo', 'wayne-enterprises');
      assert.strictEqual(result, expected, 'Should generate correct customer state path');
    });

    it('should generate correct map file path', function() {
      const customerIdn = 'stark-industries';
      const result = mapPath(customerIdn);
      const expected = path.join(tempDir, '.newo', 'stark-industries', 'map.json');
      assert.strictEqual(result, expected, 'Should generate correct map file path');
    });

    it('should generate correct hashes file path', function() {
      const customerIdn = 'umbrella-corp';
      const result = hashesPath(customerIdn);
      const expected = path.join(tempDir, '.newo', 'umbrella-corp', 'hashes.json');
      assert.strictEqual(result, expected, 'Should generate correct hashes file path');
    });

    it('should generate correct project directory path', function() {
      const customerIdn = 'oscorp';
      const projectIdn = 'spider-project';
      const result = projectDir(customerIdn, projectIdn);
      const expected = path.posix.join(tempDir, 'newo_customers', 'oscorp', 'projects', 'spider-project');
      assert.strictEqual(result, expected, 'Should generate correct project directory path');
    });

    it('should generate correct flows.yaml path', function() {
      const customerIdn = 'lexcorp';
      const result = flowsYamlPath(customerIdn);
      const expected = path.posix.join(tempDir, 'newo_customers', 'lexcorp', 'projects', 'flows.yaml');
      assert.strictEqual(result, expected, 'Should generate correct flows.yaml path');
    });

    it('should generate correct metadata path', function() {
      const customerIdn = 'daily-planet';
      const projectIdn = 'news-project';
      const result = metadataPath(customerIdn, projectIdn);
      const expected = path.posix.join(tempDir, 'newo_customers', 'daily-planet', 'projects', 'news-project', 'metadata.json');
      assert.strictEqual(result, expected, 'Should generate correct metadata path');
    });
  });

  describe('Skill Path Generation', function() {
    it('should generate correct skill path for guidance runner', function() {
      const result = skillPath('acme', 'project1', 'agent1', 'flow1', 'skill1', 'guidance');
      const expected = path.posix.join(tempDir, 'newo_customers', 'acme', 'projects', 'project1', 'agent1', 'flow1', 'skill1.guidance');
      assert.strictEqual(result, expected, 'Should generate correct guidance skill path');
    });

    it('should generate correct skill path for nsl runner', function() {
      const result = skillPath('globex', 'project2', 'agent2', 'flow2', 'skill2', 'nsl');
      const expected = path.posix.join(tempDir, 'newo_customers', 'globex', 'projects', 'project2', 'agent2', 'flow2', 'skill2.jinja');
      assert.strictEqual(result, expected, 'Should generate correct nsl skill path');
    });

    it('should default to guidance extension when no runner type specified', function() {
      const result = skillPath('waynetech', 'batproject', 'batman', 'detect-crime', 'analyze-evidence');
      const expected = path.posix.join(tempDir, 'newo_customers', 'waynetech', 'projects', 'batproject', 'batman', 'detect-crime', 'analyze-evidence.guidance');
      assert.strictEqual(result, expected, 'Should default to guidance extension');
    });

    it('should handle special characters in identifiers', function() {
      const result = skillPath('test-customer', 'my-project', 'ai-agent', 'workflow-flow', 'skill_with_underscores', 'guidance');
      assert(result.includes('test-customer'), 'Should handle hyphens in customer');
      assert(result.includes('my-project'), 'Should handle hyphens in project');
      assert(result.includes('ai-agent'), 'Should handle hyphens in agent');
      assert(result.includes('workflow-flow'), 'Should handle hyphens in flow');
      assert(result.includes('skill_with_underscores.guidance'), 'Should handle underscores in skill');
    });
  });

  describe('Directory Initialization', function() {
    it('should create all required directories', async function() {
      const customerIdn = 'test-customer';
      
      await ensureState(customerIdn);
      
      // Verify main state directory exists
      const stateExists = await fs.pathExists(path.join(tempDir, '.newo'));
      assert(stateExists, 'Main state directory should be created');
      
      // Verify customer state directory exists
      const customerStateExists = await fs.pathExists(path.join(tempDir, '.newo', customerIdn));
      assert(customerStateExists, 'Customer state directory should be created');
      
      // Verify customer projects directory exists
      const customerProjectsExists = await fs.pathExists(path.join(tempDir, 'newo_customers', customerIdn, 'projects'));
      assert(customerProjectsExists, 'Customer projects directory should be created');
    });

    it('should handle existing directories gracefully', async function() {
      const customerIdn = 'existing-customer';
      
      // Pre-create some directories
      await fs.ensureDir(path.join(tempDir, '.newo'));
      
      // Should not throw error
      await ensureState(customerIdn);
      
      // All directories should still exist
      const stateExists = await fs.pathExists(path.join(tempDir, '.newo', customerIdn));
      assert(stateExists, 'Should handle existing directories');
    });

    it('should handle multiple customers', async function() {
      const customers = ['customer1', 'customer2', 'customer3'];
      
      // Initialize all customers
      for (const customer of customers) {
        await ensureState(customer);
      }
      
      // Verify all customer directories exist
      for (const customer of customers) {
        const customerStateExists = await fs.pathExists(path.join(tempDir, '.newo', customer));
        const customerProjectsExists = await fs.pathExists(path.join(tempDir, 'newo_customers', customer, 'projects'));
        
        assert(customerStateExists, `Customer ${customer} state directory should exist`);
        assert(customerProjectsExists, `Customer ${customer} projects directory should exist`);
      }
    });
  });

  describe('Safe File Writing', function() {
    it('should write file and create directories', async function() {
      const filePath = path.join(tempDir, 'deep', 'nested', 'path', 'test.txt');
      const content = 'Test content for safe file writing';
      
      await writeFileSafe(filePath, content);
      
      // Verify file exists
      const exists = await fs.pathExists(filePath);
      assert(exists, 'File should be created');
      
      // Verify content
      const readContent = await fs.readFile(filePath, 'utf8');
      assert.strictEqual(readContent, content, 'Content should match');
    });

    it('should overwrite existing files', async function() {
      const filePath = path.join(tempDir, 'overwrite-test.txt');
      
      // Write initial content
      await writeFileSafe(filePath, 'Initial content');
      const initialContent = await fs.readFile(filePath, 'utf8');
      assert.strictEqual(initialContent, 'Initial content');
      
      // Overwrite with new content
      await writeFileSafe(filePath, 'New content');
      const newContent = await fs.readFile(filePath, 'utf8');
      assert.strictEqual(newContent, 'New content', 'Should overwrite existing file');
    });

    it('should handle unicode content', async function() {
      const filePath = path.join(tempDir, 'unicode-test.txt');
      const content = '🚀 NEWO CLI with émojis and spëcial characters 中文';
      
      await writeFileSafe(filePath, content);
      
      const readContent = await fs.readFile(filePath, 'utf8');
      assert.strictEqual(readContent, content, 'Should handle unicode content');
    });

    it('should handle empty content', async function() {
      const filePath = path.join(tempDir, 'empty-test.txt');
      const content = '';
      
      await writeFileSafe(filePath, content);
      
      const exists = await fs.pathExists(filePath);
      assert(exists, 'Empty file should be created');
      
      const readContent = await fs.readFile(filePath, 'utf8');
      assert.strictEqual(readContent, '', 'Empty content should be preserved');
    });

    it('should handle permission errors gracefully', async function() {
      const readOnlyDir = path.join(tempDir, 'readonly');
      await fs.ensureDir(readOnlyDir);
      
      // Make directory read-only
      await fs.chmod(readOnlyDir, 0o444);
      
      const filePath = path.join(readOnlyDir, 'test.txt');
      
      try {
        await writeFileSafe(filePath, 'test content');
        assert.fail('Should have thrown permission error');
      } catch (error) {
        assert(error.code === 'EACCES' || error.code === 'EPERM', 'Should throw permission error');
      } finally {
        // Restore permissions for cleanup
        await fs.chmod(readOnlyDir, 0o755);
      }
    });
  });

  describe('Conditional File Reading', function() {
    it('should read existing file', async function() {
      const filePath = path.join(tempDir, 'existing-file.txt');
      const content = 'File content for reading test';
      
      await fs.writeFile(filePath, content, 'utf8');
      
      const result = await readIfExists(filePath);
      assert.strictEqual(result, content, 'Should return file content');
    });

    it('should return null for non-existent file', async function() {
      const filePath = path.join(tempDir, 'non-existent-file.txt');
      
      const result = await readIfExists(filePath);
      assert.strictEqual(result, null, 'Should return null for non-existent file');
    });

    it('should handle empty files', async function() {
      const filePath = path.join(tempDir, 'empty-file.txt');
      await fs.writeFile(filePath, '', 'utf8');
      
      const result = await readIfExists(filePath);
      assert.strictEqual(result, '', 'Should return empty string for empty file');
    });

    it('should handle unicode content', async function() {
      const filePath = path.join(tempDir, 'unicode-file.txt');
      const content = '🎯 Test with émojis and 中文 characters';
      
      await fs.writeFile(filePath, content, 'utf8');
      
      const result = await readIfExists(filePath);
      assert.strictEqual(result, content, 'Should handle unicode content');
    });

    it('should handle file read errors', async function() {
      const filePath = path.join(tempDir, 'permission-test.txt');
      await fs.writeFile(filePath, 'test content', 'utf8');
      
      // Make file unreadable
      await fs.chmod(filePath, 0o000);
      
      try {
        const result = await readIfExists(filePath);
        
        // On some systems, this might still work or return null
        // The important thing is it doesn't crash
        assert(result === null || typeof result === 'string', 'Should handle gracefully');
      } catch (error) {
        // Permission error is acceptable
        assert(error.code === 'EACCES' || error.code === 'EPERM', 'Should be permission error');
      } finally {
        // Restore permissions for cleanup
        await fs.chmod(filePath, 0o644);
      }
    });
  });

  describe('Legacy Path Support', function() {
    it('should provide legacy constants', function() {
      assert.strictEqual(ROOT_DIR, path.posix.join(tempDir, 'projects'), 'ROOT_DIR should match expected');
      assert.strictEqual(STATE_DIR, path.join(tempDir, '.newo'), 'STATE_DIR should match expected');
      assert.strictEqual(MAP_PATH, path.join(tempDir, '.newo', 'map.json'), 'MAP_PATH should match expected');
      assert.strictEqual(HASHES_PATH, path.join(tempDir, '.newo', 'hashes.json'), 'HASHES_PATH should match expected');
    });

    it('should maintain consistency between legacy and new paths', function() {
      const customerIdn = 'test-customer';
      
      // New customer state directory should be under legacy STATE_DIR
      const newStateDir = customerStateDir(customerIdn);
      const expectedStateDir = path.join(STATE_DIR, customerIdn);
      
      assert.strictEqual(newStateDir, expectedStateDir, 'Customer state should be under legacy state dir');
    });
  });

  describe('Cross-Platform Compatibility', function() {
    it('should use posix paths for customer directories', function() {
      const customerIdn = 'test-customer';
      const projectIdn = 'test-project';
      
      const customerDirPath = customerDir(customerIdn);
      const projectDirPath = projectDir(customerIdn, projectIdn);
      const skillPathResult = skillPath(customerIdn, projectIdn, 'agent', 'flow', 'skill');
      
      // Should use forward slashes regardless of platform
      assert(customerDirPath.includes('/'), 'Customer dir should use posix separators');
      assert(projectDirPath.includes('/'), 'Project dir should use posix separators');
      assert(skillPathResult.includes('/'), 'Skill path should use posix separators');
    });

    it('should use native paths for state directories', function() {
      const customerIdn = 'test-customer';
      
      const statePath = customerStateDir(customerIdn);
      const mapFilePath = mapPath(customerIdn);
      const hashesFilePath = hashesPath(customerIdn);
      
      // These should use native path separator for the platform
      // We just verify they're consistent with path.join behavior
      const expectedStatePath = path.join(STATE_DIR, customerIdn);
      
      assert.strictEqual(statePath, expectedStatePath, 'State paths should use native separators');
    });
  });
});