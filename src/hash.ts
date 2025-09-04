import crypto from 'crypto';
import fs from 'fs-extra';
import { ensureState, HASHES_PATH } from './fsutil.js';
import type { HashStore } from './types.js';

export function sha256(str: string): string {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

export async function loadHashes(): Promise<HashStore> {
  await ensureState();
  try {
    return await fs.readJson(HASHES_PATH) as HashStore;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

export async function saveHashes(hashes: HashStore): Promise<void> {
  await fs.writeJson(HASHES_PATH, hashes, { spaces: 2 });
}