/**
 * ConversationSyncStrategy - Handles synchronization of Conversation history
 *
 * This strategy implements ISyncStrategy for the Conversations resource.
 * Note: This is a pull-only strategy as conversations are read-only.
 *
 * Key responsibilities:
 * - Pull conversation history from NEWO platform
 * - Process user personas and their acts
 * - Save conversations to YAML format
 */

import type {
  ISyncStrategy,
  PullOptions,
  PullResult,
  PushResult,
  ChangeItem,
  ValidationResult,
  StatusSummary
} from './ISyncStrategy.js';
import type { CustomerConfig, ILogger, HashStore } from '../../resources/common/types.js';
import type { AxiosInstance } from 'axios';
import type {
  UserPersona,
  ConversationAct,
  ProcessedPersona,
  ProcessedAct
} from '../../../types.js';
import fs from 'fs-extra';
import yaml from 'js-yaml';
import path from 'path';
import pLimit from 'p-limit';
import { listUserPersonas, getChatHistory } from '../../../api.js';
import { sha256, saveHashes, loadHashes } from '../../../hash.js';

// Concurrency limit for API calls
const concurrencyLimit = pLimit(5);

/**
 * Local conversation data for storage
 */
export interface LocalConversationData {
  personas: ProcessedPersona[];
  totalActs: number;
}

/**
 * API client factory type
 */
export type ApiClientFactory = (customer: CustomerConfig, verbose: boolean) => Promise<AxiosInstance>;

/**
 * ConversationSyncStrategy - Handles conversation synchronization
 */
export class ConversationSyncStrategy implements ISyncStrategy<UserPersona, LocalConversationData> {
  readonly resourceType = 'conversations';
  readonly displayName = 'Conversations';

  constructor(
    private apiClientFactory: ApiClientFactory,
    private logger: ILogger
  ) {}

  /**
   * Pull all conversations from NEWO platform
   */
  async pull(customer: CustomerConfig, options: PullOptions = {}): Promise<PullResult<LocalConversationData>> {
    const client = await this.apiClientFactory(customer, options.verbose ?? false);
    const hashes: HashStore = {};

    this.logger.verbose(`💬 Fetching conversations for ${customer.idn}...`);

    const customerDir = path.join(process.cwd(), 'newo_customers', customer.idn);
    await fs.ensureDir(customerDir);

    // Get all user personas with pagination
    const allPersonas: UserPersona[] = [];
    let page = 1;
    const perPage = 50;
    let hasMore = true;

    while (hasMore) {
      const response = await listUserPersonas(client, page, perPage);
      allPersonas.push(...response.items);

      this.logger.verbose(`  📋 Page ${page}: Found ${response.items.length} personas (${allPersonas.length}/${response.metadata.total} total)`);

      hasMore = response.items.length === perPage && allPersonas.length < response.metadata.total;
      page++;
    }

    this.logger.verbose(`👥 Processing ${allPersonas.length} personas...`);

    // Process personas concurrently with limited concurrency
    const processedPersonas: ProcessedPersona[] = [];
    let totalActs = 0;

    await Promise.all(allPersonas.map(persona => concurrencyLimit(async () => {
      try {
        // Extract phone number from actors
        const phoneActor = persona.actors.find(actor =>
          actor.integration_idn === 'newo_voice' &&
          actor.connector_idn === 'newo_voice_connector' &&
          actor.contact_information?.startsWith('+')
        );
        const phone = phoneActor?.contact_information || null;

        // Get user actor IDs from persona actors
        const userActors = persona.actors.filter(actor =>
          actor.integration_idn === 'newo_voice' &&
          actor.connector_idn === 'newo_voice_connector'
        );

        if (userActors.length === 0) {
          processedPersonas.push({
            id: persona.id,
            name: persona.name,
            phone,
            act_count: persona.act_count,
            acts: []
          });
          return;
        }

        // Fetch chat history
        const allActs: ConversationAct[] = [];
        let actPage = 1;
        const actsPerPage = 100;
        let hasMoreActs = true;
        const maxPages = 50;

        while (hasMoreActs && actPage <= maxPages) {
          try {
            const chatHistoryParams = {
              user_actor_id: userActors[0]!.id,
              page: actPage,
              per: actsPerPage
            };

            const chatResponse = await getChatHistory(client, chatHistoryParams);

            if (chatResponse.items && chatResponse.items.length > 0) {
              const convertedActs: ConversationAct[] = chatResponse.items.map((item: Record<string, unknown>) => ({
                id: (item.id as string) || `chat_${Math.random()}`,
                command_act_id: null,
                external_event_id: (item.external_event_id as string) || 'chat_history',
                arguments: [],
                reference_idn: item.is_agent === true ? 'agent_message' : 'user_message',
                runtime_context_id: (item.runtime_context_id as string) || 'chat_history',
                source_text: (item.payload as Record<string, unknown>)?.text as string || (item.message as string) || '',
                original_text: (item.payload as Record<string, unknown>)?.text as string || (item.message as string) || '',
                datetime: (item.datetime as string) || (item.created_at as string) || new Date().toISOString(),
                user_actor_id: userActors[0]!.id,
                agent_actor_id: null,
                user_persona_id: persona.id,
                user_persona_name: persona.name,
                agent_persona_id: (item.agent_persona_id as string) || 'unknown',
                external_id: (item.external_id as string) || null,
                integration_idn: 'newo_voice',
                connector_idn: 'newo_voice_connector',
                to_integration_idn: null,
                to_connector_idn: null,
                is_agent: Boolean(item.is_agent === true),
                project_idn: null,
                flow_idn: (item.flow_idn as string) || 'unknown',
                skill_idn: (item.skill_idn as string) || 'unknown',
                session_id: (item.session_id as string) || 'unknown',
                recordings: (item.recordings as unknown[]) || [],
                contact_information: (item.contact_information as string) || null
              }));

              allActs.push(...convertedActs);

              hasMoreActs = chatResponse.items.length === actsPerPage &&
                           (!chatResponse.metadata?.total || allActs.length < chatResponse.metadata.total);
              actPage++;
            } else {
              hasMoreActs = false;
            }
          } catch (_error) {
            hasMoreActs = false;
          }
        }

        // Process acts for YAML output
        const processedActs: ProcessedAct[] = allActs
          .sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime())
          .map(act => ({
            datetime: act.datetime,
            type: act.is_agent ? 'agent' : 'user',
            message: act.source_text,
            contact_information: act.contact_information,
            flow_idn: act.flow_idn,
            skill_idn: act.skill_idn,
            session_id: act.session_id
          }));

        processedPersonas.push({
          id: persona.id,
          name: persona.name,
          phone,
          act_count: persona.act_count,
          acts: processedActs
        });

        totalActs += processedActs.length;

        this.logger.verbose(`  ✓ Processed ${persona.name}: ${processedActs.length} acts`);
      } catch (error) {
        this.logger.warn(`Failed to process persona ${persona.name}`);
      }
    })));

