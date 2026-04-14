/**
 * V2ProjectSyncStrategy - Handles synchronization in newo_v2 format
 *
 * Uses the SAME V1 API endpoints as ProjectSyncStrategy but writes/reads
 * files in the newo_v2 directory layout:
 *   {CustomerIdn}/
 *     import_version.txt
 *     {ProjectIdn}/
 *       {project_idn}.yaml
 *       agents/{AgentIdn}/
 *         agent.yaml
 *         flows/{FlowIdn}/
 *           {FlowIdn}.yaml  (inline skill defs, events, state_fields)
 *           skills/{SkillIdn}.nsl|.nslg
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
  SkillMetadata
} from '../../../types.js';
import type { LocalProjectData, LocalAgentData, LocalFlowData, LocalSkillData, ApiClientFactory } from './ProjectSyncStrategy.js';
import fs from 'fs-extra';
import {
  listProjects,
  listAgents,
  listFlowSkills,
  listFlowEvents,
  listFlowStates,
  updateSkill,
  publishFlow,
  getProjectAttributes,
  getCustomerAttributes,
  listLibraries,
  updateLibrarySkill,
} from '../../../api.js';
import type { LibraryResponse } from '../../../api.js';
import {
  ensureStateOnly,
  writeFileSafe,
  mapPath,
} from '../../../fsutil.js';
import { sha256, saveHashes, loadHashes } from '../../../hash.js';
import {
  v2ImportVersionPath,
  v2ProjectYamlPath,
  v2AgentYamlPath,
  v2FlowYamlPath,
  v2SkillScriptPath,
  v2SkillRelativePath,
  v2ProjectAttributesPath,
  v2CustomerAttributesPath,
  v2AkbDir,
  v2AkbPath,
  v2LibraryYamlPath,
  v2LibrarySkillScriptPath,
  v2LibrarySkillRelativePath,
} from '../../../format/paths-v2.js';
import {
  V2_IMPORT_VERSION,
} from '../../../format/types.js';
import {
  generateV2FlowYaml,
  generateV2ProjectYaml,
  generateV2AgentYaml,
  buildV2InlineSkill,
  buildV2FlowEvent,
  buildV2StateField,
  type V2InlineSkill,
} from '../../../format/v2-yaml.js';
import { isContentDifferent } from '../../../sync/skill-files.js';
import yaml from 'js-yaml';
import { patchYamlToPyyaml } from '../../../format/yaml-patch.js';

/**
 * V2ProjectSyncStrategy - same API, newo_v2 file layout
 */
export class V2ProjectSyncStrategy implements ISyncStrategy<ProjectMeta, LocalProjectData> {
  readonly resourceType = 'projects';
  readonly displayName = 'Projects (newo_v2)';

  constructor(
    private apiClientFactory: ApiClientFactory,
    private logger: ILogger
  ) {}

  // ──────────────────────────────────────
  // PULL
  // ──────────────────────────────────────

