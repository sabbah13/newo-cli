/**
 * Lint config resolution for the newo CLI.
 *
 * Looks for `.neworc.yaml` / `.neworc.yml` / `.neworc.json` starting at
 * the cwd and walking up to the filesystem root. Thin wrapper around
 * newo-dsl-analyzer's `loadConfig` so consumers can override location
 * per command if they need to.
 */
import path from 'path';
import { loadConfig as analyzerLoadConfig } from 'newo-dsl-analyzer';
import type { NewoLintConfig } from 'newo-dsl-analyzer';

export type { NewoLintConfig } from 'newo-dsl-analyzer';

export function loadNewoLintConfig(startDir: string = process.cwd()): NewoLintConfig {
  return analyzerLoadConfig(path.resolve(startDir)) ?? {};
}
