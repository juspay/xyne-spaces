/**
 * Line processing utilities for ReadTool
 */

export interface LineProcessingOptions {
  readonly offset?: number;
  readonly limit?: number;
  readonly maxLineLength?: number;
}

export interface LineProcessingResult {
  readonly content: string;
  readonly totalLines: number;
  readonly linesRead: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly truncated: boolean;
  readonly isEmpty: boolean;
}

/**
 * Process file content into lines with cat -n style formatting
 */
export function processLines(
  content: string,
  options: LineProcessingOptions = {}
): LineProcessingResult {
  const {
    offset = 1,
    limit = 2000,
    maxLineLength = 2000
  } = options;

  // Handle empty content
  if (!content || content.length === 0) {
    return {
      content: '',
      totalLines: 0,
      linesRead: 0,
      startLine: 1,
      endLine: 0,
      truncated: false,
      isEmpty: true
    };
  }

  // Split content into lines
  const allLines = content.split(/\r?\n/);
  const totalLines = allLines.length;

  // Calculate which lines to include
  const startIndex = Math.max(0, offset - 1); // Convert to 0-based
  const endIndex = Math.min(allLines.length, startIndex + limit);
  const selectedLines = allLines.slice(startIndex, endIndex);

  // Process each line with truncation and line numbers
  let truncated = false;
  const processedLines = selectedLines.map((line, index) => {
    const lineNumber = startIndex + index + 1;
    let processedLine = line;

    // Truncate line if too long
    if (line.length > maxLineLength) {
      processedLine = line.substring(0, maxLineLength);
      truncated = true;
    }

    // Format with line number (cat -n style: spaces + line number + tab + content)
    return formatLineNumber(lineNumber) + processedLine;
  });

  const formattedContent = processedLines.join('\n');
  const actualStartLine = selectedLines.length > 0 ? offset : 1;
  const actualEndLine = selectedLines.length > 0 ? startIndex + selectedLines.length : 0;

  return {
    content: formattedContent,
    totalLines,
    linesRead: selectedLines.length,
    startLine: actualStartLine,
    endLine: actualEndLine,
    truncated,
    isEmpty: false
  };
}

/**
 * Format line number in cat -n style
 * Uses right-aligned line numbers with consistent spacing
 */
function formatLineNumber(lineNumber: number): string {
  // cat -n format: 6 spaces + right-aligned line number + tab
  const lineStr = lineNumber.toString();
  const padding = 6 - lineStr.length;
  const spaces = padding > 0 ? ' '.repeat(padding) : '';
  return `${spaces}${lineStr}\t`;
}

/**
 * Count total lines in content efficiently
 */
export function countLines(content: string): number {
  if (!content || content.length === 0) {
    return 0;
  }
  
  // Count newlines + 1 (unless content ends with newline)
  const newlineCount = (content.match(/\n/g) || []).length;
  return content.endsWith('\n') ? newlineCount : newlineCount + 1;
}

/**
 * Validate offset and limit parameters
 */
export function validateLineParameters(
  offset?: number,
  limit?: number,
  totalLines?: number
): { offset: number; limit: number } {
  const validOffset = Math.max(1, offset || 1);
  const validLimit = Math.min(2000, Math.max(1, limit || 2000));

  // If we know total lines, adjust limit to not exceed available lines
  if (totalLines !== undefined && validOffset <= totalLines) {
    const maxPossibleLimit = totalLines - validOffset + 1;
    return {
      offset: validOffset,
      limit: Math.min(validLimit, maxPossibleLimit)
    };
  }

  return {
    offset: validOffset,
    limit: validLimit
  };
}