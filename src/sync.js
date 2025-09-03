/**
 * NEWO Sync Module - Refactored Version
 * Enhanced with infrastructure integration, multi-project support, and comprehensive monitoring
 */
import { listProjects, listAgents, listFlowSkills, updateSkill, listFlowEvents, listFlowStates, getProjectMeta } from './api.js';
import { getDirectories } from './config.js';
import { logger } from './logger.js';
import { performanceMonitor } from './performance.js';
import { Validator } from './validation.js';
import { NewoError, SyncError } from './errors.js';
import fs from 'fs-extra';
import path from 'path';
import yaml from 'js-yaml';
import crypto from 'crypto';

/**
 * Enhanced file system utilities for projects structure
 */
class ProjectFileManager {
  constructor() {
    this.dirs = getDirectories();
  }

  /**
   * Get project directory path
   */
  getProjectDir(projectIdn) {
    return path.join(this.dirs.root, projectIdn);
  }

  /**
   * Get project metadata path
   */
  getMetadataPath(projectIdn) {
    return path.join(this.getProjectDir(projectIdn), 'metadata.json');
  }

  /**
   * Get flows.yaml path
   */
  getFlowsYamlPath(projectIdn) {
    return path.join(this.getProjectDir(projectIdn), 'flows.yaml');
  }

  /**
   * Get skill file path
   */
  getSkillPath(projectIdn, agentIdn, flowIdn, skillIdn, runnerType) {
    const extension = runnerType === 'nsl' ? '.jinja' : '.guidance';
    return path.join(
      this.getProjectDir(projectIdn),
      agentIdn,
      flowIdn,
      `${skillIdn}${extension}`
    );
  }

  /**
   * Get project map path
   */
  getMapPath(projectIdn) {
    return path.join(this.getProjectDir(projectIdn), '.newo', 'map.json');
  }

  /**
   * Get project hashes path
   */
  getHashesPath(projectIdn) {
    return path.join(this.getProjectDir(projectIdn), '.newo', 'hashes.json');
  }

  /**
   * Ensure project directory structure exists
   */
  async ensureProjectDir(projectIdn) {
    const projectDir = this.getProjectDir(projectIdn);
    const newoDir = path.join(projectDir, '.newo');
    
    await fs.ensureDir(projectDir);
    await fs.ensureDir(newoDir);
    
    return projectDir;
  }

  /**
   * Write file atomically with directory creation
   */
  async writeFileAtomic(filePath, content) {
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, content, 'utf8');
  }

  /**
   * Read file if it exists
   */
  async readIfExists(filePath) {
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
}

/**
 * Enhanced hash management for change detection
 */
class HashManager {
  constructor(fileManager) {
    this.fileManager = fileManager;
  }

  /**
   * Calculate SHA256 hash of content
   */
  sha256(content) {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  }

  /**
   * Load project hashes
   */
  async loadHashes(projectIdn) {
    try {
      const hashesPath = this.fileManager.getHashesPath(projectIdn);
      const hashesContent = await this.fileManager.readIfExists(hashesPath);
      return hashesContent ? JSON.parse(hashesContent) : {};
    } catch (error) {
      await logger.warn('Failed to load hashes', { projectIdn, error: error.message });
      return {};
    }
  }

  /**
   * Save project hashes
   */
  async saveHashes(projectIdn, hashes) {
    const hashesPath = this.fileManager.getHashesPath(projectIdn);
    await this.fileManager.writeFileAtomic(hashesPath, JSON.stringify(hashes, null, 2));
  }

  /**
   * Calculate current hashes for all project files
   */
  async calculateCurrentHashes(projectIdn) {
    const projectDir = this.fileManager.getProjectDir(projectIdn);
    const hashes = {};
    
    try {
      const files = await this.findSkillFiles(projectDir);
      
      for (const file of files) {
        const content = await this.fileManager.readIfExists(file);
        if (content !== null) {
          const relativePath = path.relative(projectDir, file);
          hashes[relativePath] = this.sha256(content);
        }
      }
    } catch (error) {
      await logger.error('Failed to calculate hashes', { projectIdn, error: error.message });
      throw new SyncError(`Failed to calculate hashes for ${projectIdn}`, 'HASH_CALCULATION_ERROR', projectIdn);
    }
    
    return hashes;
  }

