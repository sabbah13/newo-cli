/**
 * `newo format` - apply canonical formatting to DSL files.
 *
 * Invokes newo-dsl-analyzer's Formatter. In v1 the formatter is an
 * identity transform (just ensures a final newline). Concrete rules
 * land in subsequent versions; the command surface is stable now so
 * CI pipelines and pre-commit hooks can wire `newo format --check`
 * immediately.
 */
import fs from 'fs-extra';
import path from 'path';
import { createFormatter } from 'newo-dsl-analyzer';

import { selectSingleCustomer } from '../customer-selection.js';
import { handleCliError } from '../errors.js';
import { resolveFormat } from '../../format/detect.js';
import { discoverCustomerFiles, discoverFromPath, defaultRoot } from '../../lint/discovery.js';
import type { MultiCustomerConfig, CliArgs, CustomerConfig } from '../../types.js';
import type { FormatVersion } from '../../format/types.js';

interface FormatArgs {
  positional: string[];
  formatVersion: string | undefined;
  check: boolean;
  customer: string | undefined;
}

export async function handleFormatCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean,
): Promise<void> {
  try {
    const fmtArgs = parseArgs(args);
    const formatter = createFormatter();

    const hasCustomerContext =
      fmtArgs.customer !== undefined ||
      Object.keys(customerConfig.customers ?? {}).length > 0;

    const { selectedCustomer, allCustomers, isMultiCustomer } = hasCustomerContext
      ? selectSingleCustomer(customerConfig, fmtArgs.customer)
      : { selectedCustomer: null, allCustomers: [] as CustomerConfig[], isMultiCustomer: false };

    const targetCustomer = selectedCustomer ?? (isMultiCustomer ? null : allCustomers[0] ?? null);
    void targetCustomer;

    const files = await resolveFiles(targetCustomer, allCustomers, fmtArgs, isMultiCustomer);
    if (files.length === 0) {
      console.log('No files matched.');
      return;
    }

    let touched = 0;
    let needsFormat = 0;
    for (const file of files) {
      const source = await fs.readFile(file.absPath, 'utf8');
      const result = formatter.format(source, file.absPath);
      if (!result.changed) continue;
      needsFormat++;
      if (fmtArgs.check) {
        console.log(`would rewrite ${path.relative(process.cwd(), file.absPath)}`);
      } else {
        await fs.writeFile(file.absPath, result.formatted, 'utf8');
        touched++;
        if (verbose) console.log(`formatted ${path.relative(process.cwd(), file.absPath)}`);
      }
    }

    if (fmtArgs.check) {
      if (needsFormat === 0) {
        console.log('All files are properly formatted.');
        return;
      }
      console.log(`${needsFormat} file(s) would be reformatted.`);
      process.exit(1);
    } else {
      console.log(`Formatted ${touched} file(s).`);
    }
  } catch (err) {
    handleCliError(err, 'format');
  }
}

function parseArgs(args: CliArgs): FormatArgs {
  const positional = args._.slice(1).filter((p): p is string => typeof p === 'string');
  return {
    positional,
    formatVersion: args.format as string | undefined,
    check: Boolean(args.check),
    customer: args.customer as string | undefined,
  };
}

async function resolveFiles(
  selected: CustomerConfig | null,
  all: CustomerConfig[],
  args: FormatArgs,
  isMultiCustomer: boolean,
) {
  if (args.positional.length > 0) {
    const files = [];
    for (const p of args.positional) {
      files.push(
        ...(await discoverFromPath(p, {
          ...(args.formatVersion ? { format: toFormatVersion(args.formatVersion) } : {}),
        })),
      );
    }
    return files;
  }
  if (selected) {
    const formatVersion = resolveFormat(selected.idn, args.formatVersion).version;
    return discoverCustomerFiles(selected, { format: formatVersion });
  }
  if (isMultiCustomer) {
    const files = [];
    for (const customer of all) {
      const formatVersion = resolveFormat(customer.idn, args.formatVersion).version;
      files.push(...(await discoverCustomerFiles(customer, { format: formatVersion })));
    }
    return files;
  }
  return discoverFromPath(defaultRoot(), {
    ...(args.formatVersion ? { format: toFormatVersion(args.formatVersion) } : {}),
  });
}

function toFormatVersion(v: string): FormatVersion {
  return v === 'newo_v2' ? 'newo_v2' : 'cli_v1';
}
