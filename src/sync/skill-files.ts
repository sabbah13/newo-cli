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

  // ANSI color codes matching GitHub diff colors from screenshot
  const redBg = '\x1b[101m\x1b[97m';    // Light red background, white text (like GitHub)
  const greenBg = '\x1b[102m\x1b[30m';  // Light green background, black text (like GitHub)
  const gray = '\x1b[90m';
  const reset = '\x1b[0m';

  // Show a GitHub-style colored diff with line numbers and context
  const localLines = existingContent.trim().split('\n');
  const remoteLines = newContent.trim().split('\n');

  // Find differences and show with 2 lines context before/after
  const diffs: Array<{localIndex: number, remoteIndex: number, type: 'change' | 'add' | 'remove'}> = [];

  // Simple diff algorithm to find changes
  let localIdx = 0;
  let remoteIdx = 0;

  while (localIdx < localLines.length || remoteIdx < remoteLines.length) {
    const localLine = localLines[localIdx];
    const remoteLine = remoteLines[remoteIdx];

    if (localLine !== remoteLine) {
      if (localLine !== undefined && remoteLine !== undefined) {
        diffs.push({localIndex: localIdx, remoteIndex: remoteIdx, type: 'change'});
      } else if (localLine !== undefined) {
        diffs.push({localIndex: localIdx, remoteIndex: -1, type: 'remove'});
      } else if (remoteLine !== undefined) {
        diffs.push({localIndex: -1, remoteIndex: remoteIdx, type: 'add'});
      }
    }

    if (localLine !== undefined) localIdx++;
    if (remoteLine !== undefined) remoteIdx++;
  }

  // Show diffs with context (2 lines before/after each change)
  let shown = 0;
  const maxDiffGroups = 3;

  for (const diff of diffs.slice(0, maxDiffGroups)) {
    if (shown > 0) console.log(''); // Separator between diff groups

    // Show context before
    const contextStart = Math.max(0, diff.localIndex - 2);
    for (let i = contextStart; i < diff.localIndex && i < localLines.length; i++) {
      console.log(`    ${String(i + 1).padStart(3)}      ${localLines[i]}`);
    }

    // Show the actual diff
    if (diff.type === 'change' || diff.type === 'remove') {
      console.log(`${redBg} -  ${String(diff.localIndex + 1).padStart(3)}      ${localLines[diff.localIndex]} ${reset}`);
    }
    if (diff.type === 'change' || diff.type === 'add') {
      console.log(`${greenBg} +  ${String(diff.remoteIndex + 1).padStart(3)}      ${remoteLines[diff.remoteIndex]} ${reset}`);
    }

    // Show context after
    const contextEnd = Math.min(localLines.length, diff.localIndex + 3);
    for (let i = diff.localIndex + 1; i < contextEnd; i++) {
      console.log(`    ${String(i + 1).padStart(3)}      ${localLines[i]}`);
    }

    shown++;
  }

  if (diffs.length > maxDiffGroups) {
    console.log(`${gray}... (${diffs.length - maxDiffGroups} more diff groups)${reset}`);
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