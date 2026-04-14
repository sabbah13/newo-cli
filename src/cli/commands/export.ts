/**
 * Export command handler - downloads V2 bulk export ZIP from platform
 *
 * Usage:
 *   newo export                           # Export to temp/export-{customerIdn}-{timestamp}.zip
 *   newo export --output my-export.zip    # Export to specific file
 *   newo export --no-akb                  # Exclude AKB from export
 *   newo export --no-attributes           # Exclude customer attributes
 */
import { makeClient, exportCustomerV2 } from '../../api.js';
import { getValidAccessToken } from '../../auth.js';
import { selectSingleCustomer } from '../customer-selection.js';
import fs from 'fs-extra';
import path from 'path';
import type { MultiCustomerConfig, CliArgs } from '../../types.js';

export async function handleExportCommand(
  customerConfig: MultiCustomerConfig,
  args: CliArgs,
  verbose: boolean
): Promise<void> {
  const { selectedCustomer } = selectSingleCustomer(
    customerConfig,
    args.customer as string | undefined
  );

  if (!selectedCustomer) {
    console.error('Please specify a customer with --customer');
    process.exit(1);
  }

  const accessToken = await getValidAccessToken(selectedCustomer);
  const client = await makeClient(verbose, accessToken);

  // Get customer ID from token (needed for V2 export API)
  const customerId = await getCustomerIdFromToken(accessToken);
  if (!customerId) {
    console.error('Could not determine customer ID from token');
    process.exit(1);
  }

  const exportAkb = !args['no-akb'];
  const exportAttributes = !args['no-attributes'];

  console.log(`Downloading V2 export for customer ${selectedCustomer.idn}...`);

  const zipBuffer = await exportCustomerV2(client, customerId, {
    export_akb: exportAkb,
    export_customer_attributes: exportAttributes,
  });

  // Determine output path
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const defaultName = `export-${selectedCustomer.idn}-${timestamp}.zip`;
  const outputPath = (args.output as string | undefined) || (args.o as string | undefined)
    || path.join(process.cwd(), 'temp', defaultName);

  await fs.ensureDir(path.dirname(outputPath));
  await fs.writeFile(outputPath, zipBuffer);

  console.log(`Exported ${(zipBuffer.length / 1024 / 1024).toFixed(1)}MB to ${outputPath}`);
}

/**
 * Extract customer_id from JWT token payload
 */
function getCustomerIdFromToken(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1]!;
    const padded = payload + '='.repeat(4 - (payload.length % 4));
    const decoded = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Record<string, unknown>;
    return (decoded['customer_id'] as string) || (decoded['sub'] as string) || null;
  } catch {
    return null;
  }
}
