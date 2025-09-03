import fs from 'fs-extra';
import path from 'path';
import type { RunnerType } from './types.js';

export const ROOT_DIR = path.join(process.cwd(), 'projects');
export const STATE_DIR = path.join(process.cwd(), '.newo');
export const MAP_PATH = path.join(STATE_DIR, 'map.json');
export const HASHES_PATH = path.join(STATE_DIR, 'hashes.json');

export async function ensureState(): Promise<void> {
  await fs.ensureDir(STATE_DIR);
  await fs.ensureDir(ROOT_DIR);
}

export function projectDir(projectIdn: string): string {
  return path.join(ROOT_DIR, projectIdn);
}

export function skillPath(
  projectIdn: string, 
  agentIdn: string, 
  flowIdn: string, 
  skillIdn: string, 
  runnerType: RunnerType = 'guidance'
): string {
  const extension = runnerType === 'nsl' ? '.jinja' : '.guidance';
  return path.join(ROOT_DIR, projectIdn, agentIdn, flowIdn, `${skillIdn}${extension}`);
}

export function metadataPath(projectIdn: string): string {
  return path.join(ROOT_DIR, projectIdn, 'metadata.json');
}

export async function writeFileAtomic(filepath: string, content: string): Promise<void> {
  await fs.ensureDir(path.dirname(filepath));
  await fs.writeFile(filepath, content, 'utf8');
}

export async function readIfExists(filepath: string): Promise<string | null> {
  return (await fs.pathExists(filepath)) ? fs.readFile(filepath, 'utf8') : null;
}