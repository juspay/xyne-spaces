/**
 * Suggestion generator for Read tool to help users when content is truncated
 */

export interface SuggestionContext {
  readonly totalLines: number;
  readonly linesRead: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly truncated: boolean;
  readonly offset?: number;
  readonly limit?: number;
  readonly filePath: string;
}

/**
 * Generate helpful suggestions for reading more content
 */
export function generateReadSuggestions(context: SuggestionContext): string[] {
  const suggestions: string[] = [];
  
  const {
    totalLines,
    linesRead,
    startLine,
    endLine,
    truncated,
    offset = 1,
    limit = 2000
  } = context;

  // Case 1: Lines were truncated due to length limits
  if (truncated) {
    suggestions.push(
      'Some lines were truncated due to length (>2000 chars). ' +
      'Line content is still readable but may be incomplete for very long lines.'
    );
  }

  // Case 2: Not all lines were read due to limit
  if (linesRead < totalLines) {
    const remainingLines = totalLines - endLine;
    
    if (remainingLines > 0) {
      // Suggest reading next chunk
      const nextOffset = endLine + 1;
      const suggestedLimit = Math.min(limit, remainingLines);
      
      suggestions.push(
        `File has ${remainingLines} more lines after line ${endLine}. ` +
        `To read the next chunk, use the Read tool again with: offset: ${nextOffset}, limit: ${suggestedLimit}`
      );
    }

    // Suggest reading from beginning if we started with an offset
    if (startLine > 1) {
      suggestions.push(
        `To read from the beginning, use the Read tool again with: offset: 1, limit: ${limit}`
      );
    }

    // Suggest reading the end of the file
    if (totalLines > limit && endLine < totalLines) {
      const tailOffset = Math.max(1, totalLines - limit + 1);
      suggestions.push(
        `To read the last ${Math.min(limit, totalLines)} lines, use the Read tool again with: offset: ${tailOffset}, limit: ${limit}`
      );
    }

    // Suggest specific ranges for large files
    if (totalLines > 5000) {
      suggestions.push(
        `Large file (${totalLines} lines). Consider reading specific sections using offset/limit parameters, or use Grep tool to search for specific content.`
      );
    }
  }

  // Case 3: Successfully read entire file
  if (linesRead === totalLines && !truncated && totalLines > 0) {
    suggestions.push('Successfully read entire file.');
  }

  // Case 4: File is empty
  if (totalLines === 0) {
    suggestions.push('File is empty - no content to read.');
  }

  // Case 5: Reading a specific range
  if (offset > 1 && endLine < totalLines) {
    suggestions.push(
      `Currently reading lines ${startLine}-${endLine} of ${totalLines}. ` +
      `Use different offset and limit values to read other sections of the file.`
    );
  }

  return suggestions;
}

/**
 * Generate suggestion for continuing to read from where we left off
 */
export function generateContinuationSuggestion(
  endLine: number,
  totalLines: number,
  limit: number = 2000
): string | null {
  if (endLine >= totalLines) {
    return null; // Already at end
  }

  const remainingLines = totalLines - endLine;
  const nextOffset = endLine + 1;
  const suggestedLimit = Math.min(limit, remainingLines);

  return `To continue reading, use the Read tool again with: offset: ${nextOffset}, limit: ${suggestedLimit}`;
}

/**
 * Generate suggestion for reading around a specific line
 */
export function generateContextSuggestion(
  targetLine: number,
  totalLines: number,
  contextLines: number = 50
): string {
  const halfContext = Math.floor(contextLines / 2);
  const startOffset = Math.max(1, targetLine - halfContext);
  const endOffset = Math.min(totalLines, targetLine + halfContext);
  const actualLimit = endOffset - startOffset + 1;

  return `To read around line ${targetLine}, use the Read tool again with: offset: ${startOffset}, limit: ${actualLimit}`;
}