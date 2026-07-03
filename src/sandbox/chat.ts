/**
 * Sandbox Chat Utility Module
 * Handles chat session management, message sending, and polling for responses
 */

import type { AxiosInstance } from 'axios';
import { randomBytes } from 'crypto';
import {
  listIntegrations,
  listConnectors,
  createSandboxPersona,
  createActor,
  sendChatMessage,
  getChatHistory
} from '../api.js';
import type {
  SandboxChatSession,
  Connector,
  ConversationAct,
  ChatDebugInfo
} from '../types.js';

const SANDBOX_INTEGRATION_IDN = 'sandbox';
const DEFAULT_TIMEZONE = 'America/Los_Angeles';
const POLL_INTERVAL_MS = 1000; // 1 second
const DEFAULT_TIMEOUT_MS = 60_000; // Default max wait for agent response

/**
 * Options for selecting which connector to chat through
 */
export interface ConnectorSelectionOptions {
  /** Integration IDN to search connectors in (default: 'sandbox') */
  integrationIdn?: string;
  /** Exact connector_idn to use; when omitted, the first running connector is used */
  connectorIdn?: string;
}

/**
 * Generate a random external ID for chat session
 */
function generateExternalId(): string {
  return randomBytes(3).toString('hex');
}

/**
 * Generate a unique persona name with NEWO CLI prefix
 */
function generatePersonaName(): string {
  const guid = randomBytes(8).toString('hex');
  return `newo-cli-${guid}`;
}

/**
 * List running connectors of an integration (default: sandbox).
 * Used by `newo sandbox --list-connectors` and connector selection.
 */
export async function listRunningSandboxConnectors(
  client: AxiosInstance,
  integrationIdn: string = SANDBOX_INTEGRATION_IDN
): Promise<Connector[]> {
  const integrations = await listIntegrations(client);
  const integration = integrations.find(i => i.idn === integrationIdn);

  if (!integration) {
    throw new Error(
      `Integration '${integrationIdn}' not found. Available integrations: ${integrations.map(i => i.idn).join(', ') || '(none)'}`
    );
  }

  const connectors = await listConnectors(client, integration.id);
  return connectors.filter(c => c.status === 'running');
}

/**
 * Find a sandbox connector from the customer's connectors list.
 *
 * Without options, preserves legacy behavior: first running connector of the
 * 'sandbox' integration. With options.connectorIdn, selects that exact
 * connector and throws a descriptive error (listing available connectors)
 * when it is not found or not running.
 */
