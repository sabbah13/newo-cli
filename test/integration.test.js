/**
 * Integration tests for end-to-end functionality
 */
import assert from 'assert';
import fs from 'fs-extra';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

describe('CLI Integration Tests', function() {
  this.timeout(60000); // Set very long timeout for full CLI operations

  const testDir = path.join(process.cwd(), 'test-integration');

  before(async function() {
    // Clean up any existing test directory
    await fs.remove(testDir);
    await fs.ensureDir(testDir);
  });

  after(async function() {
    // Clean up test directory
    await fs.remove(testDir);
  });

  describe('Multi-project CLI workflow', function() {
    it('should perform full pull -> status -> push cycle', async function() {
      const originalCwd = process.cwd();
      
      try {
        process.chdir(testDir);
        
        // Copy .env file to test directory
        await fs.copy(path.join(originalCwd, '.env'), path.join(testDir, '.env'));
        
        // Temporarily remove PROJECT_ID for multi-project test
        let envContent = await fs.readFile(path.join(testDir, '.env'), 'utf8');
        envContent = envContent.replace(/^NEWO_PROJECT_ID=/m, '# NEWO_PROJECT_ID=');
        await fs.writeFile(path.join(testDir, '.env'), envContent);
        
        // Step 1: Pull all projects
        console.log('  → Testing pull command...');
        const pullResult = await execAsync(`node ${path.join(originalCwd, 'dist/cli.js')} pull`);
        assert(!pullResult.stderr || pullResult.stderr.length === 0, 'Pull should not have errors');
        
        // Verify projects were created
        const projectsExist = await fs.pathExists(path.join(testDir, 'projects'));
        assert(projectsExist, 'Projects directory should be created');
        
        const projectDirs = await fs.readdir(path.join(testDir, 'projects'));
        assert(projectDirs.length > 0, 'Should have at least one project');
        
        // Step 2: Check status (should be clean)
        console.log('  → Testing status command...');
        const statusResult = await execAsync(`node ${path.join(originalCwd, 'dist/cli.js')} status`);
        assert(statusResult.stdout.includes('Clean'), 'Status should show clean after pull');
        
        // Step 3: Make a test change
        console.log('  → Making test change...');
        const firstProject = projectDirs[0];
        const projectPath = path.join(testDir, 'projects', firstProject);
        
        // Find a .guidance or .jinja file to modify
        const files = await fs.readdir(projectPath, { recursive: true });
        const guidanceFile = files.find(f => f.endsWith('.guidance'));
        
        if (guidanceFile) {
          const fullPath = path.join(projectPath, guidanceFile);
          const content = await fs.readFile(fullPath, 'utf8');
          await fs.writeFile(fullPath, content + '\n// Test comment');
          
          // Step 4: Check status again (should show change)
          console.log('  → Testing status after change...');
          const statusResult2 = await execAsync(`node ${path.join(originalCwd, 'dist/cli.js')} status`);
          assert(statusResult2.stdout.includes('1 changed file'), 'Status should show 1 changed file');
          
          // Step 5: Push the change
          console.log('  → Testing push command...');
          const pushResult = await execAsync(`node ${path.join(originalCwd, 'dist/cli.js')} push`);
          assert(pushResult.stdout.includes('Push complete'), 'Push should complete successfully');
          
          // Step 6: Check status again (should be clean)
          console.log('  → Testing final status...');
          const statusResult3 = await execAsync(`node ${path.join(originalCwd, 'dist/cli.js')} status`);
          assert(statusResult3.stdout.includes('Clean'), 'Status should be clean after push');
        }
        
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('Help and error handling', function() {
    it('should show help when requested', async function() {
      const helpResult = await execAsync(`node ${path.join(process.cwd(), 'dist/cli.js')} --help`);
      assert(helpResult.stdout.includes('NEWO CLI'), 'Help should show CLI title');
      assert(helpResult.stdout.includes('Usage:'), 'Help should show usage information');
      assert(helpResult.stdout.includes('Multi-Customer'), 'Help should mention multi-customer support');
    });

    it('should handle missing .newo state gracefully', async function() {
      const originalCwd = process.cwd();
      
      try {
        process.chdir(testDir);
        
        // Remove any existing .newo directory
        await fs.remove(path.join(testDir, '.newo'));
        
        // Try status command without .newo directory
        const statusResult = await execAsync(`node ${path.join(originalCwd, 'dist/cli.js')} status`);
        assert(statusResult.stdout.includes('No map') || statusResult.stderr.includes('No map'), 'Should indicate missing map file');
        
      } finally {
        process.chdir(originalCwd);
      }
    });
  });
});