  async pull(customer: CustomerConfig, options: PullOptions = {}): Promise<PullResult<LocalProjectData>> {
    const client = await this.apiClientFactory(customer, options.verbose ?? false);
    const hashes: HashStore = {};
    const projects: LocalProjectData[] = [];

    this.logger.verbose(`[newo_v2] Loading project list for customer ${customer.idn}...`);

    // Use V2 state init (no V1 projects/ dir)
    await ensureStateOnly(customer.idn);

    // Write import_version.txt marker
    const versionPath = v2ImportVersionPath(customer.idn);
    await writeFileSafe(versionPath, V2_IMPORT_VERSION);

    // Write V2 customer attributes: attributes.yaml (sorted, with !enum ValueType.X)
    try {
      const custAttrs = await getCustomerAttributes(client, true);
      const attrs = custAttrs.attributes || [];
      if (attrs.length > 0) {
        const attrYaml = formatV2AttributesYaml(attrs);
        const custAttrPath = v2CustomerAttributesPath(customer.idn);
        await writeFileSafe(custAttrPath, attrYaml);
        hashes[custAttrPath] = sha256(attrYaml);
      }
    } catch {
      this.logger.verbose(`  Could not pull customer attributes`);
    }

    // Fetch projects from API (same V1 endpoints)
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
        // Start fresh
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

    this.logger.verbose(`[newo_v2] Total skills to process: ${totalSkills}`);

    // Process each project
    for (const project of apiProjects) {
      this.logger.verbose(`[newo_v2] Processing project: ${project.title} (${project.idn})`);

      // Write V2 project YAML: {project_idn}.yaml
      // The API returns registry_idn (not registry) - map to V2 field name
      const projectYaml = generateV2ProjectYaml({
        idn: project.idn,
        name: project.title || project.idn,
        version: (project as any).version || '1.0.0',
        description: project.description || '',
        is_auto_update_enabled: (project as any).is_auto_update_enabled ?? false,
        registry: (project as any).registry_idn || (project as any).registry || '',
        registry_item_idn: (project as any).registry_item_idn || '',
      });
      const projectYamlPath = v2ProjectYamlPath(customer.idn, project.idn);
      await writeFileSafe(projectYamlPath, projectYaml);
      hashes[projectYamlPath] = sha256(projectYaml);

      const localProject: LocalProjectData = {
        projectId: project.id,
        projectIdn: project.idn,
        metadata: {
          id: project.id,
          idn: project.idn,
          title: project.title,
          description: project.description || '',
          created_at: project.created_at || '',
          updated_at: project.updated_at || '',
        },
        agents: []
      };

      const agents = await listAgents(client, project.id);
      this.logger.verbose(`  Found ${agents.length} agents in project ${project.title}`);

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
                this.logger.progress(processedSkills, totalSkills, '[newo_v2] Processing skills');
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

      // Pull libraries for this project
      try {
        const libraries = await listLibraries(client, project.id);
        if (libraries.length > 0) {
          this.logger.verbose(`  Found ${libraries.length} libraries in project ${project.idn}`);
          projectData.libraries = {};

          for (const lib of libraries) {
            await this.pullLibrary(client, customer, project, lib, hashes, options);
            projectData.libraries[lib.idn] = {
              id: lib.id,
              skills: {}
            };
            for (const skill of lib.skills) {
              projectData.libraries[lib.idn]!.skills[skill.idn] = {
                id: skill.id,
                idn: skill.idn,
                title: skill.title,
                runner_type: skill.runner_type,
                model: skill.model,
                parameters: [...skill.parameters],
                path: skill.path
              };
            }
          }
        }
      } catch {
        this.logger.verbose(`  Could not pull libraries for project ${project.idn}`);
      }

      // Write V2 project attributes: {project_idn}/attributes.yaml
      try {
        const projAttrs = await getProjectAttributes(client, project.id, true);
        const attrs = projAttrs.attributes || [];
        if (attrs.length > 0) {
          const attrYaml = formatV2AttributesYaml(attrs);
          const attrPath = v2ProjectAttributesPath(customer.idn, project.idn);
          await writeFileSafe(attrPath, attrYaml);
          hashes[attrPath] = sha256(attrYaml);
        }
      } catch {
        this.logger.verbose(`  Could not pull attributes for project ${project.idn}`);
      }

      existingMap.projects[project.idn] = projectData;
      projects.push(localProject);
    }

    // Write AKB stub files for all agents: akb/{AgentIdn}.yaml
    // V2 format creates an empty [] file for every agent persona
    const akbDirPath = v2AkbDir(customer.idn);
    await fs.ensureDir(akbDirPath);
    for (const project of projects) {
      for (const agent of project.agents) {
        const akbFilePath = v2AkbPath(customer.idn, agent.idn);
        if (!(await fs.pathExists(akbFilePath))) {
          await writeFileSafe(akbFilePath, '[]\n');
        }
        // Don't overwrite existing AKB files that may have content from AkbSyncStrategy
      }
    }

    // Save updated project map
    await writeFileSafe(mapFile, JSON.stringify(existingMap, null, 2));

    // Save hashes
    await saveHashes(hashes, customer.idn);

    return {
      items: projects,
      count: projects.length,
      hashes
    };
  }

