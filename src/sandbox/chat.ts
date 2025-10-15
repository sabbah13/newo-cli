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
const MAX_POLL_ATTEMPTS = 60; // Max 60 seconds wait

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
 * Find a sandbox connector from the customer's connectors list
 */
export async function findSandboxConnector(client: AxiosInstance, verbose: boolean = false): Promise<Connector | null> {
  if (verbose) console.log('🔍 Searching for sandbox integration...');

  // First, get all integrations to find the sandbox integration
  const integrations = await listIntegrations(client);
  const sandboxIntegration = integrations.find(i => i.idn === SANDBOX_INTEGRATION_IDN);

  if (!sandboxIntegration) {
    if (verbose) console.log('❌ Sandbox integration not found');
    return null;
  }

  if (verbose) console.log(`✓ Found sandbox integration: ${sandboxIntegration.id}`);

  // Now get connectors for the sandbox integration
  if (verbose) console.log('🔍 Searching for sandbox connectors...');
  const connectors = await listConnectors(client, sandboxIntegration.id);
  const sandboxConnectors = connectors.filter(c => c.status === 'running');

  if (sandboxConnectors.length === 0) {
    if (verbose) console.log('❌ No running sandbox connectors found');
    return null;
  }

  if (verbose) {
    console.log(`✓ Found ${sandboxConnectors.length} running sandbox connector(s)`);
    const firstConnector = sandboxConnectors[0];
    if (firstConnector) {
      console.log(`  Using: ${firstConnector.connector_idn}`);
    }
  }

  return sandboxConnectors[0] || null;
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
    integration_idn: SANDBOX_INTEGRATION_IDN,
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
  if (verbose) console.log(`💬 Sending message: "${text}"`);

  const sentAt = new Date();

  await sendChatMessage(client, session.user_actor_id, {
    text,
    arguments: []
  });

  if (verbose) console.log('✓ Message sent');

  return sentAt;
}

/**
 * Poll for new conversation acts (messages and debug info)
 * Continues polling until we get an agent response, not just any new message
 */
export async function pollForResponse(
  client: AxiosInstance,
  session: SandboxChatSession,
  messageSentAt: Date | null = null,
  verbose: boolean = false
): Promise<{ acts: ConversationAct[]; agentPersonaId: string | null }> {
  let attempts = 0;
  let agentPersonaId = session.agent_persona_id;

  if (verbose) console.log('⏳ Waiting for agent response...');

  // Add small delay before first poll to allow message to be processed
  await new Promise(resolve => setTimeout(resolve, 500));

  while (attempts < MAX_POLL_ATTEMPTS) {
    try {
      if (verbose && attempts % 5 === 0) {
        console.log(`  [Poll attempt ${attempts + 1}/${MAX_POLL_ATTEMPTS}] Checking for messages...`);
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
        const convertedActs: ConversationAct[] = response.items.map((item: any) => ({
          id: item.id || `chat_${Math.random()}`,
          command_act_id: null,
          external_event_id: item.external_event_id || 'chat_history',
          arguments: item.arguments || [],
          reference_idn: (item.is_agent === true) ? 'agent_message' : 'user_message',
          runtime_context_id: item.runtime_context_id || 'chat_history',
          source_text: item.payload?.text || item.message || item.content || item.text || '',
          original_text: item.payload?.text || item.message || item.content || item.text || '',
          datetime: item.datetime || item.created_at || item.timestamp || new Date().toISOString(),
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
        }));

        // Extract agent_persona_id from the first act if we don't have it yet
        if (!agentPersonaId && convertedActs.length > 0) {
          const firstItem = convertedActs[0];
          if (firstItem && firstItem.agent_persona_id !== 'unknown') {
            agentPersonaId = firstItem.agent_persona_id;
            if (verbose) console.log(`✓ Extracted agent_persona_id: ${agentPersonaId}`);
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

          // Return ONLY the single newest agent message (first one, since API returns newest first)
          const latestAgentMessage = agentMessages[0];
          if (latestAgentMessage) {
            return { acts: [latestAgentMessage], agentPersonaId };
          }
        } else if (verbose && attempts % 10 === 0) {
          console.log(`  No new agent messages yet (checked ${response.items.length} total messages, sentAt: ${messageSentAt?.toISOString()}), continuing...`);
        }
      }
    } catch (error: any) {
      if (verbose && attempts < 3) {
        console.log(`⚠️ Error polling (attempt ${attempts + 1}): ${error.message}`);
      }
      // Continue polling despite errors
    }

    attempts++;
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  if (verbose) console.log('⏱️  Timeout waiting for response');
  return { acts: [], agentPersonaId };
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
