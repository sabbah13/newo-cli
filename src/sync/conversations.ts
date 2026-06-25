/**
 * Conversations synchronization module
 *
 * Incremental/resumable conversation pull:
 *  - Writes per-persona JSON files to newo_customers/<idn>/conversations/<persona_id>.json as they arrive
 *  - Updates conversations.yaml aggregate after each persona finishes
 *  - Skips personas already fully fetched (resume support) unless --force passed via env NEWO_CONV_FORCE=1
 *  - Graceful on partial failure: individual persona errors do not abort the batch, state is preserved
 */
import { listUserPersonas, getChatHistory, getLogs } from '../api.js';
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

// ── Single-session conversation chronicle ──

/** One turn of a session chronicle (a row in the Conversations UI). */
export interface SessionChronicleAct {
  readonly datetime: string;
  readonly speaker: 'agent' | 'user';
  readonly type: string;
  readonly message: string;
  readonly flow_idn?: string;
  readonly skill_idn?: string;
  readonly external_event_id?: string;
  readonly runtime_context_id?: string;
}

export interface SessionChronicle {
  readonly session_id: string;
  readonly personas: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly actor_ids: readonly string[];
  readonly total_acts: number;
  readonly acts: readonly SessionChronicleAct[];
  readonly generated_at: string;
}

// Integrations whose actors are bookkeeping, not part of the dialog transcript.
const SERVICE_INTEGRATIONS = new Set(['program_timer', 'magic_browser']);

type NormalizedAct = {
  datetime: string;
  is_agent: boolean;
  type: string;
  message: string;
  flow_idn?: string;
  skill_idn?: string;
  external_event_id?: string;
  runtime_context_id?: string;
};

function normalizeChatItem(item: any): NormalizedAct {
  const isAgent = item.is_agent === true;
  const out: NormalizedAct = {
    datetime: item.datetime || item.created_at || item.timestamp || '1970-01-01T00:00:00.000Z',
    is_agent: isAgent,
    type: item.type || (isAgent ? 'agent_message' : 'user_message'),
    message: item.payload?.text || item.message || item.content || item.text || ''
  };
  if (item.flow_idn && item.flow_idn !== 'unknown') out.flow_idn = item.flow_idn;
  if (item.skill_idn && item.skill_idn !== 'unknown') out.skill_idn = item.skill_idn;
  if (item.external_event_id) out.external_event_id = item.external_event_id;
  if (item.runtime_context_id) out.runtime_context_id = item.runtime_context_id;
  return out;
}

function buildSessionActs(raw: NormalizedAct[]): SessionChronicleAct[] {
  const sorted = [...raw].sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());
  return sorted.map(act => {
    const out: SessionChronicleAct = {
      datetime: act.datetime,
      speaker: act.is_agent ? 'agent' : 'user',
      type: act.type,
      message: act.message
    };
    if (act.flow_idn) (out as any).flow_idn = act.flow_idn;
    if (act.skill_idn) (out as any).skill_idn = act.skill_idn;
    if (act.external_event_id) (out as any).external_event_id = act.external_event_id;
    if (act.runtime_context_id) (out as any).runtime_context_id = act.runtime_context_id;
    return out;
  });
}

/**
 * Fetch the act chronicle (dialog) for a single conversation session.
 *
 * Two-step resolution that works with an api-key-exchanged token:
 *   1. GET user-personas?session_id=...  — server-side filters to the persona(s)
 *      tied to this session (this query DOES honor session_id for api-key tokens).
 *   2. For each non-service actor, GET chat/history?user_actor_id=... (paginated)
 *      for the transcript.
 *
 * Why not the direct acts?session_id endpoint the Builder UI uses: it returns
 * 403 "account_id field missing" for api-key-exchanged tokens (it needs a
 * logged-in user token). chat/history also does not carry per-act session_id,
 * so the session→transcript link is made through persona/actor, not by
 * filtering acts on session_id. As a result the transcript is scoped to the
 * resolved actor(s); for per-session personas (e.g. sandbox/test runs) that is
 * exactly one session, but a long-lived actor may span several sessions.
 */
export async function pullConversationBySession(
  client: AxiosInstance,
  sessionId: string,
  verbose: boolean = false
): Promise<SessionChronicle> {
  // 1. Resolve personas tied to this session (server-side filtered).
  const personas: UserPersona[] = [];
  let page = 1;
  const perPage = 50;
  while (true) {
    const response = await listUserPersonas(client, page, perPage, sessionId);
    personas.push(...response.items);
    if (verbose) console.log(`📋 personas page ${page}: ${response.items.length}`);
    if (response.items.length < perPage) break;
    page++;
  }

  // 2. For each persona's non-service actors, pull chat history.
  const allActs: NormalizedAct[] = [];
  const actorIds: string[] = [];
  for (const persona of personas) {
    const dialogActors = persona.actors.filter(a => !SERVICE_INTEGRATIONS.has(a.integration_idn));
    for (const actor of dialogActors) {
      actorIds.push(actor.id);
      let actPage = 1;
      const actsPerPage = 200;
      const maxPages = 50;
      while (actPage <= maxPages) {
        const response = await getChatHistory(client, {
          user_actor_id: actor.id,
          page: actPage,
          per: actsPerPage
        });
        const items = response.items || [];
        for (const item of items) allActs.push(normalizeChatItem(item));
        if (verbose) console.log(`💬 chat persona=${persona.name} actor=${actor.integration_idn} page ${actPage}: ${items.length}`);
        if (items.length < actsPerPage) break;
        actPage++;
      }
    }
  }

  return {
    session_id: sessionId,
    personas: personas.map(p => ({ id: p.id, name: p.name })),
    actor_ids: actorIds,
    total_acts: allActs.length,
    acts: buildSessionActs(allActs),
    generated_at: new Date().toISOString()
  };
}

