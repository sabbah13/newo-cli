/**
 * Conversations synchronization module
 *
 * Incremental/resumable conversation pull:
 *  - Writes per-persona JSON files to newo_customers/<idn>/conversations/<persona_id>.json as they arrive
 *  - Updates conversations.yaml aggregate after each persona finishes
 *  - Skips personas already fully fetched (resume support) unless --force passed via env NEWO_CONV_FORCE=1
 *  - Graceful on partial failure: individual persona errors do not abort the batch, state is preserved
 */
import { listUserPersonas, getChatHistory } from '../api.js';
import { writeFileSafe } from '../fsutil.js';
import fs from 'fs-extra';
import path from 'path';
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

const concurrencyLimit = pLimit(5);

type PersonaState = {
  id: string;
  name: string;
  phone: string | null;
  act_count: number;
  acts: ProcessedAct[];
  fetched_at: string;
  complete: boolean;
  last_error?: string;
};

function personaFilePath(customerIdn: string, personaId: string): string {
  return path.join('newo_customers', customerIdn, 'conversations', `${personaId}.json`);
}

function aggregateYamlPath(customerIdn: string): string {
  return path.join('newo_customers', customerIdn, 'conversations.yaml');
}

async function readPersonaState(customerIdn: string, personaId: string): Promise<PersonaState | null> {
  const p = personaFilePath(customerIdn, personaId);
  if (!(await fs.pathExists(p))) return null;
  try {
    return JSON.parse(await fs.readFile(p, 'utf8')) as PersonaState;
  } catch {
    return null;
  }
}

async function writePersonaState(customerIdn: string, state: PersonaState): Promise<void> {
  await writeFileSafe(personaFilePath(customerIdn, state.id), JSON.stringify(state, null, 2));
}

async function writeAggregateYaml(customerIdn: string): Promise<{ personas: number; acts: number }> {
  const dir = path.join('newo_customers', customerIdn, 'conversations');
  const files = (await fs.pathExists(dir)) ? await fs.readdir(dir) : [];
  const personas: ProcessedPersona[] = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const state = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')) as PersonaState;
      personas.push({
        id: state.id,
        name: state.name,
        phone: state.phone,
        act_count: state.act_count,
        acts: state.acts
      });
    } catch {
      // skip corrupted file
    }
  }

  personas.sort((a, b) => {
    const aLatestTime = a.acts.length > 0 ? a.acts[a.acts.length - 1]!.datetime : '1970-01-01T00:00:00.000Z';
    const bLatestTime = b.acts.length > 0 ? b.acts[b.acts.length - 1]!.datetime : '1970-01-01T00:00:00.000Z';
    return new Date(bLatestTime).getTime() - new Date(aLatestTime).getTime();
  });

  const totalActs = personas.reduce((sum, p) => sum + p.acts.length, 0);

  const data: ConversationsData = {
    personas,
    total_personas: personas.length,
    total_acts: totalActs,
    generated_at: new Date().toISOString()
  };

  const yamlContent = yaml.dump(data, {
    indent: 2,
    quotingType: '"',
    forceQuotes: false,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
    flowLevel: -1
  });

  await writeFileSafe(aggregateYamlPath(customerIdn), yamlContent);
  return { personas: personas.length, acts: totalActs };
}

function buildProcessedActs(raw: ConversationAct[]): ProcessedAct[] {
  const sorted = [...raw].sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());
  return sorted.map(act => {
    const processedAct: ProcessedAct = {
      datetime: act.datetime,
      type: act.reference_idn,
      message: act.source_text
    };
    if (act.contact_information) (processedAct as any).contact_information = act.contact_information;
    if (act.flow_idn && act.flow_idn !== 'unknown') (processedAct as any).flow_idn = act.flow_idn;
    if (act.skill_idn && act.skill_idn !== 'unknown') (processedAct as any).skill_idn = act.skill_idn;
    if (act.session_id && act.session_id !== 'unknown') (processedAct as any).session_id = act.session_id;
    return processedAct;
  });
}

/**
 * Pull conversations for a customer and save incrementally.
 */
