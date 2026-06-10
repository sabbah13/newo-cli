/**
 * Sandbox Chat Command Handler
 * Supports both single-command and interactive modes
 *
 * Usage:
 *   npx newo sandbox "Hello" --customer <idn>               # Single message mode
 *   npx newo sandbox --actor <actor_id> "Follow up"         # Continue existing chat
 *   npx newo sandbox "ping" --connector vibe_agent          # Select specific connector (v3.8.0)
 *   npx newo sandbox --list-connectors                      # Show running sandbox connectors (v3.8.0)
 *   npx newo sandbox --file ./msg.txt --actor <id>          # Message from file (v3.8.0)
 *   cat msg.txt | npx newo sandbox --stdin                  # Message from stdin (v3.8.0)
 *   npx newo sandbox "ping" --timeout 420                   # Custom response timeout in seconds (v3.8.0)
 *   npx newo sandbox "ping" --json                          # Machine-readable output (v3.8.0)
 */

import fs from 'fs-extra';
import type { MultiCustomerConfig, CliArgs, ConversationAct, SandboxChatSession } from '../../types.js';
import { makeClient } from '../../api.js';
import { getValidAccessToken } from '../../auth.js';
import { selectSingleCustomer } from '../customer-selection.js';
import { getChatHistory } from '../../api.js';
import {
  findSandboxConnector,
  listRunningSandboxConnectors,
  createChatSession,
  sendMessage,
  pollForResponse,
  extractAgentMessages,
  formatDebugInfo
} from '../../sandbox/chat.js';

const DEFAULT_TIMEOUT_SECONDS = 60;

interface SandboxOptions {
  quiet: boolean;
  json: boolean;
  verbose: boolean;
  timeoutMs: number;
  integrationIdn: string | undefined;
  connectorIdn: string | undefined;
}

interface SandboxJsonResult {
  actor_id: string;
  persona_id: string | null;
  connector_idn: string;
  external_event_id: string | null;
  user_external_event_id: string | null;
  agent_external_event_id: string | null;
  response: string | null;
  elapsed_ms: number;
  timed_out: boolean;
  flow_idn: string | null;
  skill_idn: string | null;
  session_id: string | null;
}

/**
 * Normalize an act's external_event_id: the chat-history converter falls back
 * to the placeholder 'chat_history' when the API omits the field.
 */
function actEventId(act: ConversationAct | null | undefined): string | null {
  if (!act) return null;
  const id = act.external_event_id;
  return id && id !== 'chat_history' ? id : null;
}

/**
 * Read message text from --file, --stdin, or positional argument
 */
async function resolveMessage(args: CliArgs): Promise<string | null> {
  if (args.file) {
    const filePath = String(args.file);
    if (!(await fs.pathExists(filePath))) {
      throw new Error(`Message file not found: ${filePath}`);
    }
    return await fs.readFile(filePath, 'utf8');
  }

  if (args.stdin) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  const messageArg = args._[1];
  return messageArg === undefined ? null : String(messageArg);
}

/**
 * Handle sandbox command
 */
