import type { ProjectLintReport } from 'newo-dsl-analyzer';

export type ReporterName = 'text' | 'json' | 'sarif';

export interface Reporter {
  write(report: ProjectLintReport): string;
}
