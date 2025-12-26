/**
 * AkbSyncStrategy - Handles synchronization of AKB (Knowledge Base) articles
 *
 * This strategy implements ISyncStrategy for the AKB resource.
 *
 * Key responsibilities:
 * - Pull AKB articles from NEWO platform
 * - Link articles to personas via agents
 * - Push changed articles back to platform
 * - Detect changes using stored hashes
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
  Persona,
  AkbTopicItem,
  AkbYamlTopic,
  AkbImportArticle
} from '../../../types.js';
import fs from 'fs-extra';
import yaml from 'js-yaml';
import path from 'path';
import { searchPersonas, getAkbTopics, importAkbArticle } from '../../../api.js';
import { sha256, saveHashes, loadHashes } from '../../../hash.js';

/**
 * Local AKB data for storage
 */
export interface LocalAkbData {
  agentIdn: string;
  personaId: string;
  personaName: string;
  topics: AkbYamlTopic[];
}

/**
 * API client factory type
 */
export type ApiClientFactory = (customer: CustomerConfig, verbose: boolean) => Promise<AxiosInstance>;

/**
 * AkbSyncStrategy - Handles AKB synchronization
 */
export class AkbSyncStrategy implements ISyncStrategy<Persona, LocalAkbData> {
  readonly resourceType = 'akb';
  readonly displayName = 'Knowledge Base (AKB)';

  constructor(
    private apiClientFactory: ApiClientFactory,
    private logger: ILogger
  ) {}

  /**
   * Pull all AKB articles from NEWO platform
   */
  async pull(customer: CustomerConfig, options: PullOptions = {}): Promise<PullResult<LocalAkbData>> {
    const client = await this.apiClientFactory(customer, options.verbose ?? false);
    const hashes: HashStore = {};
    const items: LocalAkbData[] = [];

    this.logger.verbose(`🔍 Fetching AKB articles for ${customer.idn}...`);

    const customerDir = path.join(process.cwd(), 'newo_customers', customer.idn);
    const akbDir = path.join(customerDir, 'akb');
    await fs.ensureDir(akbDir);

    // Fetch personas linked to agents with pagination
    let allPersonas: Persona[] = [];
    let page = 1;
    const perPage = 30;

    while (true) {
      const response = await searchPersonas(client, true, page, perPage);
      allPersonas = allPersonas.concat(response.items);

      this.logger.verbose(`  📖 Fetched ${response.items.length} personas (page ${page})`);

      if (response.items.length < perPage || allPersonas.length >= response.metadata.total) {
        break;
      }
      page++;
    }

    this.logger.verbose(`📚 Found ${allPersonas.length} personas linked to agents`);

    let totalArticles = 0;

    // Fetch AKB articles for each persona
    for (const persona of allPersonas) {
      this.logger.verbose(`  📖 Processing persona: ${persona.name} (${persona.agent.idn})`);

      // Fetch all AKB topics for this persona
      let allTopicItems: AkbTopicItem[] = [];
      let topicPage = 1;
      const topicsPerPage = 100;

      while (true) {
        try {
          const topicsResponse = await getAkbTopics(client, persona.id, topicPage, topicsPerPage);
          allTopicItems = allTopicItems.concat(topicsResponse.items);

          if (topicsResponse.items.length < topicsPerPage || allTopicItems.length >= topicsResponse.metadata.total) {
            break;
          }
          topicPage++;
        } catch (error) {
          this.logger.warn(`Could not fetch topics for ${persona.name}`);
          break;
        }
      }

      if (allTopicItems.length > 0) {
        // Convert to YAML format
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
        const yamlContent = yaml.dump(yamlTopics, { lineWidth: -1 });
        await fs.writeFile(akbFile, yamlContent);

        hashes[akbFile] = sha256(yamlContent);
        totalArticles += allTopicItems.length;

        this.logger.verbose(`    ✓ Saved ${allTopicItems.length} articles → ${agentIdn}.yaml`);

        items.push({
          agentIdn,
          personaId: persona.id,
          personaName: persona.name,
          topics: yamlTopics
        });
      } else {
        this.logger.verbose(`    ℹ No AKB articles found for this persona`);
      }
    }

    // Save hashes
    const existingHashes = await loadHashes(customer.idn);
    await saveHashes({ ...existingHashes, ...hashes }, customer.idn);

    this.logger.info(`✅ Saved ${totalArticles} AKB articles for ${allPersonas.length} personas`);

    return {
      items,
      count: items.length,
      hashes
    };
  }

