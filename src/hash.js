import crypto from 'crypto';
import fs from 'fs-extra';
import { ensureState, HASHES_PATH } from './fsutil.js';

export function sha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

export async function loadHashes() {
  await ensureState();
  if (await fs.pathExists(HASHES_PATH)) return fs.readJson(HASHES_PATH);
  return {};
}

export async function saveHashes(h) {
  await fs.writeJson(HASHES_PATH, h, { spaces: 2 });
}
