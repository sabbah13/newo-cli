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

  console.log(`\n⚠️  Local changes will be replaced by remote content for skill ${skillIdn} (${fileName}):`);

  // ANSI color codes with background colors
  const redBg = '\x1b[41m\x1b[37m';     // Red background, white text
  const greenBg = '\x1b[42m\x1b[30m';   // Green background, black text
  const gray = '\x1b[90m';
  const reset = '\x1b[0m';

  // Show a GitHub-style colored diff with line numbers
  const localLines = existingContent.trim().split('\n');
  const remoteLines = newContent.trim().split('\n');

  // Create a unified diff view
  const maxLines = Math.max(localLines.length, remoteLines.length);
  let diffShown = 0;
  const maxDiffLines = 10;

  console.log(`${gray}   Local (-) vs Remote (+):${reset}`);

  for (let i = 0; i < maxLines && diffShown < maxDiffLines; i++) {
    const localLine = localLines[i];
    const remoteLine = remoteLines[i];
    const lineNum = String(i + 1).padStart(3);

    // Show context line if both exist and are the same
    if (localLine !== undefined && remoteLine !== undefined && localLine === remoteLine) {
      console.log(`${gray}    ${lineNum}      ${localLine}${reset}`);
    } else {
      // Show differences
      if (localLine !== undefined) {
        console.log(`${redBg} -  ${lineNum}      ${localLine} ${reset}`);
        diffShown++;
      }
      if (remoteLine !== undefined) {
        console.log(`${greenBg} +  ${lineNum}      ${remoteLine} ${reset}`);
        diffShown++;
      }
    }
  }

  if (diffShown === maxDiffLines) {
    const remainingDiffs = Math.abs(localLines.length - remoteLines.length);
    if (remainingDiffs > 0) {
      console.log(`${gray}   ... (${remainingDiffs} more line differences)${reset}`);
    }
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