    // Sort personas by most recent activity
    processedPersonas.sort((a, b) => {
      const aLastAct = a.acts[a.acts.length - 1]?.datetime;
      const bLastAct = b.acts[b.acts.length - 1]?.datetime;
      if (!aLastAct && !bLastAct) return 0;
      if (!aLastAct) return 1;
      if (!bLastAct) return -1;
      return new Date(bLastAct).getTime() - new Date(aLastAct).getTime();
    });

    // Save to YAML
    const conversationsFile = path.join(customerDir, 'conversations.yaml');
    const yamlContent = yaml.dump({ personas: processedPersonas }, { lineWidth: -1 });
    await fs.writeFile(conversationsFile, yamlContent);

    hashes[conversationsFile] = sha256(yamlContent);

    // Save hashes
    const existingHashes = await loadHashes(customer.idn);
    await saveHashes({ ...existingHashes, ...hashes }, customer.idn);

    this.logger.info(`✅ Saved ${processedPersonas.length} personas with ${totalActs} conversation acts`);

    return {
      items: [{
        personas: processedPersonas,
        totalActs
      }],
      count: 1,
      hashes
    };
  }

  /**
   * Push is not supported for conversations (read-only)
   */
  async push(_customer: CustomerConfig, _changes?: ChangeItem<LocalConversationData>[]): Promise<PushResult> {
    this.logger.warn('Conversations are read-only and cannot be pushed');
    return { created: 0, updated: 0, deleted: 0, errors: ['Conversations are read-only'] };
  }

  /**
   * Get changes - conversations are typically regenerated on each pull
   */
  async getChanges(_customer: CustomerConfig): Promise<ChangeItem<LocalConversationData>[]> {
    // Conversations don't support change detection in the traditional sense
    // They are regenerated on each pull
    return [];
  }

  /**
   * Validate conversation data
   */
  async validate(_customer: CustomerConfig, _items: LocalConversationData[]): Promise<ValidationResult> {
    // Conversations are read-only, no validation needed
    return { valid: true, errors: [] };
  }

  /**
   * Get status summary
   */
  async getStatus(customer: CustomerConfig): Promise<StatusSummary> {
    const customerDir = path.join(process.cwd(), 'newo_customers', customer.idn);
    const conversationsFile = path.join(customerDir, 'conversations.yaml');

    const exists = await fs.pathExists(conversationsFile);

    return {
      resourceType: this.resourceType,
      displayName: this.displayName,
      changedCount: 0,
      changes: exists ? [] : [{ path: conversationsFile, operation: 'created' }]
    };
  }
}

/**
 * Factory function for creating ConversationSyncStrategy
 */
export function createConversationSyncStrategy(
  apiClientFactory: ApiClientFactory,
  logger: ILogger
): ConversationSyncStrategy {
  return new ConversationSyncStrategy(apiClientFactory, logger);
}