  /**
   * Push changed AKB articles to NEWO platform
   */
  async push(customer: CustomerConfig, changes?: ChangeItem<LocalAkbData>[]): Promise<PushResult> {
    const result: PushResult = { created: 0, updated: 0, deleted: 0, errors: [] };

    if (!changes) {
      changes = await this.getChanges(customer);
    }

    if (changes.length === 0) {
      return result;
    }

    const client = await this.apiClientFactory(customer, false);
    const customerDir = path.join(process.cwd(), 'newo_customers', customer.idn);
    const akbDir = path.join(customerDir, 'akb');

    if (!await fs.pathExists(akbDir)) {
      return result;
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
      personaMap.set(persona.name, persona.id);
    });

    // Process changes
    for (const change of changes) {
      const akbFile = change.path;
      const fileBase = path.basename(akbFile).replace('.yaml', '');
      const personaId = personaMap.get(fileBase);

      if (!personaId) {
        result.errors.push(`Persona not found for file: ${path.basename(akbFile)}`);
        continue;
      }

      try {
        const topics = yaml.load(await fs.readFile(akbFile, 'utf-8')) as AkbYamlTopic[];

        if (!Array.isArray(topics)) {
          result.errors.push(`Invalid YAML format in ${path.basename(akbFile)}`);
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
            result.created++;

            this.logger.info(`  ✓ Imported: ${topic.topic_name}`);
          } catch (error) {
            result.errors.push(`Failed to import ${topic.topic_name}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } catch (error) {
        result.errors.push(`Failed to read ${path.basename(akbFile)}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return result;
  }

  /**
   * Detect changes in AKB files
   */
  async getChanges(customer: CustomerConfig): Promise<ChangeItem<LocalAkbData>[]> {
    const changes: ChangeItem<LocalAkbData>[] = [];
    const hashes = await loadHashes(customer.idn);

    const customerDir = path.join(process.cwd(), 'newo_customers', customer.idn);
    const akbDir = path.join(customerDir, 'akb');

    if (!await fs.pathExists(akbDir)) {
      return changes;
    }

    const akbFiles = await fs.readdir(akbDir);

    for (const file of akbFiles) {
      if (!file.endsWith('.yaml')) continue;

      const akbFile = path.join(akbDir, file);
      const content = await fs.readFile(akbFile, 'utf-8');
      const currentHash = sha256(content);
      const storedHash = hashes[akbFile];

      if (storedHash !== currentHash) {
        const agentIdn = file.replace('.yaml', '');

        changes.push({
          item: {
            agentIdn,
            personaId: '',
            personaName: '',
            topics: yaml.load(content) as AkbYamlTopic[]
          },
          operation: storedHash ? 'modified' : 'created',
          path: akbFile
        });
      }
    }

    return changes;
  }

  /**
   * Validate AKB data
   */
  async validate(_customer: CustomerConfig, items: LocalAkbData[]): Promise<ValidationResult> {
    const errors: ValidationError[] = [];

    for (const item of items) {
      if (!item.agentIdn) {
        errors.push({
          field: 'agentIdn',
          message: 'Agent IDN is required'
        });
      }

      for (const topic of item.topics) {
        if (!topic.topic_name) {
          errors.push({
            field: 'topic_name',
            message: 'Topic name is required'
          });
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
}

/**
 * Factory function for creating AkbSyncStrategy
 */
export function createAkbSyncStrategy(
  apiClientFactory: ApiClientFactory,
  logger: ILogger
): AkbSyncStrategy {
  return new AkbSyncStrategy(apiClientFactory, logger);
}
