/**
 * YAML Post-Processor - Patches js-yaml output to match pyyaml's formatting
 *
 * Replicates pyyaml's Emitter wrapping behavior:
 * - Double-quoted: breaks with `\` when column + pending > best_width (80) at space
 * - Plain scalar: breaks at space when column > best_width
 * - Continuation indent: parent indent + best_indent (usually +2)
 * - Single-quote preference for strings with brackets
 */

const BEST_WIDTH = 80;

/**
 * Patch full YAML document output to match pyyaml formatting
 */
export function patchYamlToPyyaml(yamlText: string): string {
  const lines = yamlText.split('\n');
  const result: string[] = [];
  let inBlockScalar = false;
  let blockIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Track block scalar context (|- or >- or | or >)
    if (inBlockScalar) {
      const currentIndent = line.length - line.trimStart().length;
      if (line.trim() === '' || currentIndent > blockIndent) {
        result.push(line);
        continue;
      }
      inBlockScalar = false;
    }

    // Detect start of block scalar
    if (/^\s*[\w-]+:\s+[|>]-?\s*$/.test(line)) {
      const keyIndent = line.length - line.trimStart().length;
      inBlockScalar = true;
      blockIndent = keyIndent;
      result.push(line);
      continue;
    }

    result.push(...patchLine(line));
  }

  return result.join('\n');
}

// Keys that must NEVER be wrapped
const NO_WRAP_KEYS = new Set([
  'prompt_script', 'idn', 'runner_type',
  'model_idn', 'provider_idn', 'skill_idn', 'state_idn',
  'integration_idn', 'connector_idn', 'interrupt_mode',
  'skill_selector', 'name', 'scope', 'agent_id',
  'default_runner_type', 'default_provider_idn', 'default_model_idn',
  'publication_type', 'is_hidden', 'is_auto_update_enabled',
  'group', 'registry', 'registry_item_idn', 'version',
]);

function patchLine(line: string): string[] {
  if (line.trim() === '' || line.trim().startsWith('#')) {
    return [line];
  }

  const kvMatch = line.match(/^(\s*(?:-\s+)?)([\w-]+):\s+(.+)$/);
  if (!kvMatch) {
    return [line];
  }

  const prefix = kvMatch[1]!;
  const key = kvMatch[2]!;
  const value = kvMatch[3]!;

  // Single-quote fix for JSON-like values (before anything else)
  const sqFix = tryConvertToSingleQuote(value);
  const effectiveValue = sqFix ?? value;
  const effectiveLine = sqFix !== null ? `${prefix}${key}: ${sqFix}` : line;

  if (NO_WRAP_KEYS.has(key)) {
    return [effectiveLine];
  }

  // Only wrap if line exceeds BEST_WIDTH
  if (effectiveLine.length <= BEST_WIDTH) {
    return [effectiveLine];
  }

  const keyPart = `${prefix}${key}: `;
  // pyyaml continuation indent = current mapping indent + best_indent
  // For "  description: ..." indent is 2, continuation = 2 + 2 = 4 spaces
  const keyIndent = prefix.replace(/-\s+$/, '').length;
  const contIndent = ' '.repeat(keyIndent + 2);

  if (effectiveValue.startsWith('"') && effectiveValue.endsWith('"')) {
    return wrapDoubleQuoted(keyPart, effectiveValue, contIndent);
  }

  if (effectiveValue.startsWith("'") && effectiveValue.endsWith("'")) {
    return [effectiveLine]; // Single-quoted: don't wrap
  }

  return wrapPlainScalar(keyPart, effectiveValue, contIndent);
}

/**
 * Try to convert double-quoted string with escaped chars to single-quoted
 */
function tryConvertToSingleQuote(value: string): string | null {
  if (!value.startsWith('"') || !value.endsWith('"')) return null;

  const inner = value.slice(1, -1);
  if (!inner.includes('\\"')) return null;
  if (!inner.includes('[') && !inner.includes('{')) return null;

  const unescaped = inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\');

  if (unescaped.includes("'")) {
    return `'${unescaped.replace(/'/g, "''")}'`;
  }
  return `'${unescaped}'`;
}

/**
 * Wrap double-quoted scalar matching pyyaml's write_double_quoted algorithm:
 * - Track column from 0
 * - At each space, check if column + pending > best_width
 * - If yes, emit text + `\`, newline, indent, `\ ` (escaped space for continuation)
 */
function wrapDoubleQuoted(keyPart: string, quotedValue: string, contIndent: string): string[] {
  const inner = quotedValue.slice(1, -1);
  const result: string[] = [];

  let column = keyPart.length + 1; // keyPart + opening "
  let lineStart = 0;
  let lastSpace = -1;

  for (let i = 0; i < inner.length; i++) {
    column++;
    if (inner[i] === ' ') {
      lastSpace = i;
    }

    // pyyaml condition: column + remaining_in_word > best_width, at a space or start >= end
    if (column > BEST_WIDTH && lastSpace > lineStart) {
      // Break at lastSpace
      const chunk = inner.slice(lineStart, lastSpace);
      if (result.length === 0) {
        result.push(`${keyPart}"${chunk}\\`);
      } else {
        result.push(`${contIndent}\\ ${chunk}\\`);
      }
      lineStart = lastSpace + 1; // skip the space
      column = contIndent.length + 2 + (i - lastSpace); // contIndent + "\ " + chars after space
      lastSpace = -1;
    }
  }

  // Remaining text
  const remaining = inner.slice(lineStart);
  if (result.length === 0) {
    result.push(`${keyPart}"${remaining}"`);
  } else {
    result.push(`${contIndent}\\ ${remaining}"`);
  }

  return result;
}

/**
 * Wrap plain scalar matching pyyaml's write_plain algorithm:
 * - At each space, if column > best_width, break
 * - Continuation is just indented text (no backslash)
 */
function wrapPlainScalar(keyPart: string, value: string, contIndent: string): string[] {
  const result: string[] = [];
  let column = keyPart.length;
  let lineStart = 0;
  let lastSpace = -1;

  for (let i = 0; i < value.length; i++) {
    column++;
    if (value[i] === ' ') {
      // pyyaml breaks at single space when column > best_width
      if (column > BEST_WIDTH && lastSpace >= lineStart) {
        const chunk = value.slice(lineStart, i);
        if (result.length === 0) {
          result.push(`${keyPart}${chunk}`);
        } else {
          result.push(`${contIndent}${chunk}`);
        }
        lineStart = i + 1; // skip the space
        column = contIndent.length;
      }
      lastSpace = i;
    }
  }

  // Remaining
  const remaining = value.slice(lineStart);
  if (result.length === 0) {
    result.push(`${keyPart}${remaining}`);
  } else {
    result.push(`${contIndent}${remaining}`);
  }

  return result;
}
