/**
 * Unit tests for sync functions
 */
import assert from 'assert';
import fs from 'fs-extra';
import path from 'path';
import { pullAll, status } from '../dist/sync.js';
import { makeClient } from '../dist/api.js';
import { ROOT_DIR, STATE_DIR } from '../dist/fsutil.js';

describe('Sync Functions', function() {
  this.timeout(30000); // Set longer timeout for sync operations

  let client;
  const testDir = path.join(process.cwd(), 'test-projects');
  const testStateDir = path.join(process.cwd(), '.test-newo');

  before(async function() {
    client = await makeClient();
    
    // Clean up any existing test directories
    await fs.remove(testDir);
    await fs.remove(testStateDir);
  });

  after(async function() {
    // Clean up test directories
    await fs.remove(testDir);
    await fs.remove(testStateDir);
  });

  describe('Multi-project Pull', function() {
    it('should pull all projects when no PROJECT_ID specified', async function() {
      // Temporarily override ROOT_DIR and STATE_DIR for testing
      const originalCwd = process.cwd();
      process.chdir(path.dirname(testDir));
      
      try {
        await pullAll(client, null, false); // null means pull all projects
        
        // Check that projects directory was created
        const projectsExist = await fs.pathExists(path.join(path.dirname(testDir), 'projects'));
        assert(projectsExist, 'Projects directory should be created');
        
        // Check for at least one project subfolder
        const projectDirs = await fs.readdir(path.join(path.dirname(testDir), 'projects'));
        assert(projectDirs.length > 0, 'Should have at least one project directory');
        
        // Check for metadata.json in each project
        for (const projectDir of projectDirs) {
          const metadataPath = path.join(path.dirname(testDir), 'projects', projectDir, 'metadata.json');
          const metadataExists = await fs.pathExists(metadataPath);
          assert(metadataExists, `metadata.json should exist for project ${projectDir}`);
          
          const metadata = await fs.readJson(metadataPath);
          assert(metadata.id, 'Metadata should have project id');
          assert(metadata.idn, 'Metadata should have project idn');
        }
        
        // Check for .newo state directory
        const stateExists = await fs.pathExists(path.join(path.dirname(testDir), '.newo'));
        assert(stateExists, '.newo state directory should be created');
        
        // Check for map.json
        const mapExists = await fs.pathExists(path.join(path.dirname(testDir), '.newo', 'map.json'));
        assert(mapExists, 'map.json should be created');
        
        const mapData = await fs.readJson(path.join(path.dirname(testDir), '.newo', 'map.json'));
        assert(mapData.projects, 'Map should have projects object');
        assert(Object.keys(mapData.projects).length > 0, 'Map should have at least one project');
        
      } finally {
        process.chdir(originalCwd);
        // Clean up test files
        await fs.remove(path.join(path.dirname(testDir), 'projects'));
        await fs.remove(path.join(path.dirname(testDir), '.newo'));
      }
    });
  });

  describe('Single-project Pull', function() {
    it('should pull single project when PROJECT_ID specified', async function() {
      const originalCwd = process.cwd();
      process.chdir(path.dirname(testDir));
      
      try {
        // Use the PROJECT_ID from env
        const projectId = process.env.NEWO_PROJECT_ID;
        assert(projectId, 'NEWO_PROJECT_ID should be set for this test');
        
        await pullAll(client, projectId, false);
        
        // Check that projects directory was created
        const projectsExist = await fs.pathExists(path.join(path.dirname(testDir), 'projects'));
        assert(projectsExist, 'Projects directory should be created');
        
        // Should have exactly one project
        const projectDirs = await fs.readdir(path.join(path.dirname(testDir), 'projects'));
        assert(projectDirs.length === 1, 'Should have exactly one project directory');
        
        // Check map structure for single project
        const mapData = await fs.readJson(path.join(path.dirname(testDir), '.newo', 'map.json'));
        assert(mapData.projects, 'Map should have projects object');
        assert(Object.keys(mapData.projects).length === 1, 'Map should have exactly one project');
        
      } finally {
        process.chdir(originalCwd);
        // Clean up test files
        await fs.remove(path.join(path.dirname(testDir), 'projects'));
        await fs.remove(path.join(path.dirname(testDir), '.newo'));
      }
    });
  });
});