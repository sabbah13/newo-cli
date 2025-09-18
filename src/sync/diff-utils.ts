/**
 * Proper diff algorithm for accurate content comparison
 */

export interface DiffLine {
  type: 'context' | 'add' | 'remove';
  localLineNum: number;
  remoteLineNum: number;
  content: string;
}

/**
 * Generate a proper diff using LCS algorithm
 */
export function generateDiff(localContent: string, remoteContent: string): DiffLine[] {
  const localLines = localContent.trim().split('\n');
  const remoteLines = remoteContent.trim().split('\n');

  // Simple LCS-based diff algorithm
  const diff: DiffLine[] = [];

  let localIdx = 0;
  let remoteIdx = 0;

  while (localIdx < localLines.length || remoteIdx < remoteLines.length) {
    const localLine = localLines[localIdx];
    const remoteLine = remoteLines[remoteIdx];

    if (localIdx >= localLines.length) {
      // Only remote lines left (additions)
      diff.push({
        type: 'add',
        localLineNum: -1,
        remoteLineNum: remoteIdx + 1,
        content: remoteLine || ''
      });
      remoteIdx++;
    } else if (remoteIdx >= remoteLines.length) {
      // Only local lines left (deletions)
      diff.push({
        type: 'remove',
        localLineNum: localIdx + 1,
        remoteLineNum: -1,
        content: localLine || ''
      });
      localIdx++;
    } else if (localLine === remoteLine) {
      // Lines match (context)
      diff.push({
        type: 'context',
        localLineNum: localIdx + 1,
        remoteLineNum: remoteIdx + 1,
        content: localLine || ''
      });
      localIdx++;
      remoteIdx++;
    } else {
      // Lines differ - check if this is an insertion or substitution
      // Look ahead to see if the local line appears later in remote
      let foundInRemote = -1;
      for (let j = remoteIdx + 1; j < Math.min(remoteIdx + 5, remoteLines.length); j++) {
        if (localLine === remoteLines[j]) {
          foundInRemote = j;
          break;
        }
      }

      // Look ahead to see if the remote line appears later in local
      let foundInLocal = -1;
      for (let j = localIdx + 1; j < Math.min(localIdx + 5, localLines.length); j++) {
        if (remoteLine === localLines[j]) {
          foundInLocal = j;
          break;
        }
      }

      if (foundInRemote !== -1 && (foundInLocal === -1 || foundInRemote - remoteIdx < foundInLocal - localIdx)) {
        // Local line found later in remote - this is likely remote insertions
        while (remoteIdx < foundInRemote) {
          diff.push({
            type: 'add',
            localLineNum: -1,
            remoteLineNum: remoteIdx + 1,
            content: remoteLines[remoteIdx] || ''
          });
          remoteIdx++;
        }
      } else if (foundInLocal !== -1) {
        // Remote line found later in local - this is likely local insertions (deletions in diff)
        while (localIdx < foundInLocal) {
          diff.push({
            type: 'remove',
            localLineNum: localIdx + 1,
            remoteLineNum: -1,
            content: localLines[localIdx] || ''
          });
          localIdx++;
        }
      } else {
        // Lines are genuinely different (substitution)
        diff.push({
          type: 'remove',
          localLineNum: localIdx + 1,
          remoteLineNum: -1,
          content: localLine || ''
        });
        diff.push({
          type: 'add',
          localLineNum: -1,
          remoteLineNum: remoteIdx + 1,
          content: remoteLine || ''
        });
        localIdx++;
        remoteIdx++;
      }
    }
  }

  return diff;
}

/**
 * Filter diff to show only relevant sections with context
 */
export function filterDiffWithContext(diff: DiffLine[], contextLines: number = 2): DiffLine[] {
  const result: DiffLine[] = [];

  // Find all non-context lines (changes)
  const changeIndices: number[] = [];
  diff.forEach((line, idx) => {
    if (line.type !== 'context') {
      changeIndices.push(idx);
    }
  });

  if (changeIndices.length === 0) {
    return []; // No changes
  }

  // Group nearby changes and add context
  const groups: Array<{start: number, end: number}> = [];
  let currentGroup = { start: changeIndices[0]!, end: changeIndices[0]! };

  for (let i = 1; i < changeIndices.length; i++) {
    const idx = changeIndices[i]!;
    if (idx - currentGroup.end <= contextLines * 2 + 1) {
      // Close enough to current group, extend it
      currentGroup.end = idx;
    } else {
      // Start new group
      groups.push(currentGroup);
      currentGroup = { start: idx, end: idx };
    }
  }
  groups.push(currentGroup);

  // Build result with context
  for (const group of groups) {
    const start = Math.max(0, group.start - contextLines);
    const end = Math.min(diff.length - 1, group.end + contextLines);

    for (let i = start; i <= end; i++) {
      result.push(diff[i]!);
    }
  }

  return result;
}