  /**
   * Pull a single agent in V2 format
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
    this.logger.verbose(`  [newo_v2] Processing agent: ${agent.title} (${agent.idn})`);

    // Write V2 agent YAML: agents/{AgentIdn}/agent.yaml
    // Preserve exact API values (null title stays null, "" description stays "")
    const agentYaml = generateV2AgentYaml({
      idn: agent.idn,
      title: agent.title ?? null,
      description: agent.description ?? null,
    });
    const agentYamlFilePath = v2AgentYamlPath(customer.idn, project.idn, agent.idn);
    await writeFileSafe(agentYamlFilePath, agentYaml);
    hashes[agentYamlFilePath] = sha256(agentYaml);

    const localAgent: LocalAgentData = {
      id: agent.id,
      idn: agent.idn,
      metadata: {
        id: agent.id,
        idn: agent.idn,
        title: agent.title || '',
        description: agent.description || '',
      },
      flows: []
    };

    const flows = agent.flows || [];
    this.logger.verbose(`    Found ${flows.length} flows in agent ${agent.title}`);

    for (const flow of flows) {
      const localFlow = await this.pullFlow(
        client, customer, project, agent, flow, hashes, options, onSkillProcessed
      );
      localAgent.flows.push(localFlow);
    }

    return localAgent;
  }

  /**
   * Pull a single flow in V2 format
   *
   * In V2, the flow YAML contains inline skill definitions, events, and state_fields.
   * Skills are written to flows/{FlowIdn}/skills/{SkillIdn}.nsl|.nslg
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
    this.logger.verbose(`    [newo_v2] Processing flow: ${flow.title} (${flow.idn})`);

    // Get flow events and states
    const [events, states] = await Promise.all([
      listFlowEvents(client, flow.id).catch(() => [] as FlowEvent[]),
      listFlowStates(client, flow.id).catch(() => [] as FlowState[])
    ]);

    // Process skills
    const skills = await listFlowSkills(client, flow.id);
    this.logger.verbose(`      Found ${skills.length} skills in flow ${flow.title}`);

    // Build V2 inline skill definitions
    const v2Skills: V2InlineSkill[] = [];
    const localFlow: LocalFlowData = {
      id: flow.id,
      idn: flow.idn,
      metadata: {
        id: flow.id,
        idn: flow.idn,
        title: flow.title,
        description: flow.description || '',
        default_runner_type: flow.default_runner_type,
        default_model: flow.default_model,
        events,
        state_fields: states
      },
      skills: []
    };

    for (const skill of skills) {
      const localSkill = await this.pullSkill(
        customer, project, agent, flow, skill, hashes, options
      );
      localFlow.skills.push(localSkill);
      onSkillProcessed();

      // Build inline skill definition for flow YAML
      const relPath = v2SkillRelativePath(flow.idn, skill.idn, skill.runner_type);
      v2Skills.push(buildV2InlineSkill(
        skill.idn,
        skill.title || '',
        skill.runner_type,
        skill.model?.model_idn || flow.default_model?.model_idn || '',
        skill.model?.provider_idn || flow.default_model?.provider_idn || '',
        skill.parameters.map(p => ({
          name: p.name,
          default_value: p.default_value ?? '',
        })),
        relPath
      ));
    }

    // Build V2 events
    const v2Events = events.map(e => buildV2FlowEvent(
      e.idn,
      e.skill_selector || 'skill_idn',
      e.skill_idn || null,
      e.state_idn || null,
      e.integration_idn || null,
      e.connector_idn || null,
      e.interrupt_mode || 'queue'
    ));

    // Build V2 state fields
    const v2States = states.map(s => buildV2StateField(
      s.idn,
      s.title || '',
      s.default_value ?? '',
      s.scope || 'user'
    ));

    // Write V2 flow YAML: flows/{FlowIdn}/{FlowIdn}.yaml
    const flowYaml = generateV2FlowYaml(
      flow.idn,
      flow.title || flow.idn,
      flow.description ?? null,
      flow.default_runner_type || 'guidance',
      flow.default_model?.provider_idn || '',
      flow.default_model?.model_idn || '',
      v2Skills,
      v2Events,
      v2States
    );
    const flowYamlFilePath = v2FlowYamlPath(customer.idn, project.idn, agent.idn, flow.idn);
    await writeFileSafe(flowYamlFilePath, flowYaml);
    hashes[flowYamlFilePath] = sha256(flowYaml);

    return localFlow;
  }

  /**
   * Pull a single skill script in V2 format
   *
   * Script goes to: flows/{FlowIdn}/skills/{SkillIdn}.nsl|.nslg
   * No separate metadata.yaml - metadata is inline in the flow YAML
   */
  private async pullSkill(
    customer: CustomerConfig,
    project: ProjectMeta,
    agent: Agent,
    flow: Flow,
    skill: Skill,
    hashes: HashStore,
    options: PullOptions
  ): Promise<LocalSkillData> {
    this.logger.verbose(`      [newo_v2] Processing skill: ${skill.title} (${skill.idn})`);

    const scriptContent = skill.prompt_script || '';
    const targetPath = v2SkillScriptPath(
      customer.idn, project.idn, agent.idn, flow.idn, skill.idn, skill.runner_type
    );

    // Check for existing file and handle overwrites
    let shouldWrite = true;
    if (await fs.pathExists(targetPath)) {
      const existingContent = await fs.readFile(targetPath, 'utf8');
      if (!isContentDifferent(existingContent, scriptContent)) {
        shouldWrite = false;
        hashes[targetPath] = sha256(scriptContent);
      } else if (!options.silentOverwrite) {
        // In non-silent mode, we overwrite (interactive mode handled in CLI layer)
        shouldWrite = true;
      }
    }

    if (shouldWrite) {
      await writeFileSafe(targetPath, scriptContent);
      hashes[targetPath] = sha256(scriptContent);
    }

    const skillMeta: SkillMetadata = {
      id: skill.id,
      idn: skill.idn,
      title: skill.title,
      runner_type: skill.runner_type,
      model: skill.model,
      parameters: [...skill.parameters],
      path: skill.path
    };

    return {
      id: skill.id,
      idn: skill.idn,
      metadata: skillMeta,
      scriptPath: targetPath,
      scriptContent
    };
  }