export async function findSandboxConnector(
  client: AxiosInstance,
  verbose: boolean = false,
  options: ConnectorSelectionOptions = {}
): Promise<Connector | null> {
  const integrationIdn = options.integrationIdn || SANDBOX_INTEGRATION_IDN;

  if (verbose) console.log(`🔍 Searching for ${integrationIdn} integration...`);

  let runningConnectors: Connector[];
  try {
    runningConnectors = await listRunningSandboxConnectors(client, integrationIdn);
  } catch (error) {
    if (options.connectorIdn) throw error;
    if (verbose) console.log(`❌ ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }

  if (runningConnectors.length === 0) {
    if (options.connectorIdn) {
      throw new Error(`No running connectors found in integration '${integrationIdn}'`);
    }
    if (verbose) console.log(`❌ No running ${integrationIdn} connectors found`);
    return null;
  }

  if (options.connectorIdn) {
    const match = runningConnectors.find(c => c.connector_idn === options.connectorIdn);
    if (!match) {
      const available = runningConnectors.map(c => c.connector_idn).join(', ');
      throw new Error(
        `Connector '${options.connectorIdn}' not found among running connectors of integration '${integrationIdn}'. Available: ${available}`
      );
    }
    if (verbose) console.log(`✓ Using connector: ${match.connector_idn}`);
    return match;
  }

  if (verbose) {
    console.log(`✓ Found ${runningConnectors.length} running ${integrationIdn} connector(s)`);
    const firstConnector = runningConnectors[0];
    if (firstConnector) {
      console.log(`  Using: ${firstConnector.connector_idn}`);
    }
  }

  return runningConnectors[0] || null;
}

/**
 * Create a new sandbox chat session
 */
export async function createChatSession(
  client: AxiosInstance,
  connector: Connector,
  verbose: boolean = false
): Promise<SandboxChatSession> {
  const personaName = generatePersonaName();
  const externalId = generateExternalId();

  if (verbose) console.log(`📝 Creating persona: ${personaName}`);

  // Create user persona
  const personaResponse = await createSandboxPersona(client, {
    name: personaName,
    title: personaName
  });

  if (verbose) console.log(`✓ Persona created: ${personaResponse.id}`);

  // Create actor (ties persona to sandbox connector)
  if (verbose) console.log(`🔗 Creating actor for ${connector.connector_idn}...`);

  const actorResponse = await createActor(client, personaResponse.id, {
    name: personaName,
    external_id: externalId,
    integration_idn: connector.integration_idn || SANDBOX_INTEGRATION_IDN,
    connector_idn: connector.connector_idn,
    time_zone_identifier: DEFAULT_TIMEZONE
  });

  if (verbose) console.log(`✓ Actor created: ${actorResponse.id} (Chat ID)`);

  return {
    user_persona_id: personaResponse.id,
    user_actor_id: actorResponse.id,
    agent_persona_id: null, // Will be populated from first response
    connector_idn: connector.connector_idn,
    session_id: null,
    external_id: externalId
  };
}

/**
 * Send a message in the chat session
 * Returns the timestamp when message was sent (for filtering responses)
 */
export async function sendMessage(
  client: AxiosInstance,
  session: SandboxChatSession,
  text: string,
  verbose: boolean = false
): Promise<Date> {
  if (verbose) {
    const preview = text.length > 200 ? `${text.slice(0, 200)}… (${text.length} chars)` : text;
    console.log(`💬 Sending message: "${preview}"`);
  }

  const sentAt = new Date();

  await sendChatMessage(client, session.user_actor_id, {
    text,
    arguments: []
  });

  if (verbose) console.log('✓ Message sent');

  return sentAt;
}

/**
 * Parse an act datetime that may lack timezone info (assume UTC)
 */
function parseActDatetimeMs(datetime: string): number {
  let d = datetime;
  if (!d.endsWith('Z') && !d.includes('+') && !d.includes('-', 10)) {
    d = d + 'Z';
  }
  return new Date(d).getTime();
}

type SeenAgentAct = {
  act: ConversationAct;
  order: number;
};

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function chatHistoryText(item: any): string {
  return item.payload?.text || item.message || item.content || item.text || '';
}

function stableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function stableChatHistoryActId(item: any, sourceText: string, datetime: string): string {
  return `chat_history_${stableHash([
    datetime,
    sourceText,
    item.agent_actor_id || '',
    item.agent_persona_id || '',
    item.session_id || '',
    item.flow_idn || '',
    item.skill_idn || ''
  ].join('\u001f'))}`;
}

function settleActKey(act: ConversationAct): string {
  return [
    act.id,
    act.datetime,
    act.source_text,
    act.agent_actor_id || '',
    act.agent_persona_id || '',
    act.session_id,
    act.flow_idn,
    act.skill_idn
  ].join('\u001f');
}

function compareActDatetime(a: ConversationAct, b: ConversationAct): number {
  const aMs = parseActDatetimeMs(a.datetime);
  const bMs = parseActDatetimeMs(b.datetime);
  if (Number.isNaN(aMs) && Number.isNaN(bMs)) return 0;
  if (Number.isNaN(aMs)) return 1;
  if (Number.isNaN(bMs)) return -1;
  return aMs - bMs;
}

function sortedSettledActs(acts: SeenAgentAct[]): ConversationAct[] {
  return [...acts]
    .sort((a, b) => compareActDatetime(a.act, b.act) || a.order - b.order)
    .map(entry => entry.act);
}

/**
 * Poll for new conversation acts (messages and debug info)
 * Continues polling until we get an agent response, not just any new message
 *
 * @param settleMs - Optional multi-bubble settle window in ms (default `0`, which
 *   preserves the original single-bubble behavior byte-for-byte - `newo sandbox`'s
 *   call sites never pass this and must not change). When `settleMs > 0`, once the
 *   first agent act is observed the poll keeps going, accumulating every distinct
 *   agent act seen (deduped by a stable settle key), until either no NEW agent act has appeared
 *   for `settleMs` or the overall `timeoutMs` budget is exhausted - whichever
 *   comes first. The returned `acts` then include every agent act observed, not
 *   just the newest one. Settle ordering is deterministic: `datetime`
 *   ascending, then first-seen order for equal datetimes.
 */
export async function pollForResponse(
  client: AxiosInstance,
  session: SandboxChatSession,
  messageSentAt: Date | null = null,
  verbose: boolean = false,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  settleMs: number = 0
): Promise<{ acts: ConversationAct[]; agentPersonaId: string | null; userAct: ConversationAct | null }> {
  let attempts = 0;
  let agentPersonaId = session.agent_persona_id;
  let userAct: ConversationAct | null = null;
  const maxPollAttempts = Math.max(1, Math.ceil(timeoutMs / POLL_INTERVAL_MS));
  const timeoutDeadlineMs = Date.now() + timeoutMs;
  // Only populated/consulted when settleMs > 0 (multi-bubble collection mode).
  const seenAgentActs = new Map<string, SeenAgentAct>();
  let nextSeenOrder = 0;
  let settleDeadlineMs: number | null = null;

  if (verbose) console.log(`⏳ Waiting for agent response (timeout: ${Math.round(timeoutMs / 1000)}s)...`);

  // Add small delay before first poll to allow message to be processed
  await delay(Math.min(500, Math.max(0, timeoutMs)));

  while (attempts < maxPollAttempts) {
    try {
      if (verbose && attempts % 5 === 0) {
        console.log(`  [Poll attempt ${attempts + 1}/${maxPollAttempts}] Checking for messages...`);
      }

      // Use Chat History API instead of acts API (doesn't require account_id)
      const response = await getChatHistory(client, {
        user_actor_id: session.user_actor_id,
        page: 1,
        per: 100
      });

      if (verbose && attempts === 0) {
        console.log(`  Initial poll returned ${response.items.length} message(s)`);
      }

      if (response.items && response.items.length > 0) {
        // Convert chat history format to acts format
        const convertedActs: ConversationAct[] = response.items.map((item: any) => {
          const sourceText = chatHistoryText(item);
          const datetime = item.datetime || item.created_at || item.timestamp || new Date().toISOString();
          return {
            id: item.id || (settleMs > 0 ? stableChatHistoryActId(item, sourceText, datetime) : `chat_${Math.random()}`),
            command_act_id: null,
            external_event_id: item.external_event_id || 'chat_history',
            arguments: item.arguments || [],
            reference_idn: (item.is_agent === true) ? 'agent_message' : 'user_message',
            runtime_context_id: item.runtime_context_id || 'chat_history',
            source_text: sourceText,
            original_text: sourceText,
            datetime,
            user_actor_id: session.user_actor_id,
            agent_actor_id: item.agent_actor_id || null,
            user_persona_id: session.user_persona_id,
            user_persona_name: 'User',
            agent_persona_id: item.agent_persona_id || agentPersonaId || 'unknown',
            external_id: item.external_id || null,
            integration_idn: 'sandbox',
            connector_idn: session.connector_idn,
            to_integration_idn: null,
            to_connector_idn: null,
            is_agent: Boolean(item.is_agent === true),
            project_idn: item.project_idn || null,
            flow_idn: item.flow_idn || 'unknown',
            skill_idn: item.skill_idn || 'unknown',
            session_id: item.session_id || session.session_id || 'unknown',
            recordings: item.recordings || [],
            contact_information: item.contact_information || null
          };
        });

        // Extract agent_persona_id from the first act if we don't have it yet
        if (!agentPersonaId && convertedActs.length > 0) {
          const firstItem = convertedActs[0];
          if (firstItem && firstItem.agent_persona_id !== 'unknown') {
            agentPersonaId = firstItem.agent_persona_id;
            if (verbose) console.log(`✓ Extracted agent_persona_id: ${agentPersonaId}`);
          }
        }

        // Track the user act of our sent message (newest non-agent act at/after sentAt).
        // Its external_event_id is the correlation key for `newo logs --event-id`.
        for (const act of convertedActs) {
          if (act.is_agent) continue;
          if (messageSentAt && parseActDatetimeMs(act.datetime) - messageSentAt.getTime() <= -100) continue;
          if (!userAct || parseActDatetimeMs(act.datetime) >= parseActDatetimeMs(userAct.datetime)) {
            userAct = act;
          }
        }

        // Filter for agent messages that came AFTER our message was sent
        const agentMessages = convertedActs.filter(act => {
          if (!act.is_agent) return false;

          // If we have a messageSentAt timestamp, ONLY include messages with datetime after it
          if (messageSentAt) {
            // Parse the act datetime - it may not have timezone, assume UTC
            let actDatetime = act.datetime;
            if (!actDatetime.endsWith('Z') && !actDatetime.includes('+') && !actDatetime.includes('-', 10)) {
              actDatetime = actDatetime + 'Z'; // Assume UTC if no timezone
            }

            const actTime = new Date(actDatetime);
            const sentTime = messageSentAt.getTime();
            const actTimeMs = actTime.getTime();
            const timeDiff = actTimeMs - sentTime;

            if (verbose && attempts === 0) {
              console.log(`  Checking agent message:`);
              console.log(`    Original datetime: ${act.datetime}`);
              console.log(`    Parsed datetime: ${actDatetime}`);
              console.log(`    Act timestamp: ${actTimeMs} (${new Date(actTimeMs).toISOString()})`);
              console.log(`    Sent timestamp: ${sentTime} (${messageSentAt.toISOString()})`);
              console.log(`    Difference: ${timeDiff}ms (${(timeDiff/1000).toFixed(1)}s)`);
              console.log(`    Include: ${timeDiff > -100 ? 'YES' : 'NO'}`);
            }

            // Only include messages sent AFTER our message (allow small negative buffer for processing time)
            return timeDiff > -100;
          }

          // For first message (no messageSentAt), include all agent messages
          return true;
        });

        if (agentMessages.length > 0) {
          if (verbose) console.log(`✓ Received ${agentMessages.length} agent message(s) after our message (${messageSentAt?.toISOString()})`);

          if (settleMs <= 0) {
            // Legacy/sandbox behavior, preserved byte-for-byte: return ONLY the single
            // newest agent message (first one, since API returns newest first).
            const latestAgentMessage = agentMessages[0];
            if (latestAgentMessage) {
              return { acts: [latestAgentMessage], agentPersonaId, userAct };
            }
          } else {
            // Multi-bubble collection: accumulate every distinct agent act seen and
            // keep polling until the settle window elapses with no new arrival.
            // Distinctness includes stable visible fields so duplicate or missing
            // platform IDs do not make separate bubbles disappear or reappear.
            let sawNewAct = false;
            for (const act of agentMessages) {
              const key = settleActKey(act);
              if (!seenAgentActs.has(key)) {
                seenAgentActs.set(key, { act, order: nextSeenOrder });
                nextSeenOrder++;
                sawNewAct = true;
              }
            }
            if (sawNewAct) {
              settleDeadlineMs = Date.now() + settleMs;
            }
            if (settleDeadlineMs !== null && Date.now() >= settleDeadlineMs) {
              if (verbose) console.log(`✓ Settled after ${settleMs}ms with no new agent act - returning ${seenAgentActs.size} act(s)`);
              return { acts: sortedSettledActs([...seenAgentActs.values()]), agentPersonaId, userAct };
            }
          }
        } else if (verbose && attempts % 10 === 0) {
          console.log(`  No new agent messages yet (checked ${response.items.length} total messages, sentAt: ${messageSentAt?.toISOString()}), continuing...`);
        }
      }
      if (settleDeadlineMs !== null && Date.now() >= settleDeadlineMs) {
        if (verbose) console.log(`✓ Settled after ${settleMs}ms with no new agent act - returning ${seenAgentActs.size} act(s)`);
        return { acts: sortedSettledActs([...seenAgentActs.values()]), agentPersonaId, userAct };
      }
    } catch (error: any) {
      if (verbose && attempts < 3) {
        console.log(`⚠️ Error polling (attempt ${attempts + 1}): ${error.message}`);
      }
      // Continue polling despite errors
    }

    attempts++;
    const remainingTimeoutMs = timeoutDeadlineMs - Date.now();
    if (remainingTimeoutMs <= 0) break;
    const remainingSettleMs = settleDeadlineMs === null ? POLL_INTERVAL_MS : Math.max(0, settleDeadlineMs - Date.now());
    await delay(Math.min(POLL_INTERVAL_MS, remainingTimeoutMs, remainingSettleMs));
  }

  if (settleMs > 0 && seenAgentActs.size > 0) {
    // Overall timeout budget won before the settle window fully elapsed - the
    // design's "whichever comes first" - still return everything observed so far.
    if (verbose) console.log(`⏱️  Timeout reached mid-settle - returning ${seenAgentActs.size} act(s) observed so far`);
    return { acts: sortedSettledActs([...seenAgentActs.values()]), agentPersonaId, userAct };
  }

  if (verbose) console.log('⏱️  Timeout waiting for response');
  return { acts: [], agentPersonaId, userAct };
}

/**
 * Normalize an act's external_event_id: the chat-history converter falls back
 * to the placeholder 'chat_history' when the API omits the field. Callers
 * (sandbox.ts, test.ts) must go through this rather than reading
 * act.external_event_id raw, or they'll silently correlate against the
 * placeholder instead of a real `newo logs --event-id` key.
 */
export function normalizeActEventId(act: ConversationAct | null | undefined): string | null {
  if (!act) return null;
  const id = act.external_event_id;
  return id && id !== 'chat_history' ? id : null;
}

/**
 * Extract agent messages from acts
 */
export function extractAgentMessages(acts: ConversationAct[]): ConversationAct[] {
  return acts.filter(act => act.is_agent && act.reference_idn === 'agent_message');
}

/**
 * Extract debug information from acts
 */
export function extractDebugInfo(acts: ConversationAct[]): ChatDebugInfo[] {
  return acts.map(act => ({
    flow_idn: act.flow_idn,
    skill_idn: act.skill_idn,
    session_id: act.session_id,
    runtime_context_id: act.runtime_context_id,
    reference_idn: act.reference_idn,
    arguments: act.arguments
  }));
}

/**
 * Format debug info for display
 */
export function formatDebugInfo(acts: ConversationAct[]): string {
  const lines: string[] = [];

  for (const act of acts) {
    if (act.is_agent) {
      lines.push(`\n[Agent Act] ${act.reference_idn}`);
    } else {
      lines.push(`\n[User Act] ${act.reference_idn}`);
    }

    lines.push(`  Flow: ${act.flow_idn || 'N/A'}`);
    lines.push(`  Skill: ${act.skill_idn || 'N/A'}`);
    lines.push(`  Session: ${act.session_id}`);

    if (act.runtime_context_id) {
      lines.push(`  Context: ${act.runtime_context_id}`);
    }

    if (act.arguments && act.arguments.length > 0) {
      lines.push(`  Arguments:`);
      for (const arg of act.arguments) {
        if (typeof arg === 'object' && arg !== null && 'name' in arg) {
          lines.push(`    ${arg.name}: ${JSON.stringify(arg.value).substring(0, 100)}`);
        }
      }
    }
  }

  return lines.join('\n');
}
