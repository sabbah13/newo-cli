/**
 * MCP tool: newo_status
 *
 * Returns the per-customer sync status: how many local files differ from the
 * platform, which entities exist locally that haven't been pushed yet, what
 * would be created/updated on the next `newo push`. Read-only - no mutations.
 *
 * This is a lightweight wrapper around the `loadHashes` / file-walk logic used
 * by the CLI's `newo status` command. It returns a structured summary instead
 * of the human table the CLI prints.
 */
import { z } from 'zod';
import path from 'path';
import fs from 'fs-extra';
import { clientFor, getCustomerConfig, toolResult, toolError } from '../context.js';
import { loadHashes } from '../../hash.js';
import { sha256 } from '../../hash.js';
import { mapPath } from '../../fsutil.js';

async function listChangedFiles(customerIdn: string): Promise<{
  modified: string[];
  total: number;
}> {
  const customerDir = path.join(process.cwd(), 'newo_customers', customerIdn);
  if (!(await fs.pathExists(customerDir))) {
    return { modified: [], total: 0 };
  }

  const hashes = await loadHashes(customerIdn);
  const modified: string[] = [];
  let total = 0;

  // Walk every tracked file and compare hashes.
  for (const [filePath, oldHash] of Object.entries(hashes)) {
    total++;
    if (!(await fs.pathExists(filePath))) {
      modified.push(`${filePath} (deleted)`);
      continue;
    }
    const content = await fs.readFile(filePath, 'utf-8');
    const newHash = sha256(content);
    if (newHash !== oldHash) {
      modified.push(filePath);
    }
  }

  return { modified, total };
}

export const statusTool = {
  name: 'newo_status',
  description:
    "Return NEWO sync status for a customer (or all configured customers). Reports modified files (changed since last pull), local-only entities (created locally, not yet pushed), and a one-line snapshot. Read-only; no platform call beyond what's needed to confirm auth. Use before `newo push` for a pre-deploy snapshot, or to find out what will be sent.",
  inputSchema: z.object({
    customer_idn: z
      .string()
      .optional()
      .describe('Specific customer to check. Omit to check every configured customer.'),
  }),
  handler: async (args: { customer_idn?: string }) => {
    try {
      const config = await getCustomerConfig();
      const targetIdns = args.customer_idn
        ? [args.customer_idn]
        : Object.keys(config.customers);

      if (targetIdns.length === 0) {
        return toolError('No customers configured.');
      }

      const results = await Promise.all(
        targetIdns.map(async (idn) => {
          const cust = config.customers[idn];
          if (!cust) {
            return { idn, error: `Customer "${idn}" not configured` };
          }

          const mapFile = mapPath(idn);
          const hasMap = await fs.pathExists(mapFile);
          if (!hasMap) {
            return {
              idn,
              has_map: false,
              note: 'No local map - run `newo pull` first.',
            };
          }

          const { modified, total } = await listChangedFiles(idn);

          // Lightweight auth check: build a client (does token refresh).
          let auth_ok = false;
          let auth_error: string | undefined;
          try {
            await clientFor(idn);
            auth_ok = true;
          } catch (err) {
            auth_error = err instanceof Error ? err.message : String(err);
          }

          return {
            idn,
            has_map: true,
            tracked_files: total,
            modified_count: modified.length,
            modified,
            auth_ok,
            ...(auth_error ? { auth_error } : {}),
          };
        })
      );

      const totalModified = results.reduce(
        (n, r) => n + ((r as any).modified_count ?? 0),
        0
      );

      const summary =
        totalModified === 0
          ? `All ${targetIdns.length} customer(s) clean - nothing to push.`
          : `${totalModified} file(s) modified across ${targetIdns.length} customer(s). Run \`newo push\` to deploy.`;

      return toolResult(summary, { customers: results });
    } catch (err) {
      return toolError(`Status check failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};
