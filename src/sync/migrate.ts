/**
 * Account migration operations
 * Migrates complete account from source to destination
 */

import {
  listProjects, listAgents, createProject, createAgent, createFlow, createSkill,
  createFlowEvent, createFlowState,
  getCustomerAttributes, createCustomerAttribute, updateCustomerAttribute,
  getProjectAttributes, createProjectAttribute, updateProjectAttribute,
  searchPersonas, getAkbTopics, createPersona, importAkbArticle,
  listIntegrations, listConnectors, createConnector,
  listFlowSkills, updateSkill
} from '../api.js';
import { pullAll } from './projects.js';
import { pullIntegrations } from './integrations.js';
import { customerDir, customerProjectsDir } from '../fsutil.js';
import fs from 'fs-extra';
import yaml from 'js-yaml';
import path from 'path';
import type { AxiosInstance } from 'axios';
import type {
  CustomerConfig,
  CreateFlowEventRequest, AkbImportArticle
} from '../types.js';

interface MigrationOptions {
  sourceCustomer: CustomerConfig;
  destCustomer: CustomerConfig;
  sourceClient: AxiosInstance;
  destClient: AxiosInstance;
  verbose: boolean;
}

interface MigrationResult {
  success: boolean;
  projectsCreated: number;
  agentsCreated: number;
  flowsCreated: number;
  skillsCreated: number;
  attributesMigrated: number;
  personasCreated: number;
  articlesImported: number;
  connectorsCreated: number;
  webhooksCreated: number;
  errors: string[];
}

/**
 * Migrate complete account from source to destination
 */
export async function migrateAccount(options: MigrationOptions): Promise<MigrationResult> {
  const { sourceCustomer, destCustomer, sourceClient, destClient, verbose } = options;

  const result: MigrationResult = {
    success: false,
    projectsCreated: 0,
    agentsCreated: 0,
    flowsCreated: 0,
    skillsCreated: 0,
    attributesMigrated: 0,
    personasCreated: 0,
    articlesImported: 0,
    connectorsCreated: 0,
    webhooksCreated: 0,
    errors: []
  };

  try {
    console.log('\n🔄 Starting account migration...');
    console.log(`Source: ${sourceCustomer.idn}`);
    console.log(`Destination: ${destCustomer.idn}\n`);

    // Step 1: Pull source data
    console.log('📥 Step 1: Pulling source data...');
    await pullAll(sourceClient, sourceCustomer, null, verbose, true);
    await pullIntegrations(sourceClient, customerDir(sourceCustomer.idn), verbose);
    console.log('   ✅ Source data pulled\n');

    // Step 2: Create project structure
    console.log('🏗️  Step 2: Creating project structure...');
    const projectCounts = await migrateProjectStructure(sourceClient, destClient, sourceCustomer, destCustomer, verbose);
    result.projectsCreated = projectCounts.projects;
    result.agentsCreated = projectCounts.agents;
    result.flowsCreated = projectCounts.flows;
    result.skillsCreated = projectCounts.skills;
    console.log(`   ✅ Created: ${result.projectsCreated} projects, ${result.agentsCreated} agents, ${result.flowsCreated} flows, ${result.skillsCreated} skills\n`);

    // Step 3: Migrate attributes
    console.log('📊 Step 3: Migrating attributes...');
    result.attributesMigrated = await migrateAttributes(sourceClient, destClient, sourceCustomer, destCustomer, verbose);
    console.log(`   ✅ Migrated: ${result.attributesMigrated} attributes\n`);

    // Step 4: Migrate AKB
    console.log('📚 Step 4: Migrating AKB...');
    const akbCounts = await migrateAKB(sourceClient, destClient, verbose);
    result.personasCreated = akbCounts.personas;
    result.articlesImported = akbCounts.articles;
    console.log(`   ✅ Migrated: ${result.personasCreated} personas, ${result.articlesImported} articles\n`);

    // Step 5: Migrate integrations
    console.log('🔌 Step 5: Migrating integrations...');
    result.connectorsCreated = await migrateIntegrationConnectors(sourceClient, destClient, verbose);
    console.log(`   ✅ Created: ${result.connectorsCreated} connectors\n`);

    // Step 6: Copy files
    console.log('📁 Step 6: Copying files...');
    await copyAccountFiles(sourceCustomer.idn, destCustomer.idn);
    console.log('   ✅ Files copied\n');

    // Step 7: Build map from API
    console.log('📝 Step 7: Building destination mappings...');
    await buildMapFromAPI(destClient, destCustomer, verbose);
    console.log('   ✅ Mappings built\n');

    // Step 8: Push skill content
    console.log('📤 Step 8: Pushing skill content...');
    const skillsPushed = await pushSkillContent(destClient, destCustomer, verbose);
    console.log(`   ✅ Pushed: ${skillsPushed} skills\n`);

    // Step 9: Create webhooks
    console.log('📡 Step 9: Creating webhooks...');
    result.webhooksCreated = await createWebhooksFromYAML(destClient, destCustomer, verbose);
    console.log(`   ✅ Created: ${result.webhooksCreated} webhooks\n`);

    // Step 10: Verify
    console.log('✅ Step 10: Verifying migration...');
    await verifyMigration(sourceClient, destClient, sourceCustomer, destCustomer);

    result.success = true;
    console.log('\n🎉 MIGRATION COMPLETED SUCCESSFULLY!\n');

  } catch (error) {
    result.success = false;
    result.errors.push(error instanceof Error ? error.message : String(error));
    console.error(`\n❌ Migration failed: ${error instanceof Error ? error.message : String(error)}\n`);
  }

  return result;
}