  /**
   * Find all skill files in project directory
   */
  async findSkillFiles(projectDir) {
    const files = [];
    
    try {
      const entries = await fs.readdir(projectDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const agentDir = path.join(projectDir, entry.name);
          const flows = await fs.readdir(agentDir, { withFileTypes: true });
          
          for (const flow of flows) {
            if (flow.isDirectory()) {
              const flowDir = path.join(agentDir, flow.name);
              const skills = await fs.readdir(flowDir);
              
              for (const skill of skills) {
                if (skill.endsWith('.guidance') || skill.endsWith('.jinja')) {
                  files.push(path.join(flowDir, skill));
                }
              }
            }
          }
        }
      }
    } catch (error) {
      // Directory might not exist yet
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
    
    return files;
  }

  /**
   * Detect changes between saved and current hashes
   */
  async detectChanges(projectIdn) {
    const savedHashes = await this.loadHashes(projectIdn);
    const currentHashes = await this.calculateCurrentHashes(projectIdn);
    
    const changes = {
      modified: [],
      added: [],
      deleted: []
    };
    
    // Find modified and added files
    for (const [file, hash] of Object.entries(currentHashes)) {
      if (savedHashes[file]) {
        if (savedHashes[file] !== hash) {
          changes.modified.push(file);
        }
      } else {
        changes.added.push(file);
      }
    }
    
    // Find deleted files
    for (const file of Object.keys(savedHashes)) {
      if (!currentHashes[file]) {
        changes.deleted.push(file);
      }
    }
    
    return {
      changes,
      hasChanges: changes.modified.length > 0 || changes.added.length > 0 || changes.deleted.length > 0
    };
  }
}

/**
 * Project mapping manager
 */
class ProjectMapManager {
  constructor(fileManager) {
    this.fileManager = fileManager;
  }

  /**
   * Load project map
   */
  async loadMap(projectIdn) {
    try {
      const mapPath = this.fileManager.getMapPath(projectIdn);
      const mapContent = await this.fileManager.readIfExists(mapPath);
      return mapContent ? JSON.parse(mapContent) : null;
    } catch (error) {
      await logger.warn('Failed to load project map', { projectIdn, error: error.message });
      return null;
    }
  }

  /**
   * Save project map
   */
  async saveMap(projectIdn, map) {
    const mapPath = this.fileManager.getMapPath(projectIdn);
    await this.fileManager.writeFileAtomic(mapPath, JSON.stringify(map, null, 2));
  }

  /**
   * Build project map from API data
   */
  buildProjectMap(projectId, projectIdn, agents) {
    const projectMap = {
      projectId,
      projectIdn,
      lastUpdated: new Date().toISOString(),
      agents: {}
    };

    for (const agent of agents) {
      const aKey = agent.idn;
      projectMap.agents[aKey] = {
        id: agent.id,
        idn: agent.idn,
        flows: {}
      };

      for (const flow of agent.flows ?? []) {
        projectMap.agents[aKey].flows[flow.idn] = {
          id: flow.id,
          idn: flow.idn,
          skills: {}
        };
      }
    }

    return projectMap;
  }

  /**
   * Add skill to project map
   */
  addSkillToMap(map, agentIdn, flowIdn, skill) {
    if (!map.agents[agentIdn]) {
      map.agents[agentIdn] = { flows: {} };
    }
    if (!map.agents[agentIdn].flows[flowIdn]) {
      map.agents[agentIdn].flows[flowIdn] = { skills: {} };
    }
    
    map.agents[agentIdn].flows[flowIdn].skills[skill.idn] = {
      id: skill.id,
      title: skill.title,
      idn: skill.idn,
      runner_type: skill.runner_type,
      model: skill.model,
      parameters: skill.parameters,
      path: skill.path
    };
  }
}

