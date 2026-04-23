/**
 * Human-readable terminal reporter. Mirrors the ESLint 'stylish' layout:
 *
 *   path/to/file.jinja
 *     12:5   error   Unknown skill: foo. Did you mean: bar?  E100
 *     ...
 *
 *   2 problems (1 error, 1 warning)
 */
import path from 'path';
import type { ProjectLintReport, LintResult } from 'newo-dsl-analyzer';
import type { Reporter } from './types.js';

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const GREY = '\x1b[90m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

export const textReporter: Reporter = {
  write(report: ProjectLintReport): string {
    const lines: string[] = [];
    const filesWithIssues = report.results.filter(r => r.diagnostics.length > 0);

    for (const result of filesWithIssues) {
      lines.push(renderFile(result));
      lines.push('');
    }

    lines.push(renderSummary(report));
    return lines.join('\n');
  },
};

function renderFile(result: LintResult): string {
  const rel = path.relative(process.cwd(), result.filePath);
  const header = `${BOLD}${CYAN}${rel}${RESET}`;
  const rows = result.diagnostics.map(d => {
    const loc = `${d.range.start.line}:${d.range.start.column}`;
    const sev = d.severity === 'error'
      ? `${RED}error${RESET}`
      : d.severity === 'warning'
        ? `${YELLOW}warning${RESET}`
        : `${GREY}${d.severity}${RESET}`;
    return `  ${loc.padEnd(7)} ${sev.padEnd(16)} ${d.message}  ${GREY}${d.code}${RESET}`;
  });
  return [header, ...rows].join('\n');
}

function renderSummary(report: ProjectLintReport): string {
  const total = report.errorCount + report.warningCount;
  if (total === 0) {
    return `${GREY}No issues found.${RESET}`;
  }
  const color = report.errorCount > 0 ? RED : YELLOW;
  return `${color}${BOLD}${total} problems${RESET} (${report.errorCount} error${report.errorCount === 1 ? '' : 's'}, ${report.warningCount} warning${report.warningCount === 1 ? '' : 's'})`;
}
