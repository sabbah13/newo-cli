/**
 * `newo session <uuid>` — short alias for the single-session views.
 *
 *   newo session <uuid>            # dialog (transcript + thoughts + system logs) — RECOMMENDED, fast
 *   newo session <uuid> --full     # + execution trace (every skill/NSL call) — heavier
 *   newo session <uuid> --json     # machine-readable
 *
 * Thin wrapper over `conversations --session-id <uuid> [--full]`; the data
 * gathered is identical — this just gives a shorter command surface.
 *
 * Default is the dialog view: it is fast (no log fetch) and already includes the
 * agent's THOUGHTS and system-log lines for voice/chat personas. Reach for
 * --full only when you also need the low-level skill-call trace.
 */
import { handleConversationsCommand } from './conversations.js';
import type { MultiCustomerConfig, CliArgs } from '../../types.js';

export async function handleSessionCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean
): Promise<void> {
  const sessionId = args._[1] as string | undefined;
  if (!sessionId) {
    console.error('Error: session id is required');
    console.error('Usage: newo session <uuid> [--full] [--json] [--pad-end <min>] [--max-logs <n>] [--customer <idn>]');
    process.exit(1);
  }

  // Map onto the conversations single-session path. Dialog is the default; only
  // an explicit --full pulls the heavy execution trace. (--dialog is accepted as
  // an explicit no-op for symmetry.)
  const mapped: CliArgs = { ...args, 'session-id': sessionId, full: Boolean(args.full) };
  await handleConversationsCommand(customerConfig, mapped, verbose);
}
