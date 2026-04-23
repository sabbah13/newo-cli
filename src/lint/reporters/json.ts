/**
 * Machine-readable JSON reporter. Matches the ProjectLintReport shape
 * exactly - consumers can parse with any JSON tool.
 */
import type { ProjectLintReport } from 'newo-dsl-analyzer';
import type { Reporter } from './types.js';

export const jsonReporter: Reporter = {
  write(report: ProjectLintReport): string {
    return JSON.stringify(report, null, 2);
  },
};