// ── Full session view (api-key reachable: chat/history + analytics/logs) ──
//
// The Builder Conversations UI renders the full chronicle from
// GET /bff/conversations/acts, which is NOT reachable with an api-key token
// (its account_id claim is empty → the endpoint hangs). See
// docs/SESSION_CHRONICLE_PLATFORM_ASK.md.
//
// This assembles the richest view that IS reachable with an api-key token:
//   1. chat/history → the dialog turns (what was said), each carrying an
//      external_event_id (the only cross-link to logs; chat items carry no
//      session_id / runtime_context_id).
//   2. analytics/logs scoped to the resolved actor(s) within the session's time
//      window → the execution trace (every skill/NSL call + LLM `Gen`, with
//      flow_idn, skill_idn, model, parameters, result, timing).
// The two streams are merged into one chronological timeline.
//
// What this canNOT show (acts-only): the formatted thoughts_footnote reasoning,
// analyze_conversation acts, the end-of-session report + semaphore analysis, and
// recording URLs. Those require the platform-side account_id fix.

/** One row of the merged full-session timeline. */
export interface SessionFullEntry {
  readonly datetime: string;
  readonly kind: 'message' | 'call' | 'operation' | 'event';
  readonly speaker?: 'agent' | 'user';
  readonly text?: string;
  readonly name?: string; // log action name (e.g. Gen, set, SendMessage)
  readonly flow_idn?: string;
  readonly skill_idn?: string;
  readonly model?: string; // provider_idn/model_idn
  readonly level?: string;
  readonly external_event_id?: string;
}

export interface SessionFullChronicle {
  readonly session_id: string;
  readonly personas: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly actor_ids: readonly string[];
  readonly window: { readonly from: string; readonly to: string } | null;
  readonly total_messages: number;
  readonly total_log_entries: number;
  readonly partial: boolean; // true if any pagination cap was hit
  readonly timeline: readonly SessionFullEntry[];
  readonly generated_at: string;
}

/**
 * Parse a platform datetime. Platform timestamps are UTC but `chat/history`
 * omits the timezone suffix (e.g. "2026-06-22T12:31:27.952000"); treat any
 * tz-less string as UTC so the log window lines up with the (Z-suffixed) logs.
 */
function parseActDatetime(dt: string): number {
  const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(dt);
  const ms = Date.parse(hasTz ? dt : `${dt}Z`);
  return Number.isNaN(ms) ? 0 : ms;
}

/** Pull skill/flow/model fields from a log entry, tolerating nested shapes. */
function logEntryFields(entry: any): { name?: string; flow_idn?: string; skill_idn?: string; model?: string } {
  const data = entry.data || {};
  const source = data.source || {};
  const context = data.context || {};
  const out: { name?: string; flow_idn?: string; skill_idn?: string; model?: string } = {};
  if (data.name) out.name = String(data.name);
  const flow = data.flow_idn || context.flow_idn;
  if (flow) out.flow_idn = String(flow);
  const skill = data.skill_idn || source.skill_idn;
  if (skill) out.skill_idn = String(skill);
  const model = source.model;
  if (model && (model.provider_idn || model.model_idn)) {
    out.model = `${model.provider_idn ?? '?'}/${model.model_idn ?? '?'}`;
  }
  return out;
}

/**
 * Assemble the fullest api-key-reachable view of a single session.
 *
 * @param padEndMinutes how far past the last dialog turn to keep collecting
 *   logs (the post-call report/assessment fires minutes after the last turn).
 * @param maxLogEntries total log-entry budget across all actors. Busy sessions
 *   can have tens of thousands of skill calls; this bounds the fetch (and the
 *   YAML size). When hit, `partial` is set true.
 */