export async function handleSandboxCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean
): Promise<void> {
  const json: boolean = Boolean(args.json);
  // --json implies quiet logging: stdout must stay machine-readable
  const quiet: boolean = Boolean(args.quiet || args.q) || json;

  // Save original console functions
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;

  // In quiet mode, set environment variable to suppress auth logging AND suppress console
  if (quiet) {
    process.env.NEWO_QUIET_MODE = 'true';
    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};
  }

  try {
    // Select customer
    const customerArg = args.customer as string | undefined;
    const result = selectSingleCustomer(customerConfig, customerArg);

    if (!result.selectedCustomer) {
      if (!quiet) {
        console.error = originalConsoleError;
        console.error('❌ No customer selected');
      }
      process.exit(1);
    }

    // Get access token and create client (quiet mode already suppressing logs)
    const token = await getValidAccessToken(result.selectedCustomer);
    const client = await makeClient(quiet ? false : verbose, token);

    // Restore console for our own output
    if (quiet) {
      console.log = originalConsoleLog;
      console.error = originalConsoleError;
      console.warn = originalConsoleWarn;
    }

    const integrationIdn = args.integration ? String(args.integration) : undefined;
    const connectorIdn = args.connector ? String(args.connector) : undefined;

    // List running connectors and exit
    if (args['list-connectors']) {
      await listConnectorsCommand(client, integrationIdn, json);
      return;
    }

    // Check for interactive mode
    const interactive = args.interactive || args.i;
    if (interactive) {
      if (!quiet) {
        console.log('❌ Interactive mode not yet implemented');
        console.log('   Use single-command mode: npx newo sandbox "your message"');
      }
      process.exit(1);
    }

    const timeoutSeconds = args.timeout ? parseFloat(String(args.timeout)) : DEFAULT_TIMEOUT_SECONDS;
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
      if (!quiet) console.error(`❌ Invalid --timeout value: ${args.timeout} (expected positive number of seconds)`);
      process.exit(1);
    }

    const options: SandboxOptions = {
      quiet,
      json,
      verbose: quiet ? false : verbose,
      timeoutMs: timeoutSeconds * 1000,
      integrationIdn,
      connectorIdn
    };

    // Check if continuing existing chat
    const actorId = args.actor as string | undefined;

    const message = await resolveMessage(args);
    if (message === null) {
      if (!quiet) {
        console.log('❌ Message is required');
        console.log('Usage: npx newo sandbox "your message" [--actor <id>] [--connector <idn>]');
        console.log('   or: npx newo sandbox --file <path> [--actor <id>]');
        console.log('   or: cat msg.txt | npx newo sandbox --stdin [--actor <id>]');
      }
      process.exit(1);
    }

    if (message.trim() === '') {
      if (!quiet) console.log('❌ Message cannot be empty');
      process.exit(1);
    }

    if (actorId) {
      await continueExistingChat(client, actorId, message, options, originalConsoleLog);
    } else {
      await startNewChat(client, message, options, originalConsoleLog);
    }

  } catch (error: any) {
    // Restore console for error reporting
    if (quiet) {
      console.error = originalConsoleError;
      console.log = originalConsoleLog;
      console.warn = originalConsoleWarn;
    }

    console.error('❌ Sandbox chat error:', error.message);
    if (verbose && error.response?.data) {
      console.error('   Response data:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  } finally {
    // Always restore console functions and clear quiet mode flag
    if (quiet) {
      console.log = originalConsoleLog;
      console.error = originalConsoleError;
      console.warn = originalConsoleWarn;
      delete process.env.NEWO_QUIET_MODE;
    }
  }
}

/**
 * Print running connectors of the (sandbox) integration
 */
async function listConnectorsCommand(
  client: any,
  integrationIdn: string | undefined,
  asJson: boolean
): Promise<void> {
  const connectors = await listRunningSandboxConnectors(client, integrationIdn);

  if (asJson) {
    console.log(JSON.stringify(
      connectors.map(c => ({
        connector_idn: c.connector_idn,
        integration_idn: c.integration_idn,
        title: c.title,
        status: c.status
      })),
      null,
      2
    ));
    return;
  }

  if (connectors.length === 0) {
    console.log(`No running connectors found in integration '${integrationIdn || 'sandbox'}'`);
    return;
  }

  console.log(`🔌 Running connectors in integration '${integrationIdn || 'sandbox'}':\n`);
  for (const c of connectors) {
    console.log(`   ${c.connector_idn}${c.title ? `  (${c.title})` : ''}`);
  }
  console.log(`\n💡 Use: npx newo sandbox "your message" --connector <connector_idn>`);
}

/**
 * Build and print the --json result object
 */
function printJsonResult(
  session: SandboxChatSession,
  acts: ConversationAct[],
  userAct: ConversationAct | null,
  elapsedMs: number,
  print: typeof console.log
): void {
  const agentAct = acts.find(a => a.is_agent) || null;

  const jsonResult: SandboxJsonResult = {
    actor_id: session.user_actor_id,
    persona_id: session.user_persona_id !== 'unknown' ? session.user_persona_id : null,
    connector_idn: session.connector_idn,
    // external_event_id of the user turn is the correlation key for `newo logs --event-id`
    external_event_id: actEventId(userAct),
    user_external_event_id: actEventId(userAct),
    agent_external_event_id: actEventId(agentAct),
    response: agentAct ? (agentAct.source_text || agentAct.original_text || null) : null,
    elapsed_ms: elapsedMs,
    timed_out: agentAct === null,
    flow_idn: agentAct && agentAct.flow_idn !== 'unknown' ? agentAct.flow_idn : null,
    skill_idn: agentAct && agentAct.skill_idn !== 'unknown' ? agentAct.skill_idn : null,
    session_id: agentAct && agentAct.session_id !== 'unknown' ? agentAct.session_id : null
  };

  print(JSON.stringify(jsonResult, null, 2));
}

/**
 * Start a new sandbox chat and send a message
 */
async function startNewChat(
  client: any,
  message: string,
  options: SandboxOptions,
  originalConsoleLog: typeof console.log
): Promise<void> {
  const { quiet, json, verbose, timeoutMs } = options;

  if (!quiet) console.log('🔧 Starting new sandbox chat...\n');

  // Find sandbox connector (throws with available list when --connector not found)
  const selection: { integrationIdn?: string; connectorIdn?: string } = {};
  if (options.integrationIdn) selection.integrationIdn = options.integrationIdn;
  if (options.connectorIdn) selection.connectorIdn = options.connectorIdn;
  const connector = await findSandboxConnector(client, verbose, selection);
  if (!connector) {
    if (!quiet) {
      console.error('❌ No running sandbox connector found');
      console.error('   Please ensure you have a sandbox connector configured in your NEWO project');
    } else if (json) {
      originalConsoleLog(JSON.stringify({ error: 'No running sandbox connector found' }));
    }
    process.exit(1);
  }

  // Create chat session
  const session = await createChatSession(client, connector, verbose);

  if (!quiet) {
    console.log(`\n📋 Chat Session Created:`);
    console.log(`   Chat ID (actor_id): ${session.user_actor_id}`);
    console.log(`   Persona ID: ${session.user_persona_id}`);
    console.log(`   Connector: ${session.connector_idn}`);
    console.log(`   External ID: ${session.external_id}\n`);
    console.log(`📤 You: ${message}\n`);
  } else if (!json) {
    // In quiet mode, output Chat ID FIRST to stdout
    originalConsoleLog(`CHAT_ID:${session.user_actor_id}`);
    originalConsoleLog(`You: ${message}`);
  }

  const startedAt = Date.now();
  const sentAt = await sendMessage(client, session, message, verbose);

  // Poll for response
  const { acts, agentPersonaId, userAct } = await pollForResponse(client, session, sentAt, verbose, timeoutMs);
  const elapsedMs = Date.now() - startedAt;

  if (json) {
    printJsonResult(session, acts, userAct, elapsedMs, originalConsoleLog);
    return;
  }

  if (acts.length === 0) {
    if (!quiet) {
      console.log('⏱️  No response received within timeout period');
      console.log(`   You can continue this chat with: npx newo sandbox --actor ${session.user_actor_id} "your message"`);
    }
    return;
  }

  // Update session with agent_persona_id
  session.agent_persona_id = agentPersonaId;

  // Extract agent messages - show only the MOST RECENT one
  const agentMessages = extractAgentMessages(acts);

  if (agentMessages.length > 0) {
    // Show only the latest agent message (messages are in reverse chronological order from API)
    const latestAgentMessage = agentMessages[0];
    if (latestAgentMessage) {
      if (quiet) {
        // Quiet mode: ONLY message content
        originalConsoleLog(`Agent: ${latestAgentMessage.source_text || latestAgentMessage.original_text}`);
      } else {
        // Normal mode: full output
        console.log('🤖 Agent:');
        console.log(`   ${latestAgentMessage.source_text || latestAgentMessage.original_text}`);
        console.log('');

        if (verbose && agentMessages.length > 1) {
          console.log(`ℹ️  Note: Received ${agentMessages.length} agent messages, showing latest only\n`);
        }
      }
    }
  }

  // In quiet mode, skip all debug output and continuation info completely
  if (quiet) {
    return; // Exit early, showing only messages
  }

  // Display debug information
  if (verbose) {
    console.log('\n📊 Debug Information:');
    console.log(formatDebugInfo(acts));
    console.log('');
  } else {
    // Show condensed debug info for single-command mode
    console.log('📊 Debug Summary:');
    const agentActs = acts.filter(a => a.is_agent);
    if (agentActs.length > 0) {
      const lastAct = agentActs[agentActs.length - 1];
      if (lastAct) {
        console.log(`   Flow: ${lastAct.flow_idn || 'N/A'}`);
        console.log(`   Skill: ${lastAct.skill_idn || 'N/A'}`);
        console.log(`   Session: ${lastAct.session_id}`);
        if (actEventId(userAct)) {
          console.log(`   Event ID (user turn): ${actEventId(userAct)}`);
        }
      }
      console.log(`   Acts Processed: ${acts.length} (${agentActs.length} agent, ${acts.length - agentActs.length} system)`);
    }
    console.log('');
  }

  // Show continuation info
  console.log(`💡 To continue this conversation:`);
  console.log(`   npx newo sandbox --actor ${session.user_actor_id} "your next message"`);
  console.log('');
}

/**
 * Continue an existing sandbox chat
 */
async function continueExistingChat(
  client: any,
  actorId: string,
  message: string,
  options: SandboxOptions,
  originalConsoleLog: typeof console.log
): Promise<void> {
  const { quiet, json, verbose, timeoutMs } = options;

  if (!quiet) {
    console.log(`💬 Continuing chat...`);
    console.log(`   Chat ID: ${actorId}\n`);
  }

  // First, get current chat history to find the last message ID
  const historyResponse = await getChatHistory(client, {
    user_actor_id: actorId,
    page: 1,
    per: 100
  });

  // Get the last message ID
  let lastMessageId: string | null = null;
  if (historyResponse.items && historyResponse.items.length > 0) {
    const lastItem = historyResponse.items[0];
    if (lastItem && 'id' in lastItem) {
      lastMessageId = lastItem.id as string;
    }
  }

  if (verbose && lastMessageId && !quiet) {
    console.log(`📌 Last message ID: ${lastMessageId}`);
  }

  // Create a temporary session for the existing chat
  const session: SandboxChatSession = {
    user_actor_id: actorId,
    user_persona_id: 'unknown', // Not needed for continuation
    agent_persona_id: null,
    connector_idn: options.connectorIdn || 'sandbox',
    session_id: null,
    external_id: 'continuation'
  };

  // Send message (use original console in quiet mode)
  if (quiet) {
    if (!json) originalConsoleLog(`You: ${message}`);
  } else {
    console.log(`📤 You: ${message}\n`);
  }
  const startedAt = Date.now();
  const sentAt = await sendMessage(client, session, message, verbose);

  // Poll for response using timestamp-based filtering
  const { acts, userAct } = await pollForResponse(client, session, sentAt, verbose, timeoutMs);
  const elapsedMs = Date.now() - startedAt;

  if (json) {
    printJsonResult(session, acts, userAct, elapsedMs, originalConsoleLog);
    return;
  }

  if (acts.length === 0) {
    if (!quiet) {
      console.log('⏱️  No response received within timeout period');
      console.log(`   You can continue this chat with: npx newo sandbox --actor ${actorId} "your message"`);
    }
    return;
  }

  // Extract agent messages - show only the MOST RECENT one
  const agentMessages = extractAgentMessages(acts);

  if (agentMessages.length > 0) {
    // Show only the latest agent message (messages are in reverse chronological order from API)
    const latestAgentMessage = agentMessages[0];
    if (latestAgentMessage) {
      if (quiet) {
        // Quiet mode: ONLY message content
        originalConsoleLog(`Agent: ${latestAgentMessage.source_text || latestAgentMessage.original_text}`);
        return; // Exit immediately, no debug output
      } else {
        // Normal mode: full output
        console.log('🤖 Agent:');
        console.log(`   ${latestAgentMessage.source_text || latestAgentMessage.original_text}`);
        console.log('');

        if (verbose && agentMessages.length > 1) {
          console.log(`ℹ️  Note: Received ${agentMessages.length} agent messages, showing latest only\n`);
        }
      }
    }
  }

  // Display debug information (skip in quiet mode)
  if (!quiet) {
    if (verbose) {
      console.log('\n📊 Debug Information:');
      console.log(formatDebugInfo(acts));
      console.log('');
    } else {
      // Show condensed debug info
      console.log('📊 Debug Summary:');
      const agentActs = acts.filter(a => a.is_agent);
      if (agentActs.length > 0) {
        const lastAct = agentActs[agentActs.length - 1];
        if (lastAct) {
          console.log(`   Flow: ${lastAct.flow_idn || 'N/A'}`);
          console.log(`   Skill: ${lastAct.skill_idn || 'N/A'}`);
          console.log(`   Session: ${lastAct.session_id}`);
          if (actEventId(userAct)) {
            console.log(`   Event ID (user turn): ${actEventId(userAct)}`);
          }
        }
        console.log(`   Acts Processed: ${acts.length} (${agentActs.length} agent, ${acts.length - agentActs.length} user)`);
      }
      console.log('');
    }

    // Show continuation info
    console.log(`💡 To continue this conversation:`);
    console.log(`   npx newo sandbox --actor ${actorId} "your next message"`);
    console.log('');
  }
}
