/**
 * MCP tool: newo_test
 *
 * Runs a NEWO sandbox call (the same logic as `newo sandbox`) and returns
 * the agent's reply plus debug info that the model needs to troubleshoot:
 * runtime_context_id (the bridge to newo_logs), flow_idn, skill_idn,
 * user_actor_id (for continuing the chat).
 */
import { z } from 'zod';
import { clientFor, toolResult, toolError } from '../context.js';
import {
  findSandboxConnector,
  createChatSession,
  sendMessage,
  pollForResponse,
  extractAgentMessages,
  extractDebugInfo,
} from '../../sandbox/chat.js';
import { getChatHistory } from '../../api.js';
import type { SandboxChatSession } from '../../types.js';

export const testTool = {
  name: 'newo_test',
  description:
    'Run a NEWO agent in sandbox and return the reply plus debug info. Returns runtime_context_id (use with newo_logs to see the call chain), flow_idn (which flow fired), skill_idn (which skill ran), user_actor_id (for continuing the chat with `actor_id` arg). Use whenever the user wants to test an agent prompt, validate a fix, or smoke-test post-deploy. The runtime_context_id is the bridge to newo_logs - capture it always.',
  inputSchema: z.object({
    message: z.string().min(1).describe('The user message to send to the agent.'),
    customer_idn: z.string().optional().describe('Customer IDN. Defaults to the only configured customer or NEWO_DEFAULT_CUSTOMER.'),
    actor_id: z
      .string()
      .optional()
      .describe('Existing user_actor_id to continue a chat. If omitted, a fresh chat is started (new persona, new actor).'),
  }),
  handler: async (args: { message: string; customer_idn?: string; actor_id?: string }) => {
    try {
      const { customer, client } = await clientFor(args.customer_idn);

      let session: SandboxChatSession;

      if (args.actor_id) {
        // Continue existing chat. We don't have a stored session object so
        // build a minimal one - chat history will fill in the agent_persona_id.
        session = {
          user_persona_id: '', // not used after first sendMessage
          user_actor_id: args.actor_id,
          agent_persona_id: null,
          connector_idn: 'sandbox',
          session_id: null,
          external_id: '',
        };
      } else {
        const connector = await findSandboxConnector(client, false);
        if (!connector) {
          return toolError(
            `No running sandbox connector found for ${customer.idn}. Verify the sandbox integration is configured and running in Builder UI.`
          );
        }
        session = await createChatSession(client, connector, false);
      }

      // Capture last seen message ID so we can filter to messages strictly
      // newer than this turn (when continuing a chat).
      let lastMessageId: string | null = null;
      if (args.actor_id) {
        try {
          const history = await getChatHistory(client, {
            user_actor_id: args.actor_id,
            page: 1,
            per: 1,
          });
          if (history.items?.[0]) {
            lastMessageId = (history.items[0] as any).id ?? null;
          }
        } catch {
          // ignore - we'll just see all turns
        }
      }

      const sentAt = await sendMessage(client, session, args.message, false);
      const { acts, agentPersonaId } = await pollForResponse(client, session, sentAt, false);

      // If continuing, drop messages we'd already seen.
      const newActs = lastMessageId
        ? acts.slice(acts.findIndex((a) => a.id === lastMessageId) + 1)
        : acts;

      const actsToReport = newActs.length > 0 ? newActs : acts;
      const agentMessages = extractAgentMessages(actsToReport);
      const reply =
        agentMessages.map((m) => m.source_text).join('\n').trim() || '(no agent reply)';

      // Pull the most recent agent act for debug info (flow_idn, skill_idn, runtime_context_id).
      const lastAgentAct =
        actsToReport.find((a) => a.reference_idn === 'agent_message') ??
        actsToReport[actsToReport.length - 1] ??
        acts[acts.length - 1];

      const debug = lastAgentAct ? extractDebugInfo([lastAgentAct])[0] : null;

      const summary =
        `Sandbox reply (${customer.idn}): ${reply.slice(0, 120)}${reply.length > 120 ? '...' : ''}\n` +
        `runtime_context_id: ${lastAgentAct?.runtime_context_id ?? '(none)'}`;

      return toolResult(summary, {
        customer_idn: customer.idn,
        message: args.message,
        reply,
        user_actor_id: session.user_actor_id,
        runtime_context_id: lastAgentAct?.runtime_context_id ?? null,
        agent_persona_id: agentPersonaId ?? lastAgentAct?.user_persona_id ?? null,
        debug,
        acts_count: acts.length,
        agent_acts_count: agentMessages.length,
      });
    } catch (err) {
      return toolError(
        `Sandbox call failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  },
};
