import fs from 'fs-extra';
import path from 'path';
import type { RunnerType } from './types.js';

export const NEWO_CUSTOMERS_DIR = path.posix.join(process.cwd(), 'newo_customers');
export const STATE_DIR = path.join(process.cwd(), '.newo');

export function customerDir(customerIdn: string): string {
  return path.posix.join(NEWO_CUSTOMERS_DIR, customerIdn);
}

export function customerProjectsDir(customerIdn: string): string {
  return path.posix.join(customerDir(customerIdn), 'projects');
}

export function customerStateDir(customerIdn: string): string {
  return path.join(STATE_DIR, customerIdn);
}

export function mapPath(customerIdn: string): string {
  return path.join(customerStateDir(customerIdn), 'map.json');
}

export function hashesPath(customerIdn: string): string {
  return path.join(customerStateDir(customerIdn), 'hashes.json');
}

export async function ensureState(customerIdn: string): Promise<void> {
  await fs.ensureDir(STATE_DIR);
  await fs.ensureDir(customerStateDir(customerIdn));
  await fs.ensureDir(customerProjectsDir(customerIdn));
}

export function projectDir(customerIdn: string, projectIdn: string): string {
  return path.posix.join(customerProjectsDir(customerIdn), projectIdn);
}

export function flowsYamlPath(customerIdn: string): string {
  return path.posix.join(customerProjectsDir(customerIdn), 'flows.yaml');
}

export function skillPath(
  customerIdn: string,
  projectIdn: string, 
  agentIdn: string, 
  flowIdn: string, 
  skillIdn: string, 
  runnerType: RunnerType = 'guidance'
): string {
  const extension = runnerType === 'nsl' ? '.jinja' : '.guidance';
  return path.posix.join(customerProjectsDir(customerIdn), projectIdn, agentIdn, flowIdn, `${skillIdn}${extension}`);
}

export function metadataPath(customerIdn: string, projectIdn: string): string {
  return path.posix.join(customerProjectsDir(customerIdn), projectIdn, 'metadata.json');
}

// Legacy support - will be deprecated
export const ROOT_DIR = path.posix.join(process.cwd(), 'projects');
export const MAP_PATH = path.join(STATE_DIR, 'map.json');
export const HASHES_PATH = path.join(STATE_DIR, 'hashes.json');

export async function writeFileSafe(filepath: string, content: string): Promise<void> {
  await fs.ensureDir(path.dirname(filepath));
  await fs.writeFile(filepath, content, 'utf8');
}

// Deprecated: use writeFileSafe instead
export const writeFileAtomic = writeFileSafe;

export async function readIfExists(filepath: string): Promise<string | null> {
  return (await fs.pathExists(filepath)) ? fs.readFile(filepath, 'utf8') : null;
}