  /**
   * Pull a library and its skills in V2 format
   *
   * Writes:
   *   {project}/libraries/{lib}/{lib}.yaml (with inline skill list)
   *   {project}/libraries/{lib}/skills/{skill}.nsl|.nslg
   */
  private async pullLibrary(
    _client: AxiosInstance,
    customer: CustomerConfig,
    project: ProjectMeta,
    lib: LibraryResponse,
    hashes: HashStore,
    _options: PullOptions
  ): Promise<void> {
    this.logger.verbose(`    [newo_v2] Processing library: ${lib.idn} (${lib.skills.length} skills)`);

    // Build V2 inline skill definitions for library YAML
    const v2Skills: V2InlineSkill[] = [];
    for (const skill of lib.skills) {
      const relPath = v2LibrarySkillRelativePath(project.idn, lib.idn, skill.idn, skill.runner_type);
      v2Skills.push(buildV2InlineSkill(
        skill.idn,
        skill.title || '',
        skill.runner_type,
        skill.model?.model_idn || '',
        skill.model?.provider_idn || '',
        skill.parameters.map(p => ({
          name: p.name,
          default_value: p.default_value ?? '',
        })),
        relPath
      ));
    }

    // Sort skills same as flows
    const { sortV2Skills, sortV2Parameters } = await import('../../../format/v2-yaml.js');
    const sortedSkills = sortV2Skills(v2Skills).map(s => ({
      ...s,
      parameters: sortV2Parameters(s.parameters),
    }));

    // Write library YAML: libraries/{lib}/{lib}.yaml
    const libDef = {
      library: {
        idn: lib.idn,
        skills: sortedSkills,
      }
    };
    const libYaml = yaml.dump(libDef, { indent: 2, lineWidth: -1, noRefs: true, sortKeys: false });
    const libYamlPath = v2LibraryYamlPath(customer.idn, project.idn, lib.idn);
    await writeFileSafe(libYamlPath, libYaml);
    hashes[libYamlPath] = sha256(libYaml);

    // Write skill scripts
    for (const skill of lib.skills) {
      const scriptContent = skill.prompt_script || '';
      const scriptPath = v2LibrarySkillScriptPath(
        customer.idn, project.idn, lib.idn, skill.idn, skill.runner_type
      );

      let shouldWrite = true;
      if (await fs.pathExists(scriptPath)) {
        const existing = await fs.readFile(scriptPath, 'utf8');
        if (!isContentDifferent(existing, scriptContent)) {
          shouldWrite = false;
          hashes[scriptPath] = sha256(scriptContent);
        }
      }

      if (shouldWrite) {
        await writeFileSafe(scriptPath, scriptContent);
        hashes[scriptPath] = sha256(scriptContent);
      }
    }
  }

