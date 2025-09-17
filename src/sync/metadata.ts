/**
 * Metadata and flows.yaml generation operations
 */
import {
  writeFileSafe,
  flowMetadataPath,
  agentMetadataPath,
  skillScriptPath,
  flowsYamlPath
} from '../fsutil.js';
import fs from 'fs-extra';
import yaml from 'js-yaml';
import type {
  ProjectData,
  ProjectMap,
  FlowsYamlData,
  FlowsYamlFlow,
  FlowsYamlSkill,
  FlowMetadata,
  AgentMetadata,
  SkillMetadata
} from '../types.js';

/**
 * Generate flows.yaml file from project data
 */
export async function generateFlowsYaml(
  projectMap: ProjectMap | { [key: string]: ProjectData },
  customerIdn: string,
  verbose: boolean = false
): Promise<void> {
  if (verbose) console.log(`📊 Generating flows.yaml for customer ${customerIdn}...`);

  const flowsData: FlowsYamlData = {
    flows: []
  };

  // Handle both formats
  const projects = 'projects' in projectMap ? projectMap.projects : projectMap;

  for (const [projectIdn, projectData] of Object.entries(projects)) {
    if (verbose && projectIdn) console.log(`  📁 Processing project: ${projectIdn}`);

    for (const [agentIdn, agentData] of Object.entries(projectData.agents as Record<string, any>)) {
      if (verbose) console.log(`    📁 Processing agent: ${agentIdn}`);

      const agentFlows: FlowsYamlFlow[] = [];

      for (const [flowIdn, flowData] of Object.entries(agentData.flows as Record<string, any>)) {
        if (verbose) console.log(`      📁 Processing flow: ${flowIdn}`);

        // Load flow metadata to get comprehensive flow information
        const flowMetaPath = flowMetadataPath(customerIdn, projectIdn, agentIdn, flowIdn);
        let flowMeta: FlowMetadata | null = null;

        try {
          if (await fs.pathExists(flowMetaPath)) {
            const flowMetaContent = await fs.readFile(flowMetaPath, 'utf8');
            flowMeta = yaml.load(flowMetaContent) as FlowMetadata;
          }
        } catch (e) {
          if (verbose) console.log(`        ⚠️  Could not load flow metadata: ${flowMetaPath}`);
        }

        const skills: FlowsYamlSkill[] = [];
        for (const [skillIdn, skillMeta] of Object.entries(flowData.skills as Record<string, SkillMetadata>)) {
          // Load skill script content using the new file discovery
          const { getSingleSkillFile } = await import('./skill-files.js');
          const skillFile = await getSingleSkillFile(customerIdn, projectIdn, agentIdn, flowIdn, skillIdn);

          let scriptContent = '';
          if (skillFile) {
            scriptContent = skillFile.content;
          } else {
            // Fallback to old path for backward compatibility
            const scriptPath = skillScriptPath(customerIdn, projectIdn, agentIdn, flowIdn, skillIdn, skillMeta.runner_type);
            try {
              if (await fs.pathExists(scriptPath)) {
                scriptContent = await fs.readFile(scriptPath, 'utf8');
              }
            } catch (e) {
              if (verbose) console.log(`        ⚠️  Could not load script for ${skillIdn}`);
            }
          }

          skills.push({
            idn: skillMeta.idn,
            title: skillMeta.title,
            prompt_script: scriptContent,
            runner_type: skillMeta.runner_type,
            model: skillMeta.model,
            parameters: skillMeta.parameters.map((p: any) => ({
              name: p.name,
              default_value: p.default_value || ''
            }))
          });
        }

        // Use flow metadata if available, otherwise use basic info
        const flowYaml: FlowsYamlFlow = {
          idn: flowIdn,
          title: flowMeta?.title || 'Unknown Flow',
          description: flowMeta?.description || null,
          default_runner_type: flowMeta?.default_runner_type || 'guidance',
          default_provider_idn: flowMeta?.default_model?.provider_idn || 'openai',
          default_model_idn: flowMeta?.default_model?.model_idn || 'gpt-4',
          skills,
          events: flowMeta?.events?.map(event => ({
            title: event.description,
            idn: event.idn,
            skill_selector: event.skill_selector,
            skill_idn: event.skill_idn || null,
            state_idn: event.state_idn || null,
            integration_idn: event.integration_idn || null,
            connector_idn: event.connector_idn || null,
            interrupt_mode: event.interrupt_mode
          })) || [],
          state_fields: flowMeta?.state_fields?.map(state => ({
            title: state.title,
            idn: state.idn,
            default_value: state.default_value || null,
            scope: state.scope
          })) || []
        };

        agentFlows.push(flowYaml);
      }

      if (agentFlows.length > 0) {
        // Load agent metadata for description
        const agentMetaPath = agentMetadataPath(customerIdn, projectIdn, agentIdn);
        let agentDescription: string | null = null;

        try {
          if (await fs.pathExists(agentMetaPath)) {
            const agentMetaContent = await fs.readFile(agentMetaPath, 'utf8');
            const agentMeta = yaml.load(agentMetaContent) as AgentMetadata;
            agentDescription = agentMeta.description || null;
          }
        } catch (e) {
          if (verbose) console.log(`      ⚠️  Could not load agent metadata: ${agentMetaPath}`);
        }

        flowsData.flows.push({
          agent_idn: agentIdn,
          agent_description: agentDescription,
          agent_flows: agentFlows
        });
      }
    }
  }

  // Save flows.yaml
  const flowsYamlContent = yaml.dump(flowsData, {
    indent: 2,
    quotingType: '"',
    forceQuotes: false,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
    flowLevel: -1
  });

  const flowsFilePath = flowsYamlPath(customerIdn);
  await writeFileSafe(flowsFilePath, flowsYamlContent);

  if (verbose) console.log(`✓ Generated flows.yaml with ${flowsData.flows.length} agents`);
}