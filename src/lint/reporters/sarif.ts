/**
 * SARIF 2.1.0 reporter - lets GitHub Advanced Security / Code Scanning
 * pick up newo-lint findings alongside CodeQL and other linters.
 *
 * Spec: https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html
 */
import type { ProjectLintReport, Diagnostic } from 'newo-dsl-analyzer';
import type { Reporter } from './types.js';

export const sarifReporter: Reporter = {
  write(report: ProjectLintReport): string {
    const sarif = {
      $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: {
            driver: {
              name: 'newo-lint',
              informationUri: 'https://github.com/sabbah13/newo-cli',
              rules: [] as Array<{ id: string }>,
            },
          },
          results: report.results.flatMap(r =>
            r.diagnostics.map(d => buildResult(r.filePath, d)),
          ),
        },
      ],
    };
    return JSON.stringify(sarif, null, 2);
  },
};

function buildResult(filePath: string, d: Diagnostic): Record<string, unknown> {
  return {
    ruleId: d.code,
    level: d.severity === 'error' ? 'error' : d.severity === 'warning' ? 'warning' : 'note',
    message: { text: d.message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: toUri(filePath) },
          region: {
            startLine: d.range.start.line,
            startColumn: d.range.start.column,
            endLine: d.range.end.line,
            endColumn: d.range.end.column,
          },
        },
      },
    ],
  };
}

function toUri(absPath: string): string {
  // SARIF artifact URIs should be workspace-relative when possible.
  const rel = absPath.replace(process.cwd() + '/', '');
  return rel.replace(/\\/g, '/');
}
