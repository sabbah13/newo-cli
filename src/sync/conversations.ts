/**
 * Conversations synchronization module
 */
import { listUserPersonas, getChatHistory } from '../api.js';
import { writeFileSafe } from '../fsutil.js';
import yaml from 'js-yaml';
import pLimit from 'p-limit';
import type { AxiosInstance } from 'axios';
import type {
  CustomerConfig,
  ConversationOptions,
  UserPersona,
  ConversationAct,
  ProcessedPersona,
  ProcessedAct,
  ConversationsData
} from '../types.js';

// Concurrency limit for API calls
const concurrencyLimit = pLimit(5);

/**
 * Pull conversations for a customer and save to YAML
 */
export async function pullConversations(
  client: AxiosInstance,
  customer: CustomerConfig,
  options: ConversationOptions = {},
  verbose: boolean = false
): Promise<void> {
  if (verbose) console.log(`💬 Fetching conversations for customer ${customer.idn}...`);

  try {
    // Get all user personas with pagination
    const allPersonas: UserPersona[] = [];
    let page = 1;
    const perPage = 50;
    let hasMore = true;

    while (hasMore) {
      const response = await listUserPersonas(client, page, perPage);
      allPersonas.push(...response.items);

      if (verbose) console.log(`📋 Page ${page}: Found ${response.items.length} personas (${allPersonas.length}/${response.metadata.total} total)`);

      hasMore = response.items.length === perPage && allPersonas.length < response.metadata.total;
      page++;
    }

    if (options.maxPersonas && allPersonas.length > options.maxPersonas) {
      allPersonas.splice(options.maxPersonas);
      if (verbose) console.log(`⚠️  Limited to ${options.maxPersonas} personas as requested`);
    }

    if (verbose) console.log(`👥 Processing ${allPersonas.length} personas...`);

    // Process personas concurrently with limited concurrency
    const processedPersonas: ProcessedPersona[] = [];

    await Promise.all(allPersonas.map(persona => concurrencyLimit(async () => {
      try {
        // Extract phone number from actors
        const phoneActor = persona.actors.find(actor =>
          actor.integration_idn === 'newo_voice' &&
          actor.connector_idn === 'newo_voice_connector' &&
          actor.contact_information?.startsWith('+')
        );
        const phone = phoneActor?.contact_information || null;

        // Get acts for this persona
        const allActs: ConversationAct[] = [];
        let actPage = 1;
        const actsPerPage = 100; // Higher limit for acts
        let hasMoreActs = true;

        // Get user actor IDs from persona actors first
        const userActors = persona.actors.filter(actor =>
          actor.integration_idn === 'newo_voice' &&
          actor.connector_idn === 'newo_voice_connector'
        );

        if (userActors.length === 0) {
          if (verbose) console.log(`  👤 ${persona.name}: No voice actors found, skipping`);
          // No voice actors, can't get chat history - add persona with empty acts
          processedPersonas.push({
            id: persona.id,
            name: persona.name,
            phone,
            act_count: persona.act_count,
            acts: []
          });
          if (verbose) console.log(`  ✓ Processed ${persona.name}: 0 acts (no voice actors)`);
          return; // Return from the concurrency function
        }

        // Safety mechanism to prevent infinite loops
        const maxPages = 50; // Limit to 50 pages (5000 acts max per persona)

        while (hasMoreActs && actPage <= maxPages) {
          try {
            const chatHistoryParams = {
              user_actor_id: userActors[0]!.id,
              page: actPage,
              per: actsPerPage
            };

            if (verbose) console.log(`    📄 ${persona.name}: Fetching page ${actPage}...`);
            const chatResponse = await getChatHistory(client, chatHistoryParams);

            if (chatResponse.items && chatResponse.items.length > 0) {
                // Convert chat history format to acts format - create minimal ConversationAct objects
                const convertedActs: ConversationAct[] = chatResponse.items.map((item: any) => ({
                  id: item.id || `chat_${Math.random()}`,
                  command_act_id: null,
                  external_event_id: item.external_event_id || 'chat_history',
                  arguments: [],
                  reference_idn: (item.is_agent === true) ? 'agent_message' : 'user_message',
                  runtime_context_id: item.runtime_context_id || 'chat_history',
                  source_text: item.payload?.text || item.message || item.content || item.text || '',
                  original_text: item.payload?.text || item.message || item.content || item.text || '',
                  datetime: item.datetime || item.created_at || item.timestamp || new Date().toISOString(),
                  user_actor_id: userActors[0]!.id,
                  agent_actor_id: null,
                  user_persona_id: persona.id,
                  user_persona_name: persona.name,
                  agent_persona_id: item.agent_persona_id || 'unknown',
                  external_id: item.external_id || null,
                  integration_idn: 'newo_voice',
                  connector_idn: 'newo_voice_connector',
                  to_integration_idn: null,
                  to_connector_idn: null,
                  is_agent: Boolean(item.is_agent === true),
                  project_idn: null,
                  flow_idn: item.flow_idn || 'unknown',
                  skill_idn: item.skill_idn || 'unknown',
                  session_id: item.session_id || 'unknown',
                  recordings: item.recordings || [],
                  contact_information: item.contact_information || null
                }));

                allActs.push(...convertedActs);

                if (verbose && convertedActs.length > 0) {
                  console.log(`  👤 ${persona.name}: Chat History - ${convertedActs.length} messages (${allActs.length} total)`);
                }

                // Check if we should continue paginating
                const hasMetadata = chatResponse.metadata?.total !== undefined;
                const currentTotal = chatResponse.metadata?.total || 0;

                hasMoreActs = chatResponse.items.length === actsPerPage &&
                             hasMetadata &&
                             allActs.length < currentTotal;

                actPage++;

                if (verbose) console.log(`    📊 ${persona.name}: Page ${actPage - 1} done, ${allActs.length}/${currentTotal} total acts`);
              } else {
                // No more items
                hasMoreActs = false;
                if (verbose) console.log(`    📊 ${persona.name}: No more chat history items`);
              }
          } catch (chatError) {
            if (verbose) console.log(`  ⚠️  Chat history failed for ${persona.name}: ${chatError instanceof Error ? chatError.message : String(chatError)}`);
            hasMoreActs = false;
          }
        }

        if (actPage > maxPages) {
          if (verbose) console.log(`  ⚠️  ${persona.name}: Reached max pages limit (${maxPages}), stopping pagination`);
        }

        // Sort acts by datetime ascending (chronological order)
        allActs.sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());

        // Process acts into simplified format - exclude redundant fields
        const processedActs: ProcessedAct[] = allActs.map(act => {
          const processedAct: ProcessedAct = {
            datetime: act.datetime,
            type: act.reference_idn,
            message: act.source_text
          };

          // Only include non-redundant fields
          if (act.contact_information) {
            (processedAct as any).contact_information = act.contact_information;
          }
          if (act.flow_idn && act.flow_idn !== 'unknown') {
            (processedAct as any).flow_idn = act.flow_idn;
          }
          if (act.skill_idn && act.skill_idn !== 'unknown') {
            (processedAct as any).skill_idn = act.skill_idn;
          }
          if (act.session_id && act.session_id !== 'unknown') {
            (processedAct as any).session_id = act.session_id;
          }

          return processedAct;
        });

        processedPersonas.push({
          id: persona.id,
          name: persona.name,
          phone,
          act_count: persona.act_count,
          acts: processedActs
        });

        if (verbose) console.log(`  ✓ Processed ${persona.name}: ${processedActs.length} acts`);
      } catch (error) {
        console.error(`❌ Failed to process persona ${persona.name}:`, error);
        // Continue with other personas
      }
    })));

    // Sort personas by most recent act time (descending) - use latest act from acts array
    processedPersonas.sort((a, b) => {
      const aLatestTime = a.acts.length > 0 ? a.acts[a.acts.length - 1]!.datetime : '1970-01-01T00:00:00.000Z';
      const bLatestTime = b.acts.length > 0 ? b.acts[b.acts.length - 1]!.datetime : '1970-01-01T00:00:00.000Z';
      return new Date(bLatestTime).getTime() - new Date(aLatestTime).getTime();
    });

    // Calculate totals
    const totalActs = processedPersonas.reduce((sum, persona) => sum + persona.acts.length, 0);

    // Create final conversations data
    const conversationsData: ConversationsData = {
      personas: processedPersonas,
      total_personas: processedPersonas.length,
      total_acts: totalActs,
      generated_at: new Date().toISOString()
    };

    // Save to YAML file
    const conversationsPath = `newo_customers/${customer.idn}/conversations.yaml`;
    const yamlContent = yaml.dump(conversationsData, {
      indent: 2,
      quotingType: '"',
      forceQuotes: false,
      lineWidth: 120,
      noRefs: true,
      sortKeys: false,
      flowLevel: -1
    });

    await writeFileSafe(conversationsPath, yamlContent);

    if (verbose) {
      console.log(`✓ Saved conversations to ${conversationsPath}`);
      console.log(`📊 Summary: ${processedPersonas.length} personas, ${totalActs} total acts`);
    }

  } catch (error) {
    console.error(`❌ Failed to pull conversations for ${customer.idn}:`, error);
    throw error;
  }
}