/**
 * Enhanced sync operations with comprehensive monitoring and error handling
 */
class SyncManager {
  constructor() {
    this.fileManager = new ProjectFileManager();
    this.hashManager = new HashManager(this.fileManager);
    this.mapManager = new ProjectMapManager(this.fileManager);
  }

  /**
   * Pull single project with enhanced monitoring
   */
  async pullSingleProject(client, projectId, projectIdn, verbose = false) {
    const timer = performanceMonitor.startTimer(`sync_pull_${projectIdn}`);
    
    try {
      if (verbose) await logger.info('Starting single project pull', { projectId, projectIdn });
      
      // Ensure project directory exists
      await this.fileManager.ensureProjectDir(projectIdn);
      
      // Fetch agents
      if (verbose) console.log(`🔍 Fetching agents for project ${projectId} (${projectIdn})...`);
      const agents = await listAgents(client, projectId);
      if (verbose) console.log(`📦 Found ${agents.length} agents`);
      
      // Get and save project metadata
      const projectMeta = await getProjectMeta(client, projectId);
      const metadataPath = this.fileManager.getMetadataPath(projectIdn);
      await this.fileManager.writeFileAtomic(metadataPath, JSON.stringify(projectMeta, null, 2));
      if (verbose) console.log(`✓ Saved metadata for ${projectIdn}`);
      
      // Build project map
      const projectMap = this.mapManager.buildProjectMap(projectId, projectIdn, agents);
      
      // Pull skills for each agent/flow
      let totalSkills = 0;
      for (const agent of agents) {
        const aKey = agent.idn;
        
        for (const flow of agent.flows ?? []) {
          const skills = await listFlowSkills(client, flow.id);
          totalSkills += skills.length;
          
          for (const skill of skills) {
            const skillPath = this.fileManager.getSkillPath(
              projectIdn, 
              agent.idn, 
              flow.idn, 
              skill.idn, 
              skill.runner_type
            );
            
            await this.fileManager.writeFileAtomic(skillPath, skill.prompt_script || '');
            
            // Add to project map
            this.mapManager.addSkillToMap(projectMap, aKey, flow.idn, skill);
            
            console.log(`✓ Pulled ${skillPath}`);
          }
        }
      }
      
      // Save project map
      await this.mapManager.saveMap(projectIdn, projectMap);
      
      // Calculate and save hashes
      const hashes = await this.hashManager.calculateCurrentHashes(projectIdn);
      await this.hashManager.saveHashes(projectIdn, hashes);
      
      // Generate flows.yaml
      if (verbose) console.log(`📄 Generating flows.yaml for ${projectIdn}...`);
      await this.generateFlowsYaml(client, agents, projectIdn, verbose);
      
      const metrics = performanceMonitor.endTimer(`sync_pull_${projectIdn}`);
      if (verbose) {
        await logger.info('Single project pull completed', {
          projectIdn,
          agentCount: agents.length,
          skillCount: totalSkills,
          duration: metrics?.duration || 0
        });
      }
      
      return projectMap;
      
    } catch (error) {
      performanceMonitor.endTimer(`sync_pull_${projectIdn}`);
      await logger.error('Single project pull failed', {
        projectIdn,
        error: error.message,
        stack: error.stack
      });
      throw new SyncError(`Failed to pull project ${projectIdn}`, 'PULL_ERROR', projectIdn, error);
    }
  }