  // ──────────────────────────────────────
  // PUSH
  // ──────────────────────────────────────

  async push(customer: CustomerConfig, changes?: ChangeItem<LocalProjectData>[]): Promise<PushResult> {
    const result: PushResult = { created: 0, updated: 0, deleted: 0, errors: [] };

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
      result.errors.push('No project map found. Run pull first.');
      return result;
    }

    const mapData = await fs.readJson(mapFile) as ProjectMap;

    for (const change of changes) {
      try {
        if (change.operation === 'modified') {
          // Detect if this is a library skill or flow skill by path
          const isLibrary = change.path.includes('/libraries/');
          const count = isLibrary
            ? await this.pushV2LibrarySkillUpdate(client, change, mapData, newHashes)
            : await this.pushV2SkillUpdate(client, change, mapData, newHashes);
          result.updated += count;
        }
      } catch (error) {
        result.errors.push(
          `Failed to push ${change.path}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    await saveHashes(newHashes, customer.idn);

    if (result.created > 0 || result.updated > 0) {
      await this.publishAllFlows(client, mapData);
    }

    return result;
  }

  /**
   * Push a V2 skill update
   *
   * V2 path: newo_customers/{cust}/{proj}/agents/{agent}/flows/{flow}/skills/{skill}.nsl
   */
  private async pushV2SkillUpdate(
    client: AxiosInstance,
    change: ChangeItem<LocalProjectData>,
    mapData: ProjectMap,
    newHashes: HashStore
  ): Promise<number> {
    // Parse V2 path to extract entity hierarchy
    // Path: .../newo_customers/{cust}/{proj}/agents/{agent}/flows/{flow}/skills/{skillFile}
    const pathParts = change.path.split('/');
    const skillFileName = pathParts[pathParts.length - 1] || '';
    const skillIdn = skillFileName.replace(/\.(nsl|nslg|jinja|guidance)$/, '');
    // skills/ -> flow/ -> flows/ -> agent/ -> agents/ -> project/
    const flowIdn = pathParts[pathParts.length - 3] || '';
    const agentIdn = pathParts[pathParts.length - 5] || '';
    const projectIdn = pathParts[pathParts.length - 7] || '';

    // Look up skill in map
    const projectData = mapData.projects[projectIdn];
    const agentData = projectData?.agents[agentIdn];
    const flowData = agentData?.flows[flowIdn];
    const skillData = flowData?.skills[skillIdn];

    if (!skillData) {
      throw new Error(`Skill ${skillIdn} not found in project map (path: ${change.path})`);
    }

    // Read updated script content
    const content = await fs.readFile(change.path, 'utf8');

    // Update via V1 API
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

    newHashes[change.path] = sha256(content);
    this.logger.info(`[newo_v2] Pushed: ${skillIdn}`);
    return 1;
  }

  /**
   * Push a V2 library skill update
   * Path: .../newo_customers/{cust}/{proj}/libraries/{lib}/skills/{skillFile}
   */
  private async pushV2LibrarySkillUpdate(
    client: AxiosInstance,
    change: ChangeItem<LocalProjectData>,
    mapData: ProjectMap,
    newHashes: HashStore
  ): Promise<number> {
    const pathParts = change.path.split('/');
    const skillFileName = pathParts[pathParts.length - 1] || '';
    const skillIdn = skillFileName.replace(/\.(nsl|nslg|jinja|guidance)$/, '');
    // skills/ -> lib/ -> libraries/ -> project/
    const libIdn = pathParts[pathParts.length - 3] || '';
    const projectIdn = pathParts[pathParts.length - 5] || '';

    const projectData = mapData.projects[projectIdn];
    const libData = projectData?.libraries?.[libIdn];
    const skillData = libData?.skills[skillIdn];

    if (!skillData || !libData) {
      throw new Error(`Library skill ${skillIdn} not found in project map (path: ${change.path})`);
    }

    const content = await fs.readFile(change.path, 'utf8');

    await updateLibrarySkill(client, libData.id, skillData.id, {
      prompt_script: content,
    });

    newHashes[change.path] = sha256(content);
    this.logger.info(`[newo_v2] Pushed library skill: ${libIdn}/${skillIdn}`);
    return 1;
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
                description: 'Published via NEWO CLI (newo_v2)',
                type: 'public'
              });
              this.logger.verbose(`[newo_v2] Published flow: ${flowIdn}`);
            } catch {
              this.logger.warn(`[newo_v2] Failed to publish flow ${flowIdn}`);
            }
          }
        }
      }
    }
  }

  // ──────────────────────────────────────
  // STATUS / CHANGES
  // ──────────────────────────────────────

  async getChanges(customer: CustomerConfig): Promise<ChangeItem<LocalProjectData>[]> {
    const changes: ChangeItem<LocalProjectData>[] = [];

    const mapFile = mapPath(customer.idn);
    if (!(await fs.pathExists(mapFile))) {
      return changes;
    }

    const hashes = await loadHashes(customer.idn);
    const mapData = await fs.readJson(mapFile) as ProjectMap;

    // Scan V2 directory structure for changed skill scripts
    for (const [projectIdn, projectData] of Object.entries(mapData.projects)) {
      // Flow skills
      for (const [agentIdn, agentData] of Object.entries(projectData.agents)) {
        for (const [flowIdn, flowData] of Object.entries(agentData.flows)) {
          for (const [skillIdn, skillMeta] of Object.entries(flowData.skills)) {
            const scriptPath = v2SkillScriptPath(
              customer.idn, projectIdn, agentIdn, flowIdn, skillIdn,
              skillMeta.runner_type
            );

            if (await fs.pathExists(scriptPath)) {
              const content = await fs.readFile(scriptPath, 'utf8');
              const currentHash = sha256(content);
              const storedHash = hashes[scriptPath];

              if (storedHash !== currentHash) {
                changes.push({
                  item: {} as LocalProjectData,
                  operation: 'modified',
                  path: scriptPath
                });
              }
            }
          }
        }
      }

      // Library skills
      if (projectData.libraries) {
        for (const [libIdn, libData] of Object.entries(projectData.libraries)) {
          for (const [skillIdn, skillMeta] of Object.entries(libData.skills)) {
            const scriptPath = v2LibrarySkillScriptPath(
              customer.idn, projectIdn, libIdn, skillIdn,
              skillMeta.runner_type
            );

            if (await fs.pathExists(scriptPath)) {
              const content = await fs.readFile(scriptPath, 'utf8');
              const currentHash = sha256(content);
              const storedHash = hashes[scriptPath];

              if (storedHash !== currentHash) {
                changes.push({
                  item: {} as LocalProjectData,
                  operation: 'modified',
                  path: scriptPath
                });
              }
            }
          }
        }
      }
    }

    return changes;
  }

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

    // Validate V2 skill files exist
    for (const [projectIdn, projectData] of Object.entries(mapData.projects)) {
      for (const [agentIdn, agentData] of Object.entries(projectData.agents)) {
        for (const [flowIdn, flowData] of Object.entries(agentData.flows)) {
          for (const [skillIdn, skillMeta] of Object.entries(flowData.skills)) {
            const scriptPath = v2SkillScriptPath(
              customer.idn, projectIdn, agentIdn, flowIdn, skillIdn,
              skillMeta.runner_type
            );

            if (!(await fs.pathExists(scriptPath))) {
              errors.push({
                field: `skill.${skillIdn}`,
                message: `Script file not found: ${scriptPath}`,
                path: scriptPath
              });
            }
          }
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

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
}

// ── V2 Attributes Formatting ──

/**
 * Map V1 API value_type to V2 export format
 * V1 API: "string", "bool", "AttributeValueTypes.string", etc.
 * V2 export: "ValueType.STRING", "ValueType.BOOL", etc.
 */
function toV2ValueType(apiValueType: string): string {
  // Already in V2 format
  if (apiValueType.startsWith('ValueType.')) return apiValueType;

  // Strip AttributeValueTypes. prefix if present
  const raw = apiValueType.replace(/^AttributeValueTypes\./, '');

  const mapping: Record<string, string> = {
    'string': 'ValueType.STRING',
    'bool': 'ValueType.BOOL',
    'number': 'ValueType.NUMBER',
    'enum': 'ValueType.ENUM',
    'json': 'ValueType.JSON',
  };

  return mapping[raw.toLowerCase()] || `ValueType.${raw.toUpperCase()}`;
}

/**
 * Format attributes as V2 YAML with:
 * - Sorted by idn alphabetically
 * - value_type as !enum "ValueType.X"
 * - Proper quoting
 */
function formatV2AttributesYaml(attrs: Array<{
  idn: string;
  value: any;
  title?: string | undefined;
  description?: string | undefined;
  group?: string | undefined;
  is_hidden?: boolean | undefined;
  possible_values?: any[] | undefined;
  value_type?: string | undefined;
}>): string {
  // Sort alphabetically by idn
  const sorted = [...attrs].sort((a, b) => a.idn.localeCompare(b.idn));

  const cleaned = sorted.map(a => ({
    idn: a.idn,
    value: a.value,
    title: a.title || '',
    description: a.description || '',
    group: a.group || '',
    is_hidden: a.is_hidden ?? false,
    possible_values: a.possible_values || [],
    value_type: new V2EnumValue(toV2ValueType(a.value_type || 'string')),
  }));

  const enumType = new yaml.Type('!enum', {
    kind: 'scalar',
    instanceOf: V2EnumValue,
    resolve: () => true,
    construct: (data: string) => new V2EnumValue(data),
    represent: (data: unknown) => data instanceof V2EnumValue ? data.value : String(data),
  });
  const schema = yaml.DEFAULT_SCHEMA.extend([enumType]);

  // Use lineWidth: -1 to prevent folding multiline strings (preserve |- literal block style)
  const rawYaml = yaml.dump({ attributes: cleaned }, {
    indent: 2,
    quotingType: '"',
    forceQuotes: false,
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
    schema,
  });

  // Fix !enum quoting: js-yaml outputs `!enum ValueType.STRING` but V2 ZIP uses `!enum "ValueType.STRING"`
  const enumFixed = rawYaml.replace(/!enum (\S+)/g, '!enum "$1"');

  // Patch long-line wrapping to match pyyaml style
  return patchYamlToPyyaml(enumFixed);
}

/** Wrapper class for !enum YAML tag */
class V2EnumValue {
  constructor(public value: string) {}
}

/**
 * Factory function for creating V2ProjectSyncStrategy
 */
export function createV2ProjectSyncStrategy(
  apiClientFactory: ApiClientFactory,
  logger: ILogger
): V2ProjectSyncStrategy {
  return new V2ProjectSyncStrategy(apiClientFactory, logger);
}
