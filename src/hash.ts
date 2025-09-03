import crypto from 'crypto';
import fs from 'fs-extra';
import { ensureState, HASHES_PATH } from './fsutil.js';
import type { HashStore } from './types.js';

export function sha256(str: string): string {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

export async function loadHashes(): Promise<HashStore> {
  await ensureState();
  if (await fs.pathExists(HASHES_PATH)) {
    return fs.readJson(HASHES_PATH) as Promise<HashStore>;
  }
  return {};
}

export async function saveHashes(hashes: HashStore): Promise<void> {
  await fs.writeJson(HASHES_PATH, hashes, { spaces: 2 });
}