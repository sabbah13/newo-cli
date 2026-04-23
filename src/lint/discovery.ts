/**
 * File discovery for `newo lint` / `newo format` / `newo check`.
 *
 * Walks a customer's tree (or any directory passed on the CLI), filters
 * by format-aware extensions, and optionally narrows to files changed
 * since the last push by consulting `.newo/{customer}/hashes.json`.
 */
import fs from 'fs-extra';
import path from 'path';
import { NEWO_CUSTOMERS_DIR, customerDir } from '../fsutil.js';
import { loadHashes } from '../hash.js';
import { sha256 } from '../hash.js';
import {
  ALL_SCRIPT_EXTENSIONS,
  type FormatVersion,
  CLI_V1_EXTENSIONS,
  NEWO_V2_EXTENSIONS,
} from '../format/types.js';
import type { CustomerConfig } from '../types.js';

export interface DiscoveryOptions {
  /** If set, restrict to one format's extensions only. */
  format?: FormatVersion;
  /** If true, include only files that hash-differ from `.newo/{customer}/hashes.json`. */
  changedOnly?: boolean;
  /** Additional absolute paths to skip. */
  ignore?: string[];
}

export interface DiscoveredFile {
  /** Absolute path on disk. */
  absPath: string;
  /** Path relative to the customer root (for display / reports). */
  relPath: string;
  /** Extension (including leading dot). */
  ext: string;
}

/**
 * Discover script files under a customer's tree.
 * Respects format when given (else walks all recognized extensions).
 */
export async function discoverCustomerFiles(
  customer: CustomerConfig,
  opts: DiscoveryOptions = {},
): Promise<DiscoveredFile[]> {
  const root = customerDir(customer.idn);
  if (!(await fs.pathExists(root))) return [];

  const exts = pickExtensions(opts.format);
  const ignoreSet = new Set(opts.ignore ?? []);

  const hits = await walkForExtensions(root, exts, ignoreSet);

  if (!opts.changedOnly) {
    return hits.map(absPath => toDiscoveredFile(absPath, root));
  }

  const stored = await loadHashes(customer.idn);
  const changed: DiscoveredFile[] = [];
  for (const absPath of hits) {
    const current = sha256(await fs.readFile(absPath, 'utf8'));
    if (stored[absPath] !== current) {
      changed.push(toDiscoveredFile(absPath, root));
    }
  }
  return changed;
}

/**
 * Discover files under an arbitrary directory.
 * Used when the user passes explicit paths to `newo lint some/dir`.
 */
export async function discoverFromPath(
  inputPath: string,
  opts: DiscoveryOptions = {},
): Promise<DiscoveredFile[]> {
  const abs = path.resolve(inputPath);
  if (!(await fs.pathExists(abs))) return [];

  const exts = pickExtensions(opts.format);
  const ignoreSet = new Set(opts.ignore ?? []);
  const stat = await fs.stat(abs);

  let hits: string[];
  if (stat.isFile()) {
    hits = exts.includes(path.extname(abs)) ? [abs] : [];
  } else {
    hits = await walkForExtensions(abs, exts, ignoreSet);
  }

  const root = stat.isDirectory() ? abs : path.dirname(abs);
  return hits.map(p => toDiscoveredFile(p, root));
}

function pickExtensions(format?: FormatVersion): string[] {
  if (!format) return [...ALL_SCRIPT_EXTENSIONS];
  const map = format === 'newo_v2' ? NEWO_V2_EXTENSIONS : CLI_V1_EXTENSIONS;
  return Object.values(map);
}

function toDiscoveredFile(absPath: string, root: string): DiscoveredFile {
  return {
    absPath,
    relPath: path.relative(root, absPath),
    ext: path.extname(absPath),
  };
}

async function walkForExtensions(
  dir: string,
  exts: string[],
  ignore: Set<string>,
): Promise<string[]> {
  const out: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (ignore.has(current)) continue;
    let entries: fs.Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      // Skip hidden dirs, node_modules, and the .newo state directory.
      if (entry.name.startsWith('.')) continue;
      if (entry.name === 'node_modules') continue;
      const full = path.join(current, entry.name);
      if (ignore.has(full)) continue;
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (exts.includes(path.extname(entry.name))) {
        out.push(full);
      }
    }
  }
  return out.sort();
}

/**
 * Default root for lint invocations with no path arguments - the
 * `newo_customers/` directory at the cwd.
 */
export function defaultRoot(): string {
  return NEWO_CUSTOMERS_DIR;
}
