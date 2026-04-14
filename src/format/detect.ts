/**
 * Format detection and resolution
 *
 * Resolution chain per customer (highest to lowest priority):
 * 1. Explicit --format flag (per-command override)
 * 2. Filesystem auto-detect (for EXISTING customers):
 *    - import_version.txt present -> newo_v2
 *    - projects/ directory present -> cli_v1
 * 3. NEWO_FORMAT env var (only for NEW customers where nothing exists locally)
 * 4. Default: cli_v1
 */
import fs from 'fs-extra';
import path from 'path';
import { NEWO_CUSTOMERS_DIR } from '../fsutil.js';
import { type FormatVersion, type FormatConfig, VALID_FORMATS } from './types.js';

/**
 * Detect format from existing filesystem structure for a customer
 * Returns null if the customer directory doesn't exist or is empty
 */
export function detectFormatFromFilesystem(customerIdn: string): FormatVersion | null {
  const customerDir = path.join(NEWO_CUSTOMERS_DIR, customerIdn);

  if (!fs.existsSync(customerDir)) {
    return null;
  }

  // Check for V2 marker: import_version.txt
  const importVersionFile = path.join(customerDir, 'import_version.txt');
  if (fs.existsSync(importVersionFile)) {
    return 'newo_v2';
  }

  // Check for V1 marker: projects/ directory
  const projectsDir = path.join(customerDir, 'projects');
  if (fs.existsSync(projectsDir)) {
    return 'cli_v1';
  }

  // Check one level down for import_version.txt (V2 exports sometimes have a wrapper dir)
  try {
    const entries = fs.readdirSync(customerDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const nestedImportVersion = path.join(customerDir, entry.name, 'import_version.txt');
        if (fs.existsSync(nestedImportVersion)) {
          return 'newo_v2';
        }
      }
    }
  } catch {
    // Ignore read errors
  }

  // Directory exists but no format markers found - could be empty or only has attributes
  return null;
}

/**
 * Get format from NEWO_FORMAT environment variable
 */
function getEnvFormat(): FormatVersion | null {
  const envFormat = process.env['NEWO_FORMAT']?.trim().toLowerCase();
  if (!envFormat) return null;

  if ((VALID_FORMATS as readonly string[]).includes(envFormat)) {
    return envFormat as FormatVersion;
  }

  console.warn(
    `Warning: Invalid NEWO_FORMAT="${envFormat}". Valid values: ${VALID_FORMATS.join(', ')}. Using default.`
  );
  return null;
}

/**
 * Validate an explicit format string from --format flag
 */
function validateExplicitFormat(format: string): FormatVersion | null {
  const normalized = format.trim().toLowerCase();
  if ((VALID_FORMATS as readonly string[]).includes(normalized)) {
    return normalized as FormatVersion;
  }
  return null;
}

/**
 * Resolve the format version for a customer using the full resolution chain
 *
 * @param customerIdn - Customer identifier
 * @param explicitFormat - Optional --format flag value
 */
export function resolveFormat(
  customerIdn: string,
  explicitFormat?: string
): FormatConfig {
  // 1. Explicit --format flag takes highest priority
  if (explicitFormat) {
    const validated = validateExplicitFormat(explicitFormat);
    if (validated) {
      return { version: validated, source: 'explicit-flag' };
    }
    console.error(
      `Invalid format "${explicitFormat}". Valid values: ${VALID_FORMATS.join(', ')}`
    );
    process.exit(1);
  }

  // 2. Filesystem auto-detect for existing customers
  const detected = detectFormatFromFilesystem(customerIdn);
  if (detected) {
    return { version: detected, source: 'auto-detected' };
  }

  // 3. NEWO_FORMAT env var (for new customers only)
  const envFormat = getEnvFormat();
  if (envFormat) {
    return { version: envFormat, source: 'env-var' };
  }

  // 4. Default: cli_v1
  return { version: 'cli_v1', source: 'default' };
}