  /**
   * Pull all accessible projects
   */
  async pullAll(client, specificProjectId = null, verbose = false) {
    const timer = performanceMonitor.startTimer('sync_pull_all');
    
    try {
      if (verbose) await logger.info('Starting pull all operation', { specificProjectId });
      
      let projects;
      if (specificProjectId) {
        // Get single project metadata to construct project list
        const projectMeta = await getProjectMeta(client, specificProjectId);
        projects = [{
          id: specificProjectId,
          idn: projectMeta.idn
        }];
      } else {
        // Get all accessible projects
        projects = await listProjects(client);
      }
      
      if (verbose) console.log(`🌍 Found ${projects.length} accessible project(s)`);
      
      const results = [];
      for (const project of projects) {
        try {
          const projectMap = await this.pullSingleProject(client, project.id, project.idn, verbose);
          results.push({ project: project.idn, success: true, map: projectMap });
        } catch (error) {
          await logger.error('Project pull failed', {
            projectId: project.id,
            projectIdn: project.idn,
            error: error.message
          });
          results.push({ project: project.idn, success: false, error: error.message });
        }
      }
      
      const metrics = performanceMonitor.endTimer('sync_pull_all');
      const successful = results.filter(r => r.success).length;
      const failed = projects.length - successful;
      
      await logger.info('Pull all operation completed', {
        totalProjects: projects.length,
        successful,
        failed,
        duration: metrics?.duration || 0
      });
      
      // If any projects failed, throw an error to indicate overall failure
      if (failed > 0) {
        const failedProjects = results.filter(r => !r.success);
        const errorDetails = failedProjects.map(p => `${p.project}: ${p.error}`).join(', ');
        throw new SyncError(
          `Pull failed for ${failed} project(s): ${errorDetails}`, 
          'PULL_PARTIAL_FAILURE', 
          null, 
          null,
          { results, failedCount: failed, successCount: successful }
        );
      }
      
      return results;
      
    } catch (error) {
      performanceMonitor.endTimer('sync_pull_all');
      await logger.error('Pull all operation failed', {
        error: error.message,
        stack: error.stack
      });
      throw new SyncError('Failed to pull projects', 'PULL_ALL_ERROR', null, error);
    }
  }

