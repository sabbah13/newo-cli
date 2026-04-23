/**
 * `newo lint` - static analysis over Guidance / Jinja / NSL / NSLG files.
 *
 * Wraps newo-dsl-analyzer with newo-cli's customer/format/hash primitives.
 * Exit codes:
 *   0  clean (or only warnings below --max-warnings)
 *   1  lint errors found, or warning threshold exceeded
 *   2  unexpected runtime failure (handled by handleCliError)
 */
import fs from 'fs-extra';
import path from 'path';
import {
  createLinter,
  type LinterOptions,
  type ProjectLintReport,
  type RuleSeverity,
} from 'newo-dsl-analyzer';

import { selectSingleCustomer } from '../customer-selection.js';
import { handleCliError } from '../errors.js';
import { resolveFormat } from '../../format/detect.js';
import { discoverCustomerFiles, discoverFromPath, defaultRoot } from '../../lint/discovery.js';
import { loadNewoLintConfig } from '../../lint/config.js';
import { refreshLiveSchema, loadCachedLiveSchema } from '../../lint/live-schema.js';
import { pickReporter } from '../../lint/reporters/index.js';
import type { MultiCustomerConfig, CliArgs, CustomerConfig } from '../../types.js';

interface LintArgs {
  positional: string[];
  formatVersion: string | undefined;
  reporter: string;
  maxWarnings: number;
  quiet: boolean;
  rules: string[];
  noRules: string[];
  changed: boolean;
  live: boolean;
  customer: string | undefined;
}

export async function handleLintCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean,
): Promise<void> {
  try {
    const lintArgs = parseArgs(args);
    const report = await run(customerConfig, lintArgs, verbose);
    const reporter = pickReporter(lintArgs.reporter);
    const output = reporter.write(report);
    if (output.trim().length > 0) process.stdout.write(output + '\n');

    const exitCode = determineExitCode(report, lintArgs);
    if (exitCode !== 0) process.exit(exitCode);
  } catch (err) {
    handleCliError(err, 'lint');
  }
}

function parseArgs(args: CliArgs): LintArgs {
  const positional = args._.slice(1).filter((p): p is string => typeof p === 'string');

  // Multiple flag shapes: --rule=E100, --rule E100,W100
  // Disabling rules uses --rule-off (not --no-rule) because minimist treats
  // `--no-X` as `X: false` and swallows the next positional argument.
  const rules = collectCsv(args.rule);
  const noRules = collectCsv(args['rule-off']);

  return {
    positional,
    formatVersion: args.format as string | undefined,
    reporter: (args.reporter as string | undefined) ?? (args['output-format'] as string | undefined) ?? 'text',
    maxWarnings: parseIntOr(args['max-warnings'], Number.POSITIVE_INFINITY),
    quiet: Boolean(args.quiet),
    rules,
    noRules,
    changed: Boolean(args.changed),
    live: Boolean(args.live),
    customer: args.customer as string | undefined,
  };
}

