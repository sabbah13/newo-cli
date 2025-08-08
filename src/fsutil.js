import fs from 'fs-extra';
import path from 'path';

export const ROOT_DIR = path.join(process.cwd(), 'project');
export const STATE_DIR = path.join(process.cwd(), '.newo');
export const MAP_PATH = path.join(STATE_DIR, 'map.json');
export const HASHES_PATH = path.join(STATE_DIR, 'hashes.json');

export async function ensureState() {
  await fs.ensureDir(STATE_DIR);
  await fs.ensureDir(ROOT_DIR);
}

export function skillPath(agentIdn, flowIdn, skillIdn) {
  return path.join(ROOT_DIR, agentIdn, flowIdn, `${skillIdn}.gdn`);
}

export async function writeFileAtomic(filepath, content) {
  await fs.ensureDir(path.dirname(filepath));
  await fs.writeFile(filepath, content, 'utf8');
}

export async function readIfExists(filepath) {
  return (await fs.pathExists(filepath)) ? fs.readFile(filepath, 'utf8') : null;
}