  /**
   * Push changed files for all projects
   */
  async pushChanged(client, verbose = false) {
    const timer = performanceMonitor.startTimer('sync_push_changed');
    
    try {
      await logger.info('Starting push changed operation');
      
      // Find all project directories
      const projectsDir = this.fileManager.dirs.root;
      if (!await fs.pathExists(projectsDir)) {
        throw new SyncError('No projects directory found. Run pull first.', 'NO_PROJECTS_DIR');
      }
      
      const projectDirs = await fs.readdir(projectsDir, { withFileTypes: true });
      const projects = projectDirs.filter(d => d.isDirectory()).map(d => d.name);
      
      if (projects.length === 0) {
        throw new SyncError('No projects found. Run pull first.', 'NO_PROJECTS');
      }
      
      let totalChanges = 0;
      const results = [];
      
      for (const projectIdn of projects) {
        try {
          const changesResult = await this.pushProjectChanges(client, projectIdn, verbose);
          results.push({
            project: projectIdn,
            success: true,
            changes: changesResult.totalChanges
          });
          totalChanges += changesResult.totalChanges;
        } catch (error) {
          await logger.error('Project push failed', {
            projectIdn,
            error: error.message
          });
          results.push({
            project: projectIdn,
            success: false,
            error: error.message
          });
        }
      }
      
      const metrics = performanceMonitor.endTimer('sync_push_changed');
      const successful = results.filter(r => r.success).length;
      
      await logger.info('Push changed operation completed', {
        totalProjects: projects.length,
        successful,
        failed: projects.length - successful,
        totalChanges,
        duration: metrics?.duration || 0
      });
      
      if (totalChanges === 0) {
        console.log('No changes detected.');
      } else {
        console.log(`✓ Pushed ${totalChanges} changes across ${successful} projects`);
      }
      
      return results;
      
    } catch (error) {
      performanceMonitor.endTimer('sync_push_changed');
      await logger.error('Push changed operation failed', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Push changes for a specific project
   */
  async pushProjectChanges(client, projectIdn, verbose = false) {
    const timer = performanceMonitor.startTimer(`sync_push_${projectIdn}`);
    
    try {
      // Load project map
      const projectMap = await this.mapManager.loadMap(projectIdn);
      if (!projectMap) {
        throw new SyncError(`No project map found for ${projectIdn}. Run pull first.`, 'NO_PROJECT_MAP', projectIdn);
      }
      
      // Detect changes
      const { changes, hasChanges } = await this.hashManager.detectChanges(projectIdn);
      
      if (!hasChanges) {
        if (verbose) console.log(`No changes detected in ${projectIdn}`);
        return { projectIdn, totalChanges: 0 };
      }
      
      await logger.info('Project changes detected', {
        projectIdn,
        modified: changes.modified.length,
        added: changes.added.length,
        deleted: changes.deleted.length
      });
      
      let pushedCount = 0;
      const projectDir = this.fileManager.getProjectDir(projectIdn);
      
      // Process modified and added files
      for (const filePath of [...changes.modified, ...changes.added]) {
        const fullPath = path.join(projectDir, filePath);
        const content = await this.fileManager.readIfExists(fullPath);
        
        if (content === null) continue;
        
        // Parse file path to extract skill info
        const pathParts = filePath.split(path.sep);
        if (pathParts.length !== 3) continue;
        
        const [agentIdn, flowIdn, skillFile] = pathParts;
        const skillIdn = path.parse(skillFile).name;
        
        // Find skill in project map
        const skill = projectMap.agents[agentIdn]?.flows[flowIdn]?.skills[skillIdn];
        if (!skill) {
          await logger.warn('Skill not found in map', { projectIdn, filePath, skillIdn });
          continue;
        }
        
        // Update skill
        const updatedSkill = {
          ...skill,
          prompt_script: content
        };
        
        await updateSkill(client, updatedSkill);
        
        if (verbose) console.log(`✓ Pushed ${filePath}`);
        pushedCount++;
      }
      
      // Save updated hashes
      const newHashes = await this.hashManager.calculateCurrentHashes(projectIdn);
      await this.hashManager.saveHashes(projectIdn, newHashes);
      
      const metrics = performanceMonitor.endTimer(`sync_push_${projectIdn}`);
      
      await logger.info('Project push completed', {
        projectIdn,
        pushedCount,
        duration: metrics?.duration || 0
      });
      
      return { projectIdn, totalChanges: pushedCount };
      
    } catch (error) {
      performanceMonitor.endTimer(`sync_push_${projectIdn}`);
      throw new SyncError(`Failed to push changes for ${projectIdn}`, 'PUSH_PROJECT_ERROR', projectIdn, error);
    }
  }

  /**
   * Get status for all projects
   */
  async status(verbose = false) {
    const timer = performanceMonitor.startTimer('sync_status');
    
    try {
      if (verbose) await logger.info('Starting status check');
      
      // Find all project directories
      const projectsDir = this.fileManager.dirs.root;
      if (!await fs.pathExists(projectsDir)) {
        console.log('No projects directory found. Run `newo pull` first.');
        return null;
      }
      
      const projectDirs = await fs.readdir(projectsDir, { withFileTypes: true });
      const projects = projectDirs.filter(d => d.isDirectory()).map(d => d.name);
      
      if (projects.length === 0) {
        console.log('No projects found. Run `newo pull` first.');
        return null;
      }
      
      const results = {};
      let totalChanges = 0;
      
      for (const projectIdn of projects) {
        try {
          const projectMap = await this.mapManager.loadMap(projectIdn);
          if (!projectMap) {
            results[projectIdn] = { error: 'No map found' };
            continue;
          }
          
          const { changes, hasChanges } = await this.hashManager.detectChanges(projectIdn);
          results[projectIdn] = {
            hasChanges,
            modified: changes.modified,
            added: changes.added,
            deleted: changes.deleted,
            totalChanges: changes.modified.length + changes.added.length + changes.deleted.length
          };
          
          totalChanges += results[projectIdn].totalChanges;
          
          if (hasChanges && verbose) {
            console.log(`\n${projectIdn}:`);
            if (changes.modified.length > 0) {
              console.log(`  Modified (${changes.modified.length}):`);
              changes.modified.forEach(f => console.log(`    M ${f}`));
            }
            if (changes.added.length > 0) {
              console.log(`  Added (${changes.added.length}):`);
              changes.added.forEach(f => console.log(`    A ${f}`));
            }
            if (changes.deleted.length > 0) {
              console.log(`  Deleted (${changes.deleted.length}):`);
              changes.deleted.forEach(f => console.log(`    D ${f}`));
            }
          }
        } catch (error) {
          results[projectIdn] = { error: error.message };
          await logger.error('Status check failed for project', {
            projectIdn,
            error: error.message
          });
        }
      }
      
      const metrics = performanceMonitor.endTimer('sync_status');
      
      if (verbose) {
        await logger.info('Status check completed', {
          projectCount: projects.length,
          totalChanges,
          duration: metrics?.duration || 0
        });
      }
      
      if (totalChanges === 0) {
        console.log('Clean.');
      } else {
        console.log(`\n${totalChanges} files have changes across ${Object.keys(results).length} projects.`);
      }
      
      return results;
      
    } catch (error) {
      performanceMonitor.endTimer('sync_status');
      await logger.error('Status operation failed', {
        error: error.message,
        stack: error.stack
      });
      throw new SyncError('Failed to check status', 'STATUS_ERROR', null, error);
    }
  }

  /**
   * Generate flows.yaml for a project
   */
  async generateFlowsYaml(client, agents, projectIdn, verbose = false) {
    try {
      const flows = {};
      
      for (const agent of agents) {
        for (const flow of agent.flows ?? []) {
          const flowKey = `${agent.idn}:${flow.idn}`;
          
          // Get events and states
          let events = [];
          let states = [];
          
          try {
            events = await listFlowEvents(client, flow.id);
            states = await listFlowStates(client, flow.id);
          } catch (error) {
            await logger.warn('Failed to fetch flow metadata', {
              projectIdn,
              flowId: flow.id,
              error: error.message
            });
          }
          
          // Ensure events and states are arrays
          events = Array.isArray(events) ? events : [];
          states = Array.isArray(states) ? states : [];
          
          flows[flowKey] = {
            id: flow.id,
            title: flow.title,
            idn: flow.idn,
            agent: {
              id: agent.id,
              idn: agent.idn,
              title: agent.title
            },
            events: events.map(e => ({
              id: e.id,
              name: e.name,
              description: e.description
            })),
            states: states.map(s => ({
              id: s.id,
              name: s.name,
              type: s.type,
              description: s.description
            }))
          };
        }
      }
      
      const yamlPath = this.fileManager.getFlowsYamlPath(projectIdn);
      const yamlContent = yaml.dump(flows, { indent: 2, lineWidth: -1 });
      await this.fileManager.writeFileAtomic(yamlPath, yamlContent);
      
      console.log(`✓ Generated flows.yaml for ${projectIdn}`);
      
    } catch (error) {
      await logger.error('Failed to generate flows.yaml', {
        projectIdn,
        error: error.message,
        stack: error.stack
      });
      throw error; // flows.yaml generation failure should cause pull to fail
    }
  }
}

// Create singleton instance
const syncManager = new SyncManager();

/**
 * Export functions that match the original sync module API
 */
export async function pullSingleProject(client, projectId, projectIdn, verbose = false) {
  return syncManager.pullSingleProject(client, projectId, projectIdn, verbose);
}

export async function pullAll(client, projectId = null, verbose = false) {
  return syncManager.pullAll(client, projectId, verbose);
}

export async function pushChanged(client, verbose = false) {
  return syncManager.pushChanged(client, verbose);
}

export async function status(verbose = false) {
  return syncManager.status(verbose);
}

// Export enhanced classes for advanced usage
export {
  SyncManager,
  ProjectFileManager,
  HashManager,
  ProjectMapManager
};