async function migrateProjectStructure(
  sourceClient: AxiosInstance,
  destClient: AxiosInstance,
  sourceCustomer: CustomerConfig,
  // @ts-ignore - Parameter kept for API consistency
  destCustomer: CustomerConfig,
  // @ts-ignore - Parameter kept for future use
  verbose: boolean
): Promise<{ projects: number; agents: number; flows: number; skills: number }> {
  const sourceProjects = await listProjects(sourceClient);
  const destProjects = await listProjects(destClient);
  const destProjectMap = new Map(destProjects.map(p => [p.idn, p]));

  let projectsCreated = 0;
  let agentsCreated = 0;
  let flowsCreated = 0;
  let skillsCreated = 0;

  for (const sourceProj of sourceProjects) {
    let projectId: string;

    // Create or get existing project
    const existingProj = destProjectMap.get(sourceProj.idn);
    if (existingProj) {
      projectId = existingProj.id;
      if (verbose) console.log(`   ✓ Project ${sourceProj.idn} already exists`);
    } else {
      const projResponse = await createProject(destClient, {
        idn: sourceProj.idn,
        title: sourceProj.title,
        description: sourceProj.description || '',
        is_auto_update_enabled: sourceProj.is_auto_update_enabled || false,
        registry_idn: sourceProj.registry_idn || 'production'
      });
      projectId = projResponse.id;
      projectsCreated++;
      if (verbose) console.log(`   ✅ Created project: ${sourceProj.idn}`);
    }

    // Create agents
    const sourceAgents = await listAgents(sourceClient, sourceProj.id);
    const destAgents = await listAgents(destClient, projectId);
    const destAgentMap = new Map(destAgents.map(a => [a.idn, a]));

    for (const sourceAgent of sourceAgents) {
      let agentId: string;

      const existingAgent = destAgentMap.get(sourceAgent.idn);
      if (existingAgent) {
        agentId = existingAgent.id;
      } else {
        const agentResponse = await createAgent(destClient, projectId, {
          idn: sourceAgent.idn,
          title: sourceAgent.title || sourceAgent.idn,
          description: sourceAgent.description || null
        });
        agentId = agentResponse.id;
        agentsCreated++;
      }

      // Create flows
      const sourceFlows = sourceAgent.flows || [];
      const destAgentData = await listAgents(destClient, projectId);
      const destAgentWithFlows = destAgentData.find(a => a.id === agentId);
      const destFlowMap = new Map((destAgentWithFlows?.flows || []).map(f => [f.idn, f]));

      for (const sourceFlow of sourceFlows) {
        let flowId: string;

        const existingFlow = destFlowMap.get(sourceFlow.idn);
        if (existingFlow) {
          flowId = existingFlow.id;
        } else {
          const flowResponse = await createFlow(destClient, agentId, {
            idn: sourceFlow.idn,
            title: sourceFlow.title
          });
          flowId = flowResponse.id;
          flowsCreated++;
        }

        // Read flow metadata for events and states
        const flowMetaPath = path.join(
          customerProjectsDir(sourceCustomer.idn),
          sourceProj.idn,
          sourceAgent.idn,
          sourceFlow.idn,
          'metadata.yaml'
        );

        if (await fs.pathExists(flowMetaPath)) {
          const flowMeta = yaml.load(await fs.readFile(flowMetaPath, 'utf8')) as any;

          // Create skills
          const destSkills = await listFlowSkills(destClient, flowId);
          const destSkillMap = new Map(destSkills.map(s => [s.idn, s]));

          for (const sourceSkill of flowMeta.skills || []) {
            if (destSkillMap.has(sourceSkill.idn)) continue;

            try {
              await createSkill(destClient, flowId, {
                idn: sourceSkill.idn,
                title: sourceSkill.title,
                runner_type: sourceSkill.runner_type,
                model: sourceSkill.model,
                prompt_script: ''
              });
              skillsCreated++;
            } catch (error: any) {
              if (verbose && error.response?.status !== 409) {
                console.error(`   ⚠️  Failed to create skill ${sourceSkill.idn}: ${error.message}`);
              }
            }
          }

          // Create events with full metadata
          for (const event of flowMeta.events || []) {
            try {
              const eventRequest: CreateFlowEventRequest = {
                idn: event.idn,
                description: event.description || event.idn,
                skill_selector: event.skill_selector || 'first',
                interrupt_mode: event.interrupt_mode || 'allow',
                integration_idn: event.integration_idn || '',
                connector_idn: event.connector_idn || ''
              };

              if (event.skill_idn) {
                (eventRequest as any).skill_idn = event.skill_idn;
              }
              if (event.state_idn) {
                (eventRequest as any).state_idn = event.state_idn;
              }

              await createFlowEvent(destClient, flowId, eventRequest);
            } catch (error: any) {
              if (verbose && error.response?.status !== 409 && error.response?.status !== 422) {
                console.error(`   ⚠️  Failed to create event ${event.idn}: ${error.message}`);
              }
            }
          }

          // Create states
          for (const state of flowMeta.state_fields || []) {
            try {
              await createFlowState(destClient, flowId, {
                title: state.title || state.idn,
                idn: state.idn,
                scope: state.scope || 'flow'
              });
            } catch (error: any) {
              if (verbose && error.response?.status !== 409) {
                console.error(`   ⚠️  Failed to create state ${state.idn}: ${error.message}`);
              }
            }
          }
        }
      }
    }
  }

  return { projects: projectsCreated, agents: agentsCreated, flows: flowsCreated, skills: skillsCreated };
}