export async function pullConversations(
  client: AxiosInstance,
  customer: CustomerConfig,
  options: ConversationOptions = {},
  verbose: boolean = false
): Promise<void> {
  const force = process.env.NEWO_CONV_FORCE === '1';
  console.log(`💬 Fetching conversations for ${customer.idn}${force ? ' (force re-fetch)' : ' (resume mode)'}...`);

  // Ensure output dirs exist
  await fs.ensureDir(path.join('newo_customers', customer.idn, 'conversations'));

  // 1. Enumerate all personas
  const allPersonas: UserPersona[] = [];
  let page = 1;
  const perPage = 50;
  let hasMore = true;

  while (hasMore) {
    const response = await listUserPersonas(client, page, perPage);
    allPersonas.push(...response.items);
    if (verbose) console.log(`📋 Page ${page}: ${response.items.length} personas (${allPersonas.length}/${response.metadata.total})`);
    hasMore = response.items.length === perPage && allPersonas.length < response.metadata.total;
    page++;
  }

  if (options.maxPersonas && allPersonas.length > options.maxPersonas) {
    allPersonas.splice(options.maxPersonas);
  }

  const total = allPersonas.length;
  console.log(`👥 Found ${total} personas. Processing with concurrency=5...`);

  let done = 0;
  let skipped = 0;
  let failed = 0;

  await Promise.all(allPersonas.map(persona => concurrencyLimit(async () => {
    try {
      // Resume: skip if already complete
      const existing = await readPersonaState(customer.idn, persona.id);
      if (!force && existing && existing.complete) {
        skipped++;
        done++;
        if (verbose) console.log(`⏭️  [${done}/${total}] ${persona.name}: already complete (${existing.acts.length} acts)`);
        return;
      }

      const phoneActor = persona.actors.find(actor =>
        actor.integration_idn === 'newo_voice' &&
        actor.connector_idn === 'newo_voice_connector' &&
        actor.contact_information?.startsWith('+')
      );
      const phone = phoneActor?.contact_information || null;

      const userActors = persona.actors.filter(actor =>
        actor.integration_idn === 'newo_voice' &&
        actor.connector_idn === 'newo_voice_connector'
      );

      if (userActors.length === 0) {
        const state: PersonaState = {
          id: persona.id,
          name: persona.name,
          phone,
          act_count: persona.act_count,
          acts: [],
          fetched_at: new Date().toISOString(),
          complete: true
        };
        await writePersonaState(customer.idn, state);
        done++;
        if (verbose) console.log(`✓ [${done}/${total}] ${persona.name}: no voice actors`);
        return;
      }

      // Fetch acts paginated
      const allActs: ConversationAct[] = [];
      let actPage = 1;
      const actsPerPage = 100;
      let hasMoreActs = true;
      const maxPages = 50;
      let lastError: string | undefined;

      while (hasMoreActs && actPage <= maxPages) {
        try {
          const chatResponse = await getChatHistory(client, {
            user_actor_id: userActors[0]!.id,
            page: actPage,
            per: actsPerPage
          });

          if (chatResponse.items && chatResponse.items.length > 0) {
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

            // Save partial progress every page
            const partialState: PersonaState = {
              id: persona.id,
              name: persona.name,
              phone,
              act_count: persona.act_count,
              acts: buildProcessedActs(allActs),
              fetched_at: new Date().toISOString(),
              complete: false
            };
            await writePersonaState(customer.idn, partialState);

            const currentTotal = chatResponse.metadata?.total || 0;
            hasMoreActs = chatResponse.items.length === actsPerPage && allActs.length < currentTotal;
            actPage++;
          } else {
            hasMoreActs = false;
          }
        } catch (chatError) {
          lastError = chatError instanceof Error ? chatError.message : String(chatError);
          if (verbose) console.log(`⚠️  ${persona.name} page ${actPage}: ${lastError}`);
          hasMoreActs = false;
        }
      }

      const finalState: PersonaState = {
        id: persona.id,
        name: persona.name,
        phone,
        act_count: persona.act_count,
        acts: buildProcessedActs(allActs),
        fetched_at: new Date().toISOString(),
        complete: !lastError
      };
      if (lastError) finalState.last_error = lastError;
      await writePersonaState(customer.idn, finalState);

      // Incremental YAML aggregate every persona
      const agg = await writeAggregateYaml(customer.idn);

      done++;
      if (lastError) failed++;
      console.log(`${lastError ? '⚠️ ' : '✓'} [${done}/${total}] ${persona.name}: ${finalState.acts.length} acts${lastError ? ` (partial: ${lastError})` : ''} | total so far: ${agg.personas} personas / ${agg.acts} acts`);
    } catch (error) {
      failed++;
      done++;
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`❌ [${done}/${total}] ${persona.name}: ${msg}`);
    }
  })));

  // Final aggregate write
  const final = await writeAggregateYaml(customer.idn);
  console.log(`\n✅ Done. ${final.personas} personas, ${final.acts} acts. Skipped ${skipped} (already cached), ${failed} had errors.`);
  console.log(`   Aggregate: ${aggregateYamlPath(customer.idn)}`);
  console.log(`   Per-persona: newo_customers/${customer.idn}/conversations/<id>.json`);
}