async function run(
  customerConfig: MultiCustomerConfig,
  args: LintArgs,
  verbose: boolean,
): Promise<ProjectLintReport> {
  const config = loadNewoLintConfig();

  // With explicit positional paths AND no customer/live flag, skip customer
  // selection entirely - lint operates purely on the given filesystem paths.
  const hasCustomerContext =
    args.customer !== undefined ||
    args.live ||
    Object.keys(customerConfig.customers ?? {}).length > 0;

  const { selectedCustomer, allCustomers, isMultiCustomer } = hasCustomerContext
    ? selectSingleCustomer(customerConfig, args.customer)
    : { selectedCustomer: null, allCustomers: [] as CustomerConfig[], isMultiCustomer: false };

  const targetCustomer = selectedCustomer ?? (isMultiCustomer ? null : allCustomers[0] ?? null);

  const schemas = await resolveSchemas(targetCustomer, args, verbose);

  const ruleOverrides: Record<string, RuleSeverity> = {
    ...(config.rules ?? {}),
  };
  for (const code of args.noRules) ruleOverrides[code] = 'off';
  // --rule enables; we map unknown codes to 'warning' to avoid silently accepting typos.
  for (const code of args.rules) {
    if (!(code in ruleOverrides) || ruleOverrides[code] === 'off') {
      ruleOverrides[code] = 'warning';
    }
  }

  const linterOpts: LinterOptions = {
    rules: ruleOverrides,
    ...(schemas !== undefined ? { schemas } : {}),
  };
  const linter = createLinter(linterOpts);

  const files = await resolveFiles(targetCustomer, allCustomers, args, isMultiCustomer);
  if (files.length === 0) {
    return { results: [], errorCount: 0, warningCount: 0 };
  }

  let errorCount = 0;
  let warningCount = 0;
  const results = [];
  for (const file of files) {
    const source = await fs.readFile(file.absPath, 'utf8');
    const result = linter.lint(source, file.absPath);
    for (const d of result.diagnostics) {
      if (d.severity === 'error') errorCount++;
      else if (d.severity === 'warning') warningCount++;
    }
    if (args.quiet) {
      result.diagnostics = result.diagnostics.filter(d => d.severity === 'error');
    }
    results.push(result);
  }
  return { results, errorCount, warningCount: args.quiet ? 0 : warningCount };
}

async function resolveSchemas(
  customer: CustomerConfig | null,
  args: LintArgs,
  verbose: boolean,
): Promise<LinterOptions['schemas']> {
  if (!customer) return 'bundled';

  if (args.live) {
    if (verbose) console.log(`Refreshing live schemas for ${customer.idn}...`);
    const snapshot = await refreshLiveSchema(customer);
    return { kind: 'inline', actions: snapshot.actions };
  }

  // Auto-use cached live snapshot if it exists (faster, always specific to
  // the customer's actual NEWO account state). Fall back to bundled.
  const cached = await loadCachedLiveSchema(customer.idn);
  if (cached) {
    if (verbose) {
      const age = Math.round((Date.now() - Date.parse(cached.fetchedAt)) / 1000 / 60);
      console.log(`Using cached schemas for ${customer.idn} (${age} min old). Use --live to refresh.`);
    }
    return { kind: 'inline', actions: cached.actions };
  }

  return 'bundled';
}

async function resolveFiles(
  selected: CustomerConfig | null,
  all: CustomerConfig[],
  args: LintArgs,
  isMultiCustomer: boolean,
): ReturnType<typeof discoverFromPath> {
  // Explicit positional paths beat everything else.
  if (args.positional.length > 0) {
    const files = [];
    for (const p of args.positional) {
      const discovered = await discoverFromPath(p, {
        ...(args.formatVersion ? { format: toFormatVersion(args.formatVersion) } : {}),
      });
      files.push(...discovered);
    }
    return files;
  }

  if (selected) {
    const formatVersion = resolveFormat(selected.idn, args.formatVersion).version;
    return discoverCustomerFiles(selected, {
      format: formatVersion,
      changedOnly: args.changed,
    });
  }

  if (isMultiCustomer) {
    const files = [];
    for (const customer of all) {
      const formatVersion = resolveFormat(customer.idn, args.formatVersion).version;
      const customerFiles = await discoverCustomerFiles(customer, {
        format: formatVersion,
        changedOnly: args.changed,
      });
      files.push(...customerFiles);
    }
    return files;
  }

  // No customer context - lint cwd / newo_customers/ directly.
  return discoverFromPath(defaultRoot(), {
    ...(args.formatVersion ? { format: toFormatVersion(args.formatVersion) } : {}),
  });
}

function determineExitCode(report: ProjectLintReport, args: LintArgs): number {
  if (report.errorCount > 0) return 1;
  if (report.warningCount > args.maxWarnings) return 1;
  return 0;
}

function collectCsv(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  const items = Array.isArray(value) ? value : [value];
  return items
    .flatMap((v: unknown) => String(v).split(','))
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

function parseIntOr(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallback;
}

function toFormatVersion(v: string): 'cli_v1' | 'newo_v2' {
  return v === 'newo_v2' ? 'newo_v2' : 'cli_v1';
}

// Silence unused path import warning; path is used via discovery helpers.
void path;