async function migrateAttributes(
  sourceClient: AxiosInstance,
  destClient: AxiosInstance,
  // @ts-ignore - Parameter kept for API consistency
  sourceCustomer: CustomerConfig,
  // @ts-ignore - Parameter kept for API consistency
  destCustomer: CustomerConfig,
  // @ts-ignore - Parameter kept for future use
  verbose: boolean
): Promise<number> {
  let count = 0;

  // Customer attributes
  const sourceAttrs = await getCustomerAttributes(sourceClient, true);
  const destAttrs = await getCustomerAttributes(destClient, true);
  const destAttrMap = new Map(destAttrs.attributes.map(a => [a.idn, a]));

  for (const sourceAttr of sourceAttrs.attributes) {
    const destAttr = destAttrMap.get(sourceAttr.idn);

    if (!destAttr) {
      await createCustomerAttribute(destClient, {
        idn: sourceAttr.idn,
        title: sourceAttr.title,
        description: sourceAttr.description || '',
        value: typeof sourceAttr.value === 'object' ? JSON.stringify(sourceAttr.value) : sourceAttr.value,
        value_type: sourceAttr.value_type,
        group: sourceAttr.group || '',
        is_hidden: sourceAttr.is_hidden || false,
        possible_values: sourceAttr.possible_values || []
      });
      count++;
    } else if (JSON.stringify(destAttr.value) !== JSON.stringify(sourceAttr.value)) {
      if (destAttr.id) {
        await updateCustomerAttribute(destClient, {
          ...sourceAttr,
          id: destAttr.id
        });
        count++;
      }
    }
  }

  // Project attributes
  const sourceProjects = await listProjects(sourceClient);
  const destProjects = await listProjects(destClient);
  const destProjectMap = new Map(destProjects.map(p => [p.idn, p]));

  for (const sourceProj of sourceProjects) {
    const destProj = destProjectMap.get(sourceProj.idn);
    if (!destProj) continue;

    const sourceProjAttrs = await getProjectAttributes(sourceClient, sourceProj.id, true);
    const destProjAttrs = await getProjectAttributes(destClient, destProj.id, true);
    const destProjAttrMap = new Map(destProjAttrs.attributes.map(a => [a.idn, a]));

    for (const sourceAttr of sourceProjAttrs.attributes) {
      const destAttr = destProjAttrMap.get(sourceAttr.idn);

      if (!destAttr) {
        await createProjectAttribute(destClient, destProj.id, {
          idn: sourceAttr.idn,
          title: sourceAttr.title,
          description: sourceAttr.description || '',
          value: typeof sourceAttr.value === 'object' ? JSON.stringify(sourceAttr.value) : sourceAttr.value,
          value_type: sourceAttr.value_type,
          group: sourceAttr.group || '',
          is_hidden: sourceAttr.is_hidden || false,
          possible_values: sourceAttr.possible_values || []
        });
        count++;
      } else if (JSON.stringify(destAttr.value) !== JSON.stringify(sourceAttr.value)) {
        await updateProjectAttribute(destClient, destProj.id, {
          ...destAttr,
          value: sourceAttr.value,
          title: sourceAttr.title,
          description: sourceAttr.description
        });
        count++;
      }
    }
  }

  return count;
}

