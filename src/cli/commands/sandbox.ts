/**
 * Sandbox Chat Command Handler
 * Supports both single-command and interactive modes
 */

import type { MultiCustomerConfig, CliArgs } from '../../types.js';
import { makeClient } from '../../api.js';
import { getValidAccessToken } from '../../auth.js';
import { selectSingleCustomer } from '../customer-selection.js';
import { getChatHistory } from '../../api.js';
import {
  findSandboxConnector,
  createChatSession,
  sendMessage,
  pollForResponse,
  extractAgentMessages,
  formatDebugInfo
} from '../../sandbox/chat.js';

/**
 * Handle sandbox command
 * Usage:
 *   npx newo sandbox "Hello" --customer <idn>              # Single message mode
 *   npx newo sandbox --actor <actor_id> "Follow up"       # Continue existing chat
 *   npx newo sandbox --interactive                        # Interactive mode (TBD)
 */
export async function handleSandboxCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean
): Promise<void> {
  const quiet: boolean = Boolean(args.quiet || args.q);

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

    // Check for interactive mode
    const interactive = args.interactive || args.i;
    if (interactive) {
      if (!quiet) {
        console.log('❌ Interactive mode not yet implemented');
        console.log('   Use single-command mode: npx newo sandbox "your message"');
      }
      process.exit(1);
    }

    // Check if continuing existing chat
    const actorId = args.actor as string | undefined;

    // Extract message from arguments (position depends on whether --actor is used)
    const messageArg = args._[1];
    if (!messageArg) {
      if (!quiet) {
        console.log('❌ Message is required');
        console.log('Usage: npx newo sandbox "your message" [--actor <id>]');
        console.log('   or: npx newo sandbox --actor <id> "your message"');
      }
      process.exit(1);
    }

    // Convert to string (minimist may parse numbers)
    const message = String(messageArg);
    if (message.trim() === '') {
      if (!quiet) console.log('❌ Message cannot be empty');
      process.exit(1);
    }

    if (actorId) {
      // Continue existing chat
      await continueExistingChat(client, actorId, message, verbose, quiet, originalConsoleLog, originalConsoleError, originalConsoleWarn);
    } else {
      // Start new chat
      await startNewChat(client, message, verbose, quiet, originalConsoleLog, originalConsoleError, originalConsoleWarn);
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
 * Start a new sandbox chat and send a message
 */
async function startNewChat(
  client: any,
  message: string,
  verbose: boolean,
  quiet: boolean = false,
  originalConsoleLog: typeof console.log = console.log,
  _originalConsoleError: typeof console.error = console.error,
  _originalConsoleWarn: typeof console.warn = console.warn
): Promise<void> {
  if (!quiet) console.log('🔧 Starting new sandbox chat...\n');

  // Find sandbox connector
  const connector = await findSandboxConnector(client, quiet ? false : verbose);
  if (!connector) {
    if (!quiet) {
      console.error('❌ No running sandbox connector found');
      console.error('   Please ensure you have a sandbox connector configured in your NEWO project');
    }
    process.exit(1);
  }

  // Create chat session
  const session = await createChatSession(client, connector, quiet ? false : verbose);

  if (!quiet) {
    console.log(`\n📋 Chat Session Created:`);
    console.log(`   Chat ID (actor_id): ${session.user_actor_id}`);
    console.log(`   Persona ID: ${session.user_persona_id}`);
    console.log(`   Connector: ${session.connector_idn}`);
    console.log(`   External ID: ${session.external_id}\n`);
    console.log(`📤 You: ${message}\n`);
  } else {
    // In quiet mode, output Chat ID FIRST to stdout
    originalConsoleLog(`CHAT_ID:${session.user_actor_id}`);
    originalConsoleLog(`You: ${message}`);
  }

  const sentAt = await sendMessage(client, session, message, quiet ? false : verbose);

  // Poll for response
  const { acts, agentPersonaId } = await pollForResponse(client, session, sentAt, quiet ? false : verbose);

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

  // Display debug information (skip in quiet mode)
  if (!quiet) {
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
}

/**
 * Continue an existing sandbox chat
 */
async function continueExistingChat(
  client: any,
  actorId: string,
  message: string,
  verbose: boolean,
  quiet: boolean = false,
  originalConsoleLog: typeof console.log = console.log,
  _originalConsoleError: typeof console.error = console.error,
  _originalConsoleWarn: typeof console.warn = console.warn
): Promise<void> {
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
  const session: any = {
    user_actor_id: actorId,
    user_persona_id: 'unknown', // Not needed for continuation
    agent_persona_id: null,
    connector_idn: 'sandbox',
    session_id: null,
    external_id: 'continuation'
  };

  // Send message (use original console in quiet mode)
  if (quiet) {
    originalConsoleLog(`You: ${message}`);
  } else {
    console.log(`📤 You: ${message}\n`);
  }
  const sentAt = await sendMessage(client, session, message, quiet ? false : verbose);

  // Poll for response using timestamp-based filtering
  const { acts } = await pollForResponse(client, session, sentAt, quiet ? false : verbose);

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