export async function pullSessionFull(
  client: AxiosInstance,
  sessionId: string,
  verbose: boolean = false,
  padEndMinutes: number = 10,
  maxLogEntries: number = 20000
): Promise<SessionFullChronicle> {
  // Progress is shown in the normal (non-JSON) path; --json sets NEWO_QUIET_MODE.
  const quiet = process.env.NEWO_QUIET_MODE === 'true';
  const progress = (msg: string) => { if (!quiet || verbose) console.log(msg); };

  // 1. Resolve personas/actors tied to this session.
  const personas: UserPersona[] = [];
  let page = 1;
  const perPage = 50;
  while (true) {
    const response = await listUserPersonas(client, page, perPage, sessionId);
    personas.push(...response.items);
    if (response.items.length < perPage) break;
    page++;
  }

  const actorIds: string[] = [];
  for (const persona of personas) {
    for (const actor of persona.actors.filter(a => !SERVICE_INTEGRATIONS.has(a.integration_idn))) {
      actorIds.push(actor.id);
    }
  }
  progress(`   resolved ${personas.length} persona(s), ${actorIds.length} dialog actor(s)`);

  // 2. Dialog turns from chat/history.
  const messageEntries: SessionFullEntry[] = [];
  let messagesPartial = false;
  for (const actorId of actorIds) {
    let actPage = 1;
    const actsPerPage = 200;
    const maxPages = 50;
    while (actPage <= maxPages) {
      const response = await getChatHistory(client, { user_actor_id: actorId, page: actPage, per: actsPerPage });
      const items = response.items || [];
      for (const item of items as any[]) {
        const entry: SessionFullEntry = {
          datetime: item.datetime || item.created_at || '1970-01-01T00:00:00.000Z',
          kind: 'message',
          speaker: item.is_agent === true ? 'agent' : 'user',
          text: item.payload?.text || item.message || item.content || item.text || ''
        };
        if (item.external_event_id) (entry as any).external_event_id = item.external_event_id;
        messageEntries.push(entry);
      }
      if (verbose) console.log(`💬 chat actor=${actorId} page ${actPage}: ${items.length}`);
      if (items.length < actsPerPage) break;
      actPage++;
      if (actPage > maxPages) messagesPartial = true;
    }
  }
  progress(`   collected ${messageEntries.length} dialog message(s)`);

  // 3. Time window from the dialog turns (pad the tail for the post-call report).
  let window: { from: string; to: string } | null = null;
  const times = messageEntries.map(e => parseActDatetime(e.datetime)).filter(n => n > 0);
  if (times.length > 0) {
    const from = new Date(Math.min(...times) - 5_000).toISOString();
    const to = new Date(Math.max(...times) + padEndMinutes * 60_000).toISOString();
    window = { from, to };
  }

  // 4. Execution trace from analytics/logs, scoped to actor(s) within the window.
  //    Shared budget across actors so a busy session can't run for many minutes.
  const logEntries: SessionFullEntry[] = [];
  let logsPartial = false;
  if (window) {
    progress(`   fetching execution trace in window ${window.from} .. ${window.to} (cap ${maxLogEntries})...`);
    outer:
    for (const actorId of actorIds) {
      let logPage = 1;
      const logsPerPage = 100;
      const maxLogPages = 200;
      while (logPage <= maxLogPages) {
        const response = await getLogs(client, {
          user_actor_ids: actorId,
          from_datetime: window.from,
          to_datetime: window.to,
          per: logsPerPage,
          page: logPage
        });
        const items = response.items || [];
        for (const entry of items as any[]) {
          const f = logEntryFields(entry);
          const row: SessionFullEntry = {
            datetime: entry.datetime || '1970-01-01T00:00:00.000Z',
            kind: entry.log_type === 'operation' ? 'operation' : entry.log_type === 'event' ? 'event' : 'call'
          };
          if (f.name) (row as any).name = f.name;
          if (f.flow_idn) (row as any).flow_idn = f.flow_idn;
          if (f.skill_idn) (row as any).skill_idn = f.skill_idn;
          if (f.model) (row as any).model = f.model;
          if (entry.level) (row as any).level = entry.level;
          if (entry.data?.external_event_id) (row as any).external_event_id = entry.data.external_event_id;
          logEntries.push(row);
        }
        if (verbose) console.log(`📊 logs actor=${actorId} page ${logPage}: ${items.length}`);
        else if (logEntries.length % 1000 < logsPerPage) progress(`   …trace ${logEntries.length} entries`);
        if (logEntries.length >= maxLogEntries) { logsPartial = true; progress(`   ⚠️  log cap ${maxLogEntries} reached — stopping (use a higher cap to fetch all)`); break outer; }
        if (items.length < logsPerPage) break;
        logPage++;
        if (logPage > maxLogPages) logsPartial = true;
      }
    }
    progress(`   collected ${logEntries.length} log entr${logEntries.length === 1 ? 'y' : 'ies'}`);
  }

  // 5. Merge into one chronological timeline.
  const timeline = [...messageEntries, ...logEntries].sort(
    (a, b) => parseActDatetime(a.datetime) - parseActDatetime(b.datetime)
  );

  return {
    session_id: sessionId,
    personas: personas.map(p => ({ id: p.id, name: p.name })),
    actor_ids: actorIds,
    window,
    total_messages: messageEntries.length,
    total_log_entries: logEntries.length,
    partial: messagesPartial || logsPartial,
    timeline,
    generated_at: new Date().toISOString()
  };
}
