/**
 * ProjectSyncStrategy - Handles synchronization of Projects, Agents, Flows, and Skills
 *
 * This strategy implements ISyncStrategy for the Project resource hierarchy:
 * Project → Agent → Flow → Skill
 *
 * Key responsibilities:
 * - Pull complete project structure from NEWO platform
 * - Push changed skills and new entities to platform
 * - Detect changes using SHA256 hashes
 * - Validate project structure before push
 */

import type {
  ISyncStrategy,
  PullOptions,
  PullResult,
  PushResult,
  ChangeItem,
  ValidationResult,
  ValidationError,
  StatusSummary
} from './ISyncStrategy.js';
import type { CustomerConfig, ILogger, HashStore } from '../../resources/common/types.js';
import type { AxiosInstance } from 'axios';
import type {
  ProjectMeta,
  Agent,
  Flow,
  Skill,
  FlowEvent,
  FlowState,
  ProjectData,
  ProjectMap,
  SkillMetadata,
  FlowMetadata,
  AgentMetadata,
  ProjectMetadata
} from '../../../types.js';
import fs from 'fs-extra';
import yaml from 'js-yaml';
import {
  listProjects,
  listAgents,
  listFlowSkills,
  listFlowEvents,
  listFlowStates,
  updateSkill,
  publishFlow
} from '../../../api.js';
import {
  ensureState,
  writeFileSafe,
  mapPath,
  projectMetadataPath,
  agentMetadataPath,
  flowMetadataPath,
  skillMetadataPath,
  skillScriptPath,
  skillFolderPath,
  flowsYamlPath,
  customerProjectsDir,
  projectDir
} from '../../../fsutil.js';
import { sha256, saveHashes, loadHashes } from '../../../hash.js';
import { generateFlowsYaml } from '../../../sync/metadata.js';
import {
  findSkillScriptFiles,
  isContentDifferent,
  getExtensionForRunner,
  getSingleSkillFile,
  validateSkillFolder
} from '../../../sync/skill-files.js';

/**
 * Project data for local storage
 */
export interface LocalProjectData {
  projectId: string;
  projectIdn: string;
  metadata: ProjectMetadata;
  agents: LocalAgentData[];
}

export interface LocalAgentData {
  id: string;
  idn: string;
  metadata: AgentMetadata;
  flows: LocalFlowData[];
}

export interface LocalFlowData {
  id: string;
  idn: string;
  metadata: FlowMetadata;
  skills: LocalSkillData[];
}

export interface LocalSkillData {
  id: string;
  idn: string;
  metadata: SkillMetadata;
  scriptPath: string;
  scriptContent: string;
}

/**
 * API client factory type
 */
export type ApiClientFactory = (customer: CustomerConfig, verbose: boolean) => Promise<AxiosInstance>;

/**
 * ProjectSyncStrategy - Handles project synchronization
 */
export class ProjectSyncStrategy implements ISyncStrategy<ProjectMeta, LocalProjectData> {
  readonly resourceType = 'projects';
  readonly displayName = 'Projects';

  constructor(
    private apiClientFactory: ApiClientFactory,
    private logger: ILogger
  ) {}

