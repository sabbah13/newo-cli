/**
 * Skill file management utilities
 */
import fs from 'fs-extra';
import path from 'path';
import { sha256 } from '../hash.js';
import { skillFolderPath } from '../fsutil.js';
import type { RunnerType } from '../types.js';

export interface SkillFile {
  filePath: string;
  fileName: string;
  extension: string;
  content: string;
}

export interface SkillFileValidation {
  isValid: boolean;
  files: SkillFile[];
  warnings: string[];
  errors: string[];
}

/**
 * Get the correct file extension for a runner type
 */
export function getExtensionForRunner(runnerType: RunnerType): string {
  switch (runnerType) {
    case 'guidance':
      return 'guidance';
    case 'nsl':
      return 'jinja';
    default:
      return 'guidance';
  }
}

/**
 * Generate IDN-based script file path
 */
export function getIdnBasedScriptPath(
  customerIdn: string,
  projectIdn: string,
  agentIdn: string,
  flowIdn: string,
  skillIdn: string,
  runnerType: RunnerType
): string {
  const extension = getExtensionForRunner(runnerType);
  const folderPath = skillFolderPath(customerIdn, projectIdn, agentIdn, flowIdn, skillIdn);
  return path.join(folderPath, `${skillIdn}.${extension}`);
}

/**
 * Find all script files in a skill folder
 */
export async function findSkillScriptFiles(skillFolderPath: string): Promise<SkillFile[]> {
  if (!(await fs.pathExists(skillFolderPath))) {
    return [];
  }

  const files = await fs.readdir(skillFolderPath);
  const scriptFiles: SkillFile[] = [];

  for (const fileName of files) {
    const filePath = path.join(skillFolderPath, fileName);
    const stats = await fs.stat(filePath);

    if (stats.isFile()) {
      const ext = path.extname(fileName).toLowerCase();

      // Check for script file extensions
      if (['.jinja', '.guidance', '.nsl'].includes(ext)) {
        const content = await fs.readFile(filePath, 'utf8');
        scriptFiles.push({
          filePath,
          fileName,
          extension: ext.slice(1), // Remove the dot
          content
        });
      }
    }
  }

  return scriptFiles;
}

/**
 * Validate skill folder has exactly one script file
 */
export async function validateSkillFolder(
  customerIdn: string,
  projectIdn: string,
  agentIdn: string,
  flowIdn: string,
  skillIdn: string
): Promise<SkillFileValidation> {
  const folderPath = skillFolderPath(customerIdn, projectIdn, agentIdn, flowIdn, skillIdn);
  const files = await findSkillScriptFiles(folderPath);

  const warnings: string[] = [];
  const errors: string[] = [];

  if (files.length === 0) {
    errors.push(`No script files found in skill folder: ${skillIdn}`);
  } else if (files.length > 1) {
    errors.push(`Multiple script files found in skill ${skillIdn}: ${files.map(f => f.fileName).join(', ')}`);
    warnings.push(`Only one script file allowed per skill. Remove extra files and keep one.`);
  }

  return {
    isValid: files.length === 1,
    files,
    warnings,
    errors
  };
}

/**
 * Get the single skill script file (if valid)
 */
export async function getSingleSkillFile(
  customerIdn: string,
  projectIdn: string,
  agentIdn: string,
  flowIdn: string,
  skillIdn: string
): Promise<SkillFile | null> {
  const validation = await validateSkillFolder(customerIdn, projectIdn, agentIdn, flowIdn, skillIdn);

  if (validation.isValid && validation.files.length === 1) {
    return validation.files[0]!;
  }

  return null;
}

/**
 * Check if skill script content is different from target content
 */
export function isContentDifferent(existingContent: string, newContent: string): boolean {
  return sha256(existingContent.trim()) !== sha256(newContent.trim());
}

export type OverwriteChoice = 'yes' | 'no' | 'all' | 'quit';

/**
 * Interactive overwrite confirmation with content diff
 */
export async function askForOverwrite(skillIdn: string, existingContent: string, newContent: string, fileName: string): Promise<OverwriteChoice> {
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log(`\n⚠️  Content differs for skill ${skillIdn} (${fileName}):`);

  // ANSI color codes
  const red = '\x1b[31m';
  const green = '\x1b[32m';
  const reset = '\x1b[0m';

  // Show a GitHub-style colored diff
  const existingLines = existingContent.trim().split('\n');
  const newLines = newContent.trim().split('\n');

  // Show first few different lines with colors
  let diffShown = 0;
  const maxDiffLines = 5;

  for (let i = 0; i < Math.max(existingLines.length, newLines.length) && diffShown < maxDiffLines; i++) {
    const existingLine = existingLines[i] || '';
    const newLine = newLines[i] || '';

    if (existingLine !== newLine) {
      if (existingLine) console.log(`${red}-${existingLine}${reset}`);
      if (newLine) console.log(`${green}+${newLine}${reset}`);
      diffShown++;
    }
  }

  if (diffShown === maxDiffLines) {
    console.log('   ... (more differences)');
  }

  const answer = await new Promise<string>((resolve) => {
    rl.question(`\nReplace local with remote? (y)es/(n)o/(a)ll/(q)uit: `, resolve);
  });
  rl.close();

  const choice = answer.toLowerCase().trim();

  if (choice === 'q' || choice === 'quit') {
    return 'quit';
  }

  if (choice === 'a' || choice === 'all') {
    return 'all';
  }

  if (choice === 'y' || choice === 'yes') {
    return 'yes';
  }

  return 'no';
}