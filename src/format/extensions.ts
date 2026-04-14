/**
 * Format-aware file extension mapping
 *
 * Handles the extension differences between cli_v1 and newo_v2:
 *   cli_v1:  guidance -> .guidance,  nsl -> .jinja
 *   newo_v2: guidance -> .nslg,      nsl -> .nsl
 */
import type { RunnerType } from '../types.js';
import {
  type FormatVersion,
  CLI_V1_EXTENSIONS,
  NEWO_V2_EXTENSIONS,
  ALL_SCRIPT_EXTENSIONS,
} from './types.js';

/**
 * Get file extension for a runner type in a specific format
 */
export function getExtensionForFormat(runnerType: RunnerType, format: FormatVersion): string {
  const map = format === 'newo_v2' ? NEWO_V2_EXTENSIONS : CLI_V1_EXTENSIONS;
  const ext = map[runnerType];
  return ext ?? CLI_V1_EXTENSIONS.guidance;
}

/**
 * Get runner type from file extension (works for all 4 extensions)
 */
export function getRunnerTypeFromExtension(ext: string): RunnerType {
  const normalized = ext.startsWith('.') ? ext : `.${ext}`;
  switch (normalized) {
    case '.guidance':
    case '.nslg':
      return 'guidance';
    case '.jinja':
    case '.nsl':
      return 'nsl';
    default:
      return 'guidance';
  }
}

/**
 * Check if a filename is a recognized script file (any format)
 */
export function isScriptFile(filename: string): boolean {
  const ext = filename.lastIndexOf('.') >= 0
    ? filename.slice(filename.lastIndexOf('.'))
    : '';
  return (ALL_SCRIPT_EXTENSIONS as readonly string[]).includes(ext.toLowerCase());
}

/**
 * Infer format version from a file extension
 */
export function getFormatFromExtension(ext: string): FormatVersion {
  const normalized = ext.startsWith('.') ? ext : `.${ext}`;
  if (normalized === '.nsl' || normalized === '.nslg') {
    return 'newo_v2';
  }
  return 'cli_v1';
}