  /**
   * Pull all projects from NEWO platform
   */
  async pull(customer: CustomerConfig, options: PullOptions = {}): Promise<PullResult<LocalProjectData>> {
    const client = await this.apiClientFactory(customer, options.verbose ?? false);
    const hashes: HashStore = {};
    const projects: LocalProjectData[] = [];

    this.logger.verbose(`📋 Loading project list for customer ${customer.idn}...`);

    await ensureState(customer.idn);

    // Fetch projects
    const apiProjects = options.projectId
      ? [{ id: options.projectId, idn: 'unknown', title: 'Project' } as ProjectMeta]
      : await listProjects(client);

    if (apiProjects.length === 0) {
      this.logger.info(`No projects found for customer ${customer.idn}`);
      return { items: [], count: 0, hashes: {} };
    }

    // Load existing map for reference
    let existingMap: ProjectMap = { projects: {} };
    const mapFile = mapPath(customer.idn);
    if (await fs.pathExists(mapFile)) {
      try {
        const mapData = await fs.readJson(mapFile);
        if (mapData && typeof mapData === 'object' && 'projects' in mapData) {
          existingMap = mapData as ProjectMap;
        }
      } catch {
        // Ignore errors, start fresh
      }
    }

    // Count total skills for progress
    let totalSkills = 0;
    let processedSkills = 0;

    for (const project of apiProjects) {
      const agents = await listAgents(client, project.id);
      for (const agent of agents) {
        const flows = agent.flows || [];
        for (const flow of flows) {
          const skills = await listFlowSkills(client, flow.id);
          totalSkills += skills.length;
        }
      }
    }

    this.logger.verbose(`📊 Total skills to process: ${totalSkills}`);

    // Process each project
    for (const project of apiProjects) {
      this.logger.verbose(`📁 Processing project: ${project.title} (${project.idn})`);

      const projectMeta: ProjectMetadata = {
        id: project.id,
        idn: project.idn,
        title: project.title,
        description: project.description || '',
        created_at: project.created_at || '',
        updated_at: project.updated_at || ''
      };

      // Save project metadata
      const projectMetaPath = projectMetadataPath(customer.idn, project.idn);
      const projectMetaYaml = yaml.dump(projectMeta, { indent: 2, quotingType: '"', forceQuotes: false });
      await writeFileSafe(projectMetaPath, projectMetaYaml);
      hashes[projectMetaPath] = sha256(projectMetaYaml);

      const localProject: LocalProjectData = {
        projectId: project.id,
        projectIdn: project.idn,
        metadata: projectMeta,
        agents: []
      };

      const agents = await listAgents(client, project.id);
      this.logger.verbose(`  📋 Found ${agents.length} agents in project ${project.title}`);

      const projectData: ProjectData = {
        projectId: project.id,
        projectIdn: project.idn,
        agents: {}
      };

      // Process each agent
      for (const agent of agents) {
        const localAgent = await this.pullAgent(
          client, customer, project, agent, hashes, options, () => {
            processedSkills++;
            if (!options.verbose && totalSkills > 0) {
              if (processedSkills % 10 === 0 || processedSkills === totalSkills) {
                this.logger.progress(processedSkills, totalSkills, '📄 Processing skills');
              }
            }
          }
        );
        localProject.agents.push(localAgent);

        // Build project data for map
        projectData.agents[agent.idn] = {
          id: agent.id,
          flows: {}
        };

        for (const flow of localAgent.flows) {
          projectData.agents[agent.idn]!.flows[flow.idn] = {
            id: flow.id,
            skills: {}
          };

          for (const skill of flow.skills) {
            projectData.agents[agent.idn]!.flows[flow.idn]!.skills[skill.idn] = skill.metadata;
          }
        }
      }

      existingMap.projects[project.idn] = projectData;
      projects.push(localProject);
    }

    // Save updated project map
    await writeFileSafe(mapFile, JSON.stringify(existingMap, null, 2));

    // Generate flows.yaml
    const flowsYamlContent = await generateFlowsYaml(existingMap, customer.idn, options.verbose ?? false);
    const flowsYamlFilePath = flowsYamlPath(customer.idn);
    hashes[flowsYamlFilePath] = sha256(flowsYamlContent);

    // Save hashes
    await saveHashes(hashes, customer.idn);

    // Clean up deleted entities if not skipped
    if (!options.skipCleanup) {
      await this.cleanupDeletedEntities(customer.idn, existingMap, options.verbose ?? false);
    }

    return {
      items: projects,
      count: projects.length,
      hashes
    };
  }

  /**
   * Pull a single agent and its flows/skills
   */
  private async pullAgent(
    client: AxiosInstance,
    customer: CustomerConfig,
    project: ProjectMeta,
    agent: Agent,
    hashes: HashStore,
    options: PullOptions,
    onSkillProcessed: () => void
  ): Promise<LocalAgentData> {
    this.logger.verbose(`  📁 Processing agent: ${agent.title} (${agent.idn})`);

    const agentMeta: AgentMetadata = {
      id: agent.id,
      idn: agent.idn,
      title: agent.title || '',
      description: agent.description || ''
    };

    // Save agent metadata
    const agentMetaPath = agentMetadataPath(customer.idn, project.idn, agent.idn);
    const agentMetaYaml = yaml.dump(agentMeta, { indent: 2, quotingType: '"', forceQuotes: false });
    await writeFileSafe(agentMetaPath, agentMetaYaml);
    hashes[agentMetaPath] = sha256(agentMetaYaml);

    const localAgent: LocalAgentData = {
      id: agent.id,
      idn: agent.idn,
      metadata: agentMeta,
      flows: []
    };

    const flows = agent.flows || [];
    this.logger.verbose(`    📋 Found ${flows.length} flows in agent ${agent.title}`);

    // Process each flow
    for (const flow of flows) {
      const localFlow = await this.pullFlow(
        client, customer, project, agent, flow, hashes, options, onSkillProcessed
      );
      localAgent.flows.push(localFlow);
    }

    return localAgent;
  }

