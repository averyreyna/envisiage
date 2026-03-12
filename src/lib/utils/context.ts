import type { SelectionRange } from '$lib/stores/editor';

const LINES_ABOVE = 20;
const LINES_BELOW = 20;

export interface LineRange {
  startLine: number;
  endLine: number;
}

export interface SmartContext {
  contextAbove: string;
  contextBelow: string;
  enclosingScope: string;
  enclosingScopeRange: LineRange | null;
  contextWindowRange: LineRange;
}

function findEnclosingScopeStart(lines: string[], selectionStartLine: number): number | null {
  const start = Math.max(0, selectionStartLine - 1);
  for (let i = start; i >= 0; i--) {
    const line = lines[i];
    const trimmed = line.trim();
    if (/^\s*(async\s+)?(function|class)\s+\w/.test(line)) return i + 1;
    if (/^\s*def\s+\w/.test(line)) return i + 1;
    if (/\=\>\s*[\{\s]*$/.test(line) || /\=\>\s*$/.test(line)) return i + 1;
    if (i < start && /^\s+\w+\s*\([^)]*\)\s*[\{\:]?\s*$/.test(trimmed)) return i + 1;
  }
  for (let i = start; i >= 0; i--) {
    if (/\{\s*$/.test(lines[i]) || /^\s*\{\s*$/.test(lines[i].trim())) return i + 1;
  }
  return null;
}

function findBlockEnd(lines: string[], scopeStartLine: number): number | null {
  let depth = 0;
  const startIdx = scopeStartLine - 1;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    const open = (line.match(/\{/g) || []).length;
    const close = (line.match(/\}/g) || []).length;
    depth += open - close;
    if (depth === 0 && i > startIdx) return i + 1;
  }
  return lines.length;
}

function getEnclosingScopeLines(
  lines: string[],
  selectionStartLine: number,
  selectionEndLine: number
): { startLine: number; endLine: number } | null {
  const scopeStart = findEnclosingScopeStart(lines, selectionStartLine);
  if (!scopeStart) return null;

  const lineCount = lines.length;
  let endLine: number;

  const firstLine = lines[scopeStart - 1];
  const isPython = /\bdef\s+\w/.test(firstLine) || /^\s*class\s+\w/.test(firstLine);
  if (isPython) {
    const baseIndent = (firstLine.match(/^\s*/) || [''])[0].length;
    endLine = selectionEndLine;
    for (let idx = selectionEndLine; idx < lineCount; idx++) {
      const line = lines[idx];
      if (line.trim() === '') continue;
      const indent = (line.match(/^\s*/) || [''])[0].length;
      if (indent <= baseIndent && idx > scopeStart - 1) {
        endLine = idx;
        break;
      }
      endLine = idx + 1;
    }
  } else {
    const blockEnd = findBlockEnd(lines, scopeStart);
    endLine = blockEnd ?? Math.min(selectionEndLine + 30, lineCount);
  }

  return { startLine: scopeStart, endLine };
}

// enclosing scope plus fixed lines above/below for the explain api
export function getSmartContext(
  code: string,
  selectionRange: SelectionRange
): SmartContext {
  const lines = code.split('\n');
  const lineCount = lines.length;
  const { startLine: selStart, endLine: selEnd } = selectionRange;

  const contextAboveFrom = Math.max(1, selStart - LINES_ABOVE);
  const contextAboveTo = selStart - 1;
  const contextBelowFrom = Math.min(lineCount, selEnd + 1);
  const contextBelowTo = Math.min(lineCount, selEnd + LINES_BELOW);

  const contextAbove =
    contextAboveTo >= contextAboveFrom
      ? lines.slice(contextAboveFrom - 1, contextAboveTo).join('\n')
      : '';
  const contextBelow =
    contextBelowFrom <= contextBelowTo
      ? lines.slice(contextBelowFrom - 1, contextBelowTo).join('\n')
      : '';

  const scopeRange = getEnclosingScopeLines(lines, selStart, selEnd);
  let enclosingScope = '';
  if (scopeRange) {
    enclosingScope = lines.slice(scopeRange.startLine - 1, scopeRange.endLine).join('\n');
  }

  return {
    contextAbove,
    contextBelow,
    enclosingScope,
    enclosingScopeRange: scopeRange,
    contextWindowRange: {
      startLine: contextAboveFrom,
      endLine: contextBelowTo
    }
  };
}