async function migrateAKB(
  sourceClient: AxiosInstance,
  destClient: AxiosInstance,
  // @ts-ignore - Parameter kept for future use
  verbose: boolean
): Promise<{ personas: number; articles: number }> {
  const sourcePersonas = await searchPersonas(sourceClient, true);
  const destPersonas = await searchPersonas(destClient, true);
  const destPersonaMap = new Map(destPersonas.items.map(p => [p.name, p]));

  let personasCreated = 0;
  let articlesImported = 0;

  for (const sourcePersona of sourcePersonas.items) {
    if (destPersonaMap.has(sourcePersona.name)) continue;

    const newPersona = await createPersona(destClient, {
      name: sourcePersona.name,
      title: sourcePersona.title,
      description: sourcePersona.description || ''
    });
    personasCreated++;

    // Import articles
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const topics = await getAkbTopics(sourceClient, sourcePersona.id, page, 50);

      if (topics.items.length === 0) break;

      for (const topicItem of topics.items) {
        const articleData: AkbImportArticle = {
          persona_id: newPersona.id,
          topic_name: topicItem.topic.topic_name,
          source: topicItem.topic.source || '',
          topic_summary: topicItem.topic.topic_summary || '',
          topic_facts: topicItem.topic.topic_facts || [],
          labels: topicItem.topic.labels || [],
          confidence: topicItem.topic.confidence || 1.0
        };

        await importAkbArticle(destClient, articleData);
        articlesImported++;
      }

      page++;
      hasMore = topics.items.length >= 50;
    }
  }

  return { personas: personasCreated, articles: articlesImported };
}

async function migrateIntegrationConnectors(
  sourceClient: AxiosInstance,
  destClient: AxiosInstance,
  // @ts-ignore - Parameter kept for future use
  verbose: boolean
): Promise<number> {
  const sourceIntegrations = await listIntegrations(sourceClient);
  const destIntegrations = await listIntegrations(destClient);
  const destIntMap = new Map(destIntegrations.map(i => [i.idn, i]));

  let connectorsCreated = 0;

  for (const sourceInt of sourceIntegrations) {
    const destInt = destIntMap.get(sourceInt.idn);
    if (!destInt) continue;

    const sourceConnectors = await listConnectors(sourceClient, sourceInt.id);
    const destConnectors = await listConnectors(destClient, destInt.id);
    const destConnMap = new Map(destConnectors.map(c => [c.connector_idn, c]));

    for (const sourceConn of sourceConnectors) {
      if (destConnMap.has(sourceConn.connector_idn)) continue;

      try {
        await createConnector(destClient, destInt.id, {
          title: sourceConn.title,
          connector_idn: sourceConn.connector_idn,
          integration_idn: sourceInt.idn,
          settings: sourceConn.settings
        });
        connectorsCreated++;
      } catch (error: any) {
        if (verbose && error.response?.status !== 409) {
          console.error(`   ⚠️  Failed to create connector ${sourceConn.connector_idn}: ${error.message}`);
        }
      }
    }
  }

  return connectorsCreated;
}