  /**
   * Pull a single flow and its skills
   */
  private async pullFlow(
    client: AxiosInstance,
    customer: CustomerConfig,
    project: ProjectMeta,
    agent: Agent,
    flow: Flow,
    hashes: HashStore,
    options: PullOptions,
    onSkillProcessed: () => void
  ): Promise<LocalFlowData> {
    this.logger.verbose(`    📁 Processing flow: ${flow.title} (${flow.idn})`);

    // Get flow events and states
    const [events, states] = await Promise.all([
      listFlowEvents(client, flow.id).catch(() => [] as FlowEvent[]),
      listFlowStates(client, flow.id).catch(() => [] as FlowState[])
    ]);

    const flowMeta: FlowMetadata = {
      id: flow.id,
      idn: flow.idn,
      title: flow.title,
      description: flow.description || '',
      default_runner_type: flow.default_runner_type,
      default_model: flow.default_model,
      events,
      state_fields: states
    };

    // Save flow metadata
    const flowMetaPath = flowMetadataPath(customer.idn, project.idn, agent.idn, flow.idn);
    const flowMetaYaml = yaml.dump(flowMeta, { indent: 2, quotingType: '"', forceQuotes: false });
    await writeFileSafe(flowMetaPath, flowMetaYaml);
    hashes[flowMetaPath] = sha256(flowMetaYaml);

    const localFlow: LocalFlowData = {
      id: flow.id,
      idn: flow.idn,
      metadata: flowMeta,
      skills: []
    };

    // Process skills
    const skills = await listFlowSkills(client, flow.id);
    this.logger.verbose(`      📋 Found ${skills.length} skills in flow ${flow.title}`);

    for (const skill of skills) {
      const localSkill = await this.pullSkill(
        client, customer, project, agent, flow, skill, hashes, options
      );
      localFlow.skills.push(localSkill);
      onSkillProcessed();
    }

    return localFlow;
  }

  /**
   * Pull a single skill
   */
  private async pullSkill(
    _client: AxiosInstance,
    customer: CustomerConfig,
    project: ProjectMeta,
    agent: Agent,
    flow: Flow,
    skill: Skill,
    hashes: HashStore,
    options: PullOptions
  ): Promise<LocalSkillData> {
    this.logger.verbose(`      📄 Processing skill: ${skill.title} (${skill.idn})`);

    const skillMeta: SkillMetadata = {
      id: skill.id,
      idn: skill.idn,
      title: skill.title,
      runner_type: skill.runner_type,
      model: skill.model,
      parameters: [...skill.parameters],
      path: skill.path
    };

    // Save skill metadata
    const skillMetaPath = skillMetadataPath(customer.idn, project.idn, agent.idn, flow.idn, skill.idn);
    const skillMetaYaml = yaml.dump(skillMeta, { indent: 2, quotingType: '"', forceQuotes: false });
    await writeFileSafe(skillMetaPath, skillMetaYaml);
    hashes[skillMetaPath] = sha256(skillMetaYaml);

    // Handle skill script
    const scriptContent = skill.prompt_script || '';
    const targetScriptPath = skillScriptPath(customer.idn, project.idn, agent.idn, flow.idn, skill.idn, skill.runner_type);
    const folderPath = skillFolderPath(customer.idn, project.idn, agent.idn, flow.idn, skill.idn);

    // Check for existing script files
    const existingFiles = await findSkillScriptFiles(folderPath);
    let shouldWrite = true;

    if (existingFiles.length > 0) {
      const hasContentMatch = existingFiles.some(file => !isContentDifferent(file.content, scriptContent));

      if (hasContentMatch) {
        const matchingFile = existingFiles.find(file => !isContentDifferent(file.content, scriptContent));
        const correctName = `${skill.idn}.${getExtensionForRunner(skill.runner_type)}`;

        if (matchingFile && matchingFile.fileName !== correctName) {
          await fs.remove(matchingFile.filePath);
          this.logger.verbose(`        🔄 Renamed ${matchingFile.fileName} → ${correctName}`);
        } else if (matchingFile && matchingFile.fileName === correctName) {
          shouldWrite = false;
          hashes[matchingFile.filePath] = sha256(scriptContent);
        }
      } else if (!options.silentOverwrite) {
        // In interactive mode, we'd ask for confirmation
        // For now, just overwrite in strategy (interactive logic stays in CLI)
        for (const file of existingFiles) {
          await fs.remove(file.filePath);
        }
      } else {
        for (const file of existingFiles) {
          await fs.remove(file.filePath);
        }
      }
    }

    if (shouldWrite) {
      await writeFileSafe(targetScriptPath, scriptContent);
      hashes[targetScriptPath] = sha256(scriptContent);
    }

    return {
      id: skill.id,
      idn: skill.idn,
      metadata: skillMeta,
      scriptPath: targetScriptPath,
      scriptContent
    };
  }

