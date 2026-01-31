/**
 * Content processing utilities for file write operations
 */

/**
 * EOF marker that should be stripped from content
 */
const EOF_MARKER = '<<<EOF_FILE>>>';

/**
 * Strip EOF markers from content
 */
export function stripEOFMarkers(content: string): string {
  return content.replace(new RegExp(EOF_MARKER, 'g'), '');
}

/**
 * Process content before writing
 */
export function processContent(content: string, stripEOF: boolean = true): string {
  let processed = content;
  
  if (stripEOF) {
    processed = stripEOFMarkers(processed);
  }
  
  return processed;
}

/**
 * Generate diff summary between original and new content
 */
export interface DiffSummary {
  linesAdded: number;
  linesRemoved: number;
  linesModified: number;
  hasChanges: boolean;
}

export function generateDiffSummary(originalContent: string, newContent: string): DiffSummary {
  const originalLines = originalContent.split('\n');
  const newLines = newContent.split('\n');
  
  let linesAdded = 0;
  let linesRemoved = 0;
  let linesModified = 0;
  
  // Simple diff algorithm - can be enhanced with proper LCS diff later
  const minLines = Math.min(originalLines.length, newLines.length);
  
  // Count modified lines (lines that exist in both but are different)
  for (let i = 0; i < minLines; i++) {
    if (originalLines[i] !== newLines[i]) {
      linesModified++;
    }
  }
  
  // Count added/removed lines
  if (newLines.length > originalLines.length) {
    linesAdded = newLines.length - originalLines.length;
  } else if (originalLines.length > newLines.length) {
    linesRemoved = originalLines.length - newLines.length;
  }
  
  // Special case: if original is empty, all lines are added
  if (originalLines.length === 1 && originalLines[0] === '' && newLines.length > 0) {
    linesAdded = newLines.length;
    linesModified = 0;
  }
  
  // Special case: if new content is empty, all lines are removed
  if (newLines.length === 1 && newLines[0] === '' && originalLines.length > 0) {
    linesRemoved = originalLines.length;
    linesModified = 0;
  }
  
  const hasChanges = linesAdded > 0 || linesRemoved > 0 || linesModified > 0;
  
  return {
    linesAdded,
    linesRemoved,
    linesModified,
    hasChanges
  };
}

/**
 * Generate helpful suggestions based on the write operation
 */
export function generateWriteSuggestions(
  filePath: string,
  wasCreated: boolean,
  hasChanges: boolean,
  bytesWritten: number
): string[] {
  const suggestions: string[] = [];
  
  if (wasCreated) {
    suggestions.push(`New file created: ${filePath}`);
  }
  
  if (hasChanges) {
    suggestions.push(`File content modified: ${bytesWritten} bytes written`);
  } else {
    suggestions.push('No changes detected - file content is identical');
  }
  
  // File type specific suggestions
  const extension = filePath.split('.').pop()?.toLowerCase();
  
  switch (extension) {
    case 'ts':
    case 'js':
      suggestions.push('Consider running TypeScript compiler or linter to check syntax');
      break;
    case 'json':
      suggestions.push('Consider validating JSON syntax');
      break;
    case 'md':
      suggestions.push('Consider checking Markdown formatting');
      break;
    case 'yaml':
    case 'yml':
      suggestions.push('Consider validating YAML syntax');
      break;
    default:
      if (bytesWritten > 1024 * 1024) { // > 1MB
        suggestions.push('Large file written - consider checking file size and performance implications');
      }
  }
  
  return suggestions;
}