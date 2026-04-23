/**
 * Live schema refresh: hits `/api/v1/script/actions` via the existing
 * NEWO api client, caches the response to `.newo/{customer}/actions.json`,
 * and returns an object shaped for `createLinter({ schemas: { kind: 'inline', ... }})`.
 */
import fs from 'fs-extra';
import path from 'path';
import { customerStateDir } from '../fsutil.js';
import type { CustomerConfig, ScriptAction } from '../types.js';
import { getValidAccessToken } from '../auth.js';
import { makeClient, getScriptActions } from '../api.js';

export interface LiveSchemaSnapshot {
  actions: Array<{ name: string; [k: string]: unknown }>;
  fetchedAt: string;
}

export async function liveSchemaCachePath(customerIdn: string): Promise<string> {
  const dir = customerStateDir(customerIdn);
  await fs.ensureDir(dir);
  return path.join(dir, 'actions.json');
}

/**
 * Fetch the current action catalog from NEWO and cache it.
 * Returns a snapshot ready to pass to `createLinter`.
 */
export async function refreshLiveSchema(
  customer: CustomerConfig,
): Promise<LiveSchemaSnapshot> {
  const token = await getValidAccessToken(customer);
  const client = await makeClient(false, token);
  const actions = await getScriptActions(client);
  const snapshot: LiveSchemaSnapshot = {
    actions: actions.map((a: ScriptAction) => ({
      name: a.idn ?? a.title,
      title: a.title,
      ...(a.idn !== undefined ? { idn: a.idn } : {}),
      arguments: a.arguments,
    })),
    fetchedAt: new Date().toISOString(),
  };
  const cachePath = await liveSchemaCachePath(customer.idn);
  await fs.writeJson(cachePath, snapshot, { spaces: 2 });
  return snapshot;
}

/**
 * Load the cached snapshot if present. Returns null when the cache is
 * missing or corrupt (caller should fall back to bundled schemas).
 */
export async function loadCachedLiveSchema(
  customerIdn: string,
): Promise<LiveSchemaSnapshot | null> {
  const cachePath = await liveSchemaCachePath(customerIdn);
  if (!(await fs.pathExists(cachePath))) return null;
  try {
    return (await fs.readJson(cachePath)) as LiveSchemaSnapshot;
  } catch {
    return null;
  }
}
