/**
 * Format version types and constants
 *
 * Defines the two supported project formats:
 * - cli_v1: Native CLI format (full feature support, per-entity metadata)
 * - newo_v2: NEWO platform export format (compatible with platform UI exports)
 */
import type { RunnerType } from '../types.js';

export type FormatVersion = 'cli_v1' | 'newo_v2';

export interface FormatConfig {
  version: FormatVersion;
  source: 'explicit-flag' | 'env-var' | 'auto-detected' | 'default';
}

/**
 * Extension mapping per format
 *
 * cli_v1: guidance -> .guidance, nsl -> .jinja
 * newo_v2: guidance -> .nslg, nsl -> .nsl
 */
export const CLI_V1_EXTENSIONS: Record<RunnerType, string> = {
  guidance: '.guidance',
  nsl: '.jinja',
} as const;

export const NEWO_V2_EXTENSIONS: Record<RunnerType, string> = {
  guidance: '.nslg',
  nsl: '.nsl',
} as const;

/** All recognized script file extensions across both formats */
export const ALL_SCRIPT_EXTENSIONS = ['.guidance', '.jinja', '.nsl', '.nslg'] as const;

/** V2 import version marker content */
export const V2_IMPORT_VERSION = 'v2.0.0';

/** Valid format values for CLI flag and env var validation */
export const VALID_FORMATS: readonly FormatVersion[] = ['cli_v1', 'newo_v2'] as const;