async function copyAccountFiles(sourceIdn: string, destIdn: string): Promise<void> {
  const sourceDir = customerDir(sourceIdn);
  const destDir = customerDir(destIdn);

  await fs.ensureDir(destDir);

  // Copy projects
  const sourceProjects = path.join(sourceDir, 'projects');
  const destProjects = path.join(destDir, 'projects');
  if (await fs.pathExists(sourceProjects)) {
    await fs.copy(sourceProjects, destProjects);
  }

  // Copy integrations
  const sourceIntegrations = path.join(sourceDir, 'integrations');
  const destIntegrations = path.join(destDir, 'integrations');
  if (await fs.pathExists(sourceIntegrations)) {
    await fs.copy(sourceIntegrations, destIntegrations);
  }

  // Copy AKB
  const sourceAkb = path.join(sourceDir, 'akb');
  const destAkb = path.join(destDir, 'akb');
  if (await fs.pathExists(sourceAkb)) {
    await fs.copy(sourceAkb, destAkb);
  }

  // Copy attributes
  const sourceAttrs = path.join(sourceDir, 'attributes.yaml');
  const destAttrs = path.join(destDir, 'attributes.yaml');
  if (await fs.pathExists(sourceAttrs)) {
    await fs.copy(sourceAttrs, destAttrs);
  }
}

async function buildMapFromAPI(
  destClient: AxiosInstance,
  destCustomer: CustomerConfig,
  // @ts-ignore - Parameter kept for future use
  verbose: boolean
): Promise<void> {
  const newoDir = path.join('.newo', destCustomer.idn);
  await fs.ensureDir(newoDir);

  const projects = await listProjects(destClient);
  const projectMap: any = { projects: {} };

  for (const project of projects.filter(p => p.idn !== 'test')) {
    const agents = await listAgents(destClient, project.id);
    const projectData: any = {
      projectId: project.id,
      projectIdn: project.idn,
      agents: {}
    };

    for (const agent of agents) {
      projectData.agents[agent.idn] = {
        id: agent.id,
        flows: {}
      };

      for (const flow of agent.flows || []) {
        const skills = await listFlowSkills(destClient, flow.id);
        const skillMap: any = {};

        for (const skill of skills) {
          skillMap[skill.idn] = {
            id: skill.id,
            idn: skill.idn,
            title: skill.title,
            runner_type: skill.runner_type,
            model: skill.model,
            parameters: skill.parameters,
            path: skill.path
          };
        }

        projectData.agents[agent.idn].flows[flow.idn] = {
          id: flow.id,
          skills: skillMap
        };
      }
    }

    projectMap.projects[project.idn] = projectData;
  }

  await fs.writeJson(path.join(newoDir, 'map.json'), projectMap, { spaces: 2 });
  await fs.writeJson(path.join(newoDir, 'hashes.json'), {}, { spaces: 2 });
}

async function pushSkillContent(
  destClient: AxiosInstance,
  destCustomer: CustomerConfig,
  // @ts-ignore - Parameter kept for future use
  verbose: boolean
): Promise<number> {
  const mapPath = path.join('.newo', destCustomer.idn, 'map.json');
  const projectMap = await fs.readJson(mapPath) as any;
  const destDir = customerDir(destCustomer.idn);

  let pushedCount = 0;

  for (const [projectIdn, projectData] of Object.entries(projectMap.projects || {})) {
    const typedProjectData = projectData as any;

    for (const [agentIdn, agentData] of Object.entries(typedProjectData.agents || {})) {
      const typedAgentData = agentData as any;

      for (const [flowIdn, flowData] of Object.entries(typedAgentData.flows || {})) {
        const typedFlowData = flowData as any;

        for (const [skillIdn, skillData] of Object.entries(typedFlowData.skills || {})) {
          const typedSkillData = skillData as any;
          const extension = typedSkillData.runner_type === 'nsl' ? 'jinja' : 'guidance';

          const skillFilePath = path.join(
            destDir,
            'projects',
            projectIdn,
            agentIdn,
            flowIdn,
            skillIdn,
            `${skillIdn}.${extension}`
          );

          if (await fs.pathExists(skillFilePath)) {
            const content = await fs.readFile(skillFilePath, 'utf8');

            if (content.trim().length > 0) {
              try {
                await updateSkill(destClient, {
                  ...typedSkillData,
                  prompt_script: content
                });
                pushedCount++;

                if (pushedCount % 100 === 0 && verbose) {
                  console.log(`   Progress: ${pushedCount} skills pushed...`);
                }
              } catch (error: any) {
                if (verbose) {
                  console.error(`   ⚠️  Failed to push ${skillIdn}: ${error.message}`);
                }
              }
            }
          }
        }
      }
    }
  }

  return pushedCount;
}