  /**
   * Push changed projects to NEWO platform
   */
  async push(customer: CustomerConfig, changes?: ChangeItem<LocalProjectData>[]): Promise<PushResult> {
    const result: PushResult = { created: 0, updated: 0, deleted: 0, errors: [] };

    // If no changes provided, detect them
    if (!changes) {
      changes = await this.getChanges(customer);
    }

    if (changes.length === 0) {
      return result;
    }

    const client = await this.apiClientFactory(customer, false);
    const existingHashes = await loadHashes(customer.idn);
    const newHashes = { ...existingHashes };

    // Load project map
    const mapFile = mapPath(customer.idn);
    if (!(await fs.pathExists(mapFile))) {
      result.errors.push(`No project map found. Run pull first.`);
      return result;
    }

    const mapData = await fs.readJson(mapFile) as ProjectMap;

    // Process skill changes
    for (const change of changes) {
      try {
        if (change.operation === 'modified') {
          // Update existing skill
          const updateResult = await this.pushSkillUpdate(client, customer, change, mapData, newHashes);
          result.updated += updateResult;
        } else if (change.operation === 'created') {
          // Create new entity
          const createResult = await this.pushNewEntity(client, customer, change, mapData, newHashes);
          result.created += createResult;
        }
      } catch (error) {
        result.errors.push(`Failed to push ${change.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Save updated hashes
    await saveHashes(newHashes, customer.idn);

    // Publish flows if any changes were made
    if (result.created > 0 || result.updated > 0) {
      await this.publishAllFlows(client, mapData);
    }

    return result;
  }

  /**
   * Push a skill update
   */
  private async pushSkillUpdate(
    client: AxiosInstance,
    _customer: CustomerConfig,
    change: ChangeItem<LocalProjectData>,
    mapData: ProjectMap,
    newHashes: HashStore
  ): Promise<number> {
    // Extract skill info from path
    // Path format: newo_customers/{customer}/projects/{project}/{agent}/{flow}/{skill}/{skill}.guidance
    const pathParts = change.path.split('/');
    const skillIdn = pathParts[pathParts.length - 2] || '';
    const flowIdn = pathParts[pathParts.length - 3] || '';
    const agentIdn = pathParts[pathParts.length - 4] || '';
    const projectIdn = pathParts[pathParts.length - 5] || '';

    // Look up skill in map
    const projectData = mapData.projects[projectIdn];
    const agentData = projectData?.agents[agentIdn];
    const flowData = agentData?.flows[flowIdn];
    const skillData = flowData?.skills[skillIdn];

    if (!skillData) {
      throw new Error(`Skill ${skillIdn} not found in project map`);
    }

    // Read script content
    const content = await fs.readFile(change.path, 'utf8');

    // Update skill
    await updateSkill(client, {
      id: skillData.id,
      title: skillData.title,
      idn: skillData.idn,
      prompt_script: content,
      runner_type: skillData.runner_type,
      model: skillData.model,
      parameters: skillData.parameters,
      path: skillData.path
    });

    // Update hash
    newHashes[change.path] = sha256(content);

    this.logger.info(`↑ Pushed: ${skillIdn}`);
    return 1;
  }

  /**
   * Push a new entity
   */
  private async pushNewEntity(
    _client: AxiosInstance,
    _customer: CustomerConfig,
    _change: ChangeItem<LocalProjectData>,
    _mapData: ProjectMap,
    _newHashes: HashStore
  ): Promise<number> {
    // Entity creation is handled separately for now
    // This would be expanded for full entity creation support
    return 0;
  }

  /**
   * Publish all flows
   */
  private async publishAllFlows(client: AxiosInstance, mapData: ProjectMap): Promise<void> {
    for (const projectData of Object.values(mapData.projects)) {
      for (const agentData of Object.values(projectData.agents)) {
        for (const [flowIdn, flowData] of Object.entries(agentData.flows)) {
          if (flowData.id) {
            try {
              await publishFlow(client, flowData.id, {
                version: '1.0',
                description: 'Published via NEWO CLI',
                type: 'public'
              });
              this.logger.verbose(`📤 Published flow: ${flowIdn}`);
            } catch (error) {
              this.logger.warn(`Failed to publish flow ${flowIdn}`);
            }
          }
        }
      }
    }
  }

  /**
   * Detect changes in project files
   */
  async getChanges(customer: CustomerConfig): Promise<ChangeItem<LocalProjectData>[]> {
    const changes: ChangeItem<LocalProjectData>[] = [];

    const mapFile = mapPath(customer.idn);
    if (!(await fs.pathExists(mapFile))) {
      return changes;
    }

    const hashes = await loadHashes(customer.idn);
    const mapData = await fs.readJson(mapFile) as ProjectMap;

    // Scan for changed skill scripts
    for (const [projectIdn, projectData] of Object.entries(mapData.projects)) {
      for (const [agentIdn, agentData] of Object.entries(projectData.agents)) {
        for (const [flowIdn, flowData] of Object.entries(agentData.flows)) {
          for (const [skillIdn, _skillData] of Object.entries(flowData.skills)) {
            const skillFile = await getSingleSkillFile(customer.idn, projectIdn, agentIdn, flowIdn, skillIdn);

            if (skillFile) {
              const currentHash = sha256(skillFile.content);
              const storedHash = hashes[skillFile.filePath];

              if (storedHash !== currentHash) {
                changes.push({
                  item: {} as LocalProjectData, // Simplified for now
                  operation: 'modified',
                  path: skillFile.filePath
                });
              }
            }
          }
        }
      }
    }

    return changes;
  }

  /**
   * Validate project structure
   */
  async validate(customer: CustomerConfig, _items: LocalProjectData[]): Promise<ValidationResult> {
    const errors: ValidationError[] = [];

    const mapFile = mapPath(customer.idn);
    if (!(await fs.pathExists(mapFile))) {
      errors.push({
        field: 'projectMap',
        message: 'No project map found. Run pull first.'
      });
      return { valid: false, errors };
    }

    const mapData = await fs.readJson(mapFile) as ProjectMap;

    // Validate skill folders
    for (const [projectIdn, projectData] of Object.entries(mapData.projects)) {
      for (const [agentIdn, agentData] of Object.entries(projectData.agents)) {
        for (const [flowIdn, flowData] of Object.entries(agentData.flows)) {
          for (const skillIdn of Object.keys(flowData.skills)) {
            const validation = await validateSkillFolder(customer.idn, projectIdn, agentIdn, flowIdn, skillIdn);

            if (!validation.isValid) {
              for (const error of validation.errors) {
                errors.push({
                  field: `skill.${skillIdn}`,
                  message: error,
                  path: `${projectIdn}/${agentIdn}/${flowIdn}/${skillIdn}`
                });
              }
            }
          }
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Get status summary
   */
  async getStatus(customer: CustomerConfig): Promise<StatusSummary> {
    const changes = await this.getChanges(customer);

    return {
      resourceType: this.resourceType,
      displayName: this.displayName,
      changedCount: changes.length,
      changes: changes.map(c => ({
        path: c.path,
        operation: c.operation
      }))
    };
  }

  /**
   * Clean up deleted entities
   */
  private async cleanupDeletedEntities(
    customerIdn: string,
    projectMap: ProjectMap,
    verbose: boolean
  ): Promise<void> {
    const projectsPath = customerProjectsDir(customerIdn);

    if (!(await fs.pathExists(projectsPath))) {
      return;
    }

    const localProjects = await fs.readdir(projectsPath);
    const deletedPaths: string[] = [];

    for (const localProjectIdn of localProjects) {
      const localProjectPath = projectDir(customerIdn, localProjectIdn);
      const stat = await fs.stat(localProjectPath).catch(() => null);

      if (!stat || !stat.isDirectory()) continue;
      if (localProjectIdn === 'flows.yaml') continue;

      if (!projectMap.projects[localProjectIdn]) {
        deletedPaths.push(localProjectPath);
      }
    }

    if (deletedPaths.length > 0 && verbose) {
      this.logger.info(`Found ${deletedPaths.length} deleted entities`);
    }
  }
}

/**
 * Factory function for creating ProjectSyncStrategy
 */
export function createProjectSyncStrategy(
  apiClientFactory: ApiClientFactory,
  logger: ILogger
): ProjectSyncStrategy {
  return new ProjectSyncStrategy(apiClientFactory, logger);
}
