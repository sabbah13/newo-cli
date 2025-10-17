/**
 * AKB (Knowledge Base) synchronization module
 * Handles pull/push of AKB articles for personas with agents
 */

import path from 'path';
import fs from 'fs-extra';
import yaml from 'js-yaml';
import type { AxiosInstance } from 'axios';
import { searchPersonas, getAkbTopics, importAkbArticle } from '../api.js';
import type {
  Persona,
  AkbTopicItem,
  AkbYamlTopic,
  AkbImportArticle
} from '../types.js';

/**
 * Pull AKB articles for all personas linked to agents
 */
export async function pullAkb(
  client: AxiosInstance,
  customerDir: string,
  verbose: boolean = false
): Promise<void> {
  if (verbose) console.log('\n📚 Pulling AKB (Knowledge Base) from NEWO platform...\n');

  // Create AKB directory
  const akbDir = path.join(customerDir, 'akb');
  await fs.ensureDir(akbDir);

  // Fetch personas linked to agents
  let allPersonas: Persona[] = [];
  let page = 1;
  const perPage = 30;

  while (true) {
    const response = await searchPersonas(client, true, page, perPage);
    allPersonas = allPersonas.concat(response.items);

    if (verbose) console.log(`✓ Fetched ${response.items.length} personas (page ${page}/${Math.ceil(response.metadata.total / perPage)})`);

    if (response.items.length < perPage || allPersonas.length >= response.metadata.total) {
      break;
    }
    page++;
  }

  if (verbose) console.log(`\n✓ Found ${allPersonas.length} personas linked to agents`);

  let totalArticles = 0;

  // Fetch AKB articles for each persona
  for (const persona of allPersonas) {
    if (verbose) console.log(`\n  📖 Processing persona: ${persona.name} (${persona.agent.idn})`);

    // Fetch all AKB topics for this persona
    let allTopicItems: AkbTopicItem[] = [];
    let topicPage = 1;
    const topicsPerPage = 100;

    while (true) {
      try {
        const topicsResponse = await getAkbTopics(client, persona.id, topicPage, topicsPerPage);
        allTopicItems = allTopicItems.concat(topicsResponse.items);

        if (verbose) console.log(`     ✓ Fetched ${topicsResponse.items.length} topics (page ${topicPage})`);

        if (topicsResponse.items.length < topicsPerPage || allTopicItems.length >= topicsResponse.metadata.total) {
          break;
        }
        topicPage++;
      } catch (error: any) {
        if (verbose) console.log(`     ⚠ Could not fetch topics: ${error.message}`);
        break;
      }
    }

    if (allTopicItems.length > 0) {
      // Convert to YAML format (extract topic from each item)
      const yamlTopics: AkbYamlTopic[] = allTopicItems.map(item => ({
        topic_name: item.topic.topic_name,
        topic_facts: [...item.topic.topic_facts],
        confidence: item.topic.confidence,
        source: item.topic.source,
        created_at: item.topic.created_at,
        updated_at: item.topic.updated_at,
        labels: [...item.topic.labels],
        topic_summary: item.topic.topic_summary
      }));

      // Save to persona-specific YAML file using agent IDN
      const agentIdn = persona.agent.idn;
      const akbFile = path.join(akbDir, `${agentIdn}.yaml`);
      await fs.writeFile(akbFile, yaml.dump(yamlTopics, { lineWidth: -1 }));

      if (verbose) console.log(`     ✓ Saved ${allTopicItems.length} articles → ${agentIdn}.yaml`);
      totalArticles += allTopicItems.length;
    } else {
      if (verbose) console.log(`     ℹ No AKB articles found for this persona`);
    }
  }

  if (verbose) {
    console.log(`\n✅ Saved AKB articles for ${allPersonas.length} personas`);
    console.log(`   Total articles: ${totalArticles}\n`);
  }
}

/**
 * Push AKB articles from local files to NEWO platform
 */
export async function pushAkb(
  client: AxiosInstance,
  customerDir: string,
  verbose: boolean = false
): Promise<void> {
  if (verbose) console.log('\n📤 Pushing AKB articles to NEWO platform...\n');

  const akbDir = path.join(customerDir, 'akb');

  // Check if AKB directory exists
  if (!await fs.pathExists(akbDir)) {
    if (verbose) console.log('⚠ No akb directory found. Run pull-akb first.');
    return;
  }

  // Get personas linked to agents for ID mapping
  let allPersonas: Persona[] = [];
  let page = 1;
  const perPage = 30;

  while (true) {
    const response = await searchPersonas(client, true, page, perPage);
    allPersonas = allPersonas.concat(response.items);
    if (response.items.length < perPage || allPersonas.length >= response.metadata.total) {
      break;
    }
    page++;
  }

  // Create persona mapping (agent.idn -> persona.id)
  const personaMap = new Map<string, string>();
  allPersonas.forEach(persona => {
    personaMap.set(persona.agent.idn, persona.id);
    personaMap.set(persona.name, persona.id); // Also map by name as fallback
  });

  // Read AKB files
  const akbFiles = await fs.readdir(akbDir);
  let totalImported = 0;
  let totalFailed = 0;

  for (const file of akbFiles) {
    if (!file.endsWith('.yaml')) continue;

    const fileBase = file.replace('.yaml', '');
    const personaId = personaMap.get(fileBase);

    if (!personaId) {
      if (verbose) console.log(`⚠ Persona not found for file: ${file}, skipping...`);
      continue;
    }

    if (verbose) console.log(`\n  📖 Processing: ${file}`);

    // Read YAML file
    const akbFile = path.join(akbDir, file);
    const topics = yaml.load(await fs.readFile(akbFile, 'utf-8')) as AkbYamlTopic[];

    if (!Array.isArray(topics)) {
      if (verbose) console.log(`     ⚠ Invalid YAML format, skipping...`);
      continue;
    }

    // Import each article
    for (const topic of topics) {
      try {
        const articleData: AkbImportArticle = {
          topic_name: topic.topic_name,
          topic_summary: topic.topic_summary,
          topic_facts: topic.topic_facts,
          confidence: topic.confidence,
          source: topic.source,
          labels: topic.labels,
          persona_id: personaId
        };

        await importAkbArticle(client, articleData);
        totalImported++;

        if (verbose) console.log(`     ✓ Imported: ${topic.topic_name}`);
      } catch (error: any) {
        totalFailed++;
        if (verbose) console.error(`     ❌ Failed to import ${topic.topic_name}: ${error.message}`);
      }
    }
  }

  if (verbose) {
    console.log(`\n✅ Push completed:`);
    console.log(`   Imported: ${totalImported}`);
    console.log(`   Failed: ${totalFailed}\n`);
  }
}