async function createWebhooksFromYAML(
  destClient: AxiosInstance,
  destCustomer: CustomerConfig,
  // @ts-ignore - Parameter kept for future use
  verbose: boolean
): Promise<number> {
  const destDir = customerDir(destCustomer.idn);
  let webhooksCreated = 0;

  // Outgoing webhooks
  const outgoingFile = path.join(destDir, 'integrations/api/connectors/webhook/webhooks/outgoing.yaml');
  if (await fs.pathExists(outgoingFile)) {
    const outgoingData = yaml.load(await fs.readFile(outgoingFile, 'utf8')) as any;
    const webhooks = outgoingData.webhooks || [];

    for (const webhook of webhooks) {
      try {
        await destClient.post('/api/v1/webhooks', {
          idn: webhook.idn,
          description: webhook.description || '',
          connector_idn: webhook.connector_idn,
          url: webhook.url,
          command_idns: webhook.command_idns || []
        });
        webhooksCreated++;
      } catch (error: any) {
        if (error.response?.status !== 409 && verbose) {
          console.error(`   ⚠️  Failed to create webhook ${webhook.idn}: ${error.message}`);
        }
      }
    }
  }

  // Incoming webhooks
  const incomingFile = path.join(destDir, 'integrations/api/connectors/webhook/webhooks/incoming.yaml');
  if (await fs.pathExists(incomingFile)) {
    const incomingData = yaml.load(await fs.readFile(incomingFile, 'utf8')) as any;
    const webhooks = incomingData.webhooks || [];

    for (const webhook of webhooks) {
      try {
        await destClient.post('/api/v1/webhooks/incoming', {
          idn: webhook.idn,
          description: webhook.description || '',
          connector_idn: webhook.connector_idn,
          event_idns: webhook.event_idns || [],
          allowed_ips: webhook.allowed_ips || []
        });
        webhooksCreated++;
      } catch (error: any) {
        if (error.response?.status !== 409 && verbose) {
          console.error(`   ⚠️  Failed to create webhook ${webhook.idn}: ${error.message}`);
        }
      }
    }
  }

  return webhooksCreated;
}

async function verifyMigration(
  sourceClient: AxiosInstance,
  destClient: AxiosInstance,
  // @ts-ignore - Parameter kept for API consistency
  sourceCustomer: CustomerConfig,
  // @ts-ignore - Parameter kept for API consistency
  destCustomer: CustomerConfig
): Promise<void> {
  const sourceProjects = await listProjects(sourceClient);
  const destProjects = await listProjects(destClient);

  let srcSkills = 0;
  let dstSkills = 0;

  for (const proj of sourceProjects) {
    const agents = await listAgents(sourceClient, proj.id);
    for (const agent of agents) {
      for (const flow of agent.flows || []) {
        const skills = await listFlowSkills(sourceClient, flow.id);
        srcSkills += skills.length;
      }
    }
  }

  for (const proj of destProjects.filter(p => p.idn !== 'test')) {
    const agents = await listAgents(destClient, proj.id);
    for (const agent of agents) {
      for (const flow of agent.flows || []) {
        const skills = await listFlowSkills(destClient, flow.id);
        dstSkills += skills.length;
      }
    }
  }

  console.log(`   Skills: ${srcSkills} source → ${dstSkills} destination ${srcSkills === dstSkills ? '✅' : '❌'}`);

  if (srcSkills !== dstSkills) {
    throw new Error(`Skill count mismatch: ${srcSkills} source vs ${dstSkills} destination`);
  }

  console.log('   ✅ Verification passed');
}
