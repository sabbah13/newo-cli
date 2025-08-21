import fs from 'fs-extra';
import path from 'path';

export const ROOT_DIR = path.join(process.cwd(), 'projects');
export const STATE_DIR = path.join(process.cwd(), '.newo');
export const MAP_PATH = path.join(STATE_DIR, 'map.json');
export const HASHES_PATH = path.join(STATE_DIR, 'hashes.json');

export async function ensureState() {
  await fs.ensureDir(STATE_DIR);
  await fs.ensureDir(ROOT_DIR);
}

export function projectDir(projectIdn) {
  return path.join(ROOT_DIR, projectIdn);
}

export function skillPath(projectIdn, agentIdn, flowIdn, skillIdn, runnerType = 'guidance') {
  const extension = runnerType === 'nsl' ? '.jinja' : '.guidance';
  return path.join(ROOT_DIR, projectIdn, agentIdn, flowIdn, `${skillIdn}${extension}`);
}

export function metadataPath(projectIdn) {
  return path.join(ROOT_DIR, projectIdn, 'metadata.json');
}

export async function writeFileAtomic(filepath, content) {
  await fs.ensureDir(path.dirname(filepath));
  await fs.writeFile(filepath, content, 'utf8');
}

export async function readIfExists(filepath) {
  return (await fs.pathExists(filepath)) ? fs.readFile(filepath, 'utf8') : null;
}
