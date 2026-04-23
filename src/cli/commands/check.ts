/**
 * `newo check` - umbrella command equivalent to running lint + format --check.
 *
 * A failing check exits non-zero if any of the sub-checks fail, so CI
 * pipelines can gate merges on a single invocation.
 */
import { handleLintCommand } from './lint.js';
import { handleFormatCommand } from './format.js';
import type { MultiCustomerConfig, CliArgs } from '../../types.js';

export async function handleCheckCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean,
): Promise<void> {
  const lintArgs = { ...args };
  await handleLintCommand(customerConfig, lintArgs as CliArgs, verbose);

  const formatCheckArgs = { ...args, check: true } as CliArgs;
  await handleFormatCommand(customerConfig, formatCheckArgs, verbose);
}
