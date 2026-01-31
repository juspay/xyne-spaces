/**
 * Shared diff generation utility for file edit tools
 * Uses jsdiff library to generate proper git-style diffs with 3 lines of context
 */

import { createTwoFilesPatch, diffWords } from 'diff';

/**
 * Generate enhanced git-style diff with line numbers and inline highlighting
 */
export function generateGitStyleDiff(originalContent: string, newContent: string, fileName: string): string {
  if (originalContent === newContent) {
    return ''; // No changes
  }

  // Generate patch with 3 lines of context
  const patch = createTwoFilesPatch(fileName, fileName, originalContent, newContent, '', '', { context: 3 });
  
  // Process the patch to remove headers and add enhanced formatting
  return processJsDiffPatch(patch);
}

/**
 * Generate enhanced diff for MultiEdit with chunk separation
 */
export function generateMultiEditDiff(originalContent: string, newContent: string, fileName: string): string {
  if (originalContent === newContent) {
    return ''; // No changes
  }

  // Generate patch with 3 lines of context
  const patch = createTwoFilesPatch(fileName, fileName, originalContent, newContent, '', '', { context: 3 });
  
  // Process the patch to remove headers and add enhanced formatting with chunk separation
  return processJsDiffPatchWithChunks(patch);
}

/**
 * Process jsdiff patch and add line numbers with word-level highlighting
 */
function processJsDiffPatch(patch: string): string {
  const lines = patch.split('\n');
  const result: string[] = [];
  let oldLineNum = 0;
  let newLineNum = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue; // Skip undefined lines
    
    // Parse hunk headers to get starting line numbers
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
      if (match && match[1] && match[2]) {
        oldLineNum = parseInt(match[1]);
        newLineNum = parseInt(match[2]);
      }
      continue;
    }
    
    // Skip file headers
    if (line.startsWith('Index:') || 
        line.startsWith('===') || 
        line.startsWith('---') || 
        line.startsWith('+++')) {
      continue;
    }
    
    if (line === '') {
      continue; // Skip empty lines at end
    }
    
    if (line.startsWith('-')) {
      // Removed line - add word-level highlighting
      const content = line.substring(1);
      
      // Find corresponding added line for word diff
      const nextAddedLineIndex = lines.findIndex((l, idx) => idx > i && l.startsWith('+'));
      
      if (nextAddedLineIndex !== -1) {
        const nextLine = lines[nextAddedLineIndex];
        if (nextLine) {
          const newLineContent = nextLine.substring(1);
          
          const wordDiff = diffWords(content, newLineContent);
          const removedWords = wordDiff.filter(part => part.removed).map(part => part.value.trim()).filter(w => w);
          const enhanced = addInlineMarkers(content, removedWords, 'removed');
          result.push(`${oldLineNum.toString().padStart(3)} - ${enhanced}`);
        } else {
          result.push(`${oldLineNum.toString().padStart(3)} - ${content}`);
        }
      } else {
        result.push(`${oldLineNum.toString().padStart(3)} - ${content}`);
      }
      oldLineNum++;
    } else if (line.startsWith('+')) {
      // Added line - add word-level highlighting
      const content = line.substring(1);
      
      // Find corresponding removed line for word diff (look for the immediately preceding - line)
      const prevRemovedLines = lines.slice(0, i).reverse();
      const prevRemovedLineIndex = prevRemovedLines.findIndex(l => l.startsWith('-'));
      
      // If there's a corresponding removed line right before this (paired change), use old line number
      // Otherwise, this is a pure insertion, use new line number
      let displayLineNum = newLineNum;
      if (prevRemovedLineIndex !== -1) {
        const prevLine = prevRemovedLines[prevRemovedLineIndex];
        if (prevLine) {
          // Check if this is the immediately preceding line (paired change)
          const prevIndex = i - prevRemovedLineIndex - 1;
          if (prevIndex >= 0 && lines[prevIndex] === prevLine) {
            // This is a paired change, use the same line number as the removed line
            displayLineNum = oldLineNum - 1;
          }
          
          const originalLineContent = prevLine.substring(1);
          const wordDiff = diffWords(originalLineContent, content);
          const addedWords = wordDiff.filter(part => part.added).map(part => part.value.trim()).filter(w => w);
          const enhanced = addInlineMarkers(content, addedWords, 'added');
          result.push(`${displayLineNum.toString().padStart(3)} + ${enhanced}`);
        } else {
          result.push(`${newLineNum.toString().padStart(3)} + ${content}`);
        }
      } else {
        result.push(`${newLineNum.toString().padStart(3)} + ${content}`);
      }
      newLineNum++;
    } else {
      // Context line (unchanged) - line starts with space
      const content = line.startsWith(' ') ? line.substring(1) : line;
      result.push(`${oldLineNum.toString().padStart(3)}   ${content}`);
      oldLineNum++;
      newLineNum++;
    }
  }

  return result.join('\n');
}

/**
 * Process jsdiff patch with chunk separation for MultiEdit
 */
function processJsDiffPatchWithChunks(patch: string): string {
  const lines = patch.split('\n');
  const result: string[] = [];
  let oldLineNum = 0;
  let newLineNum = 0;
  let currentChunk: string[] = [];
  let inHunk = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue; // Skip undefined lines
    
    // Parse hunk headers to get starting line numbers
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
      if (match && match[1] && match[2]) {
        oldLineNum = parseInt(match[1]);
        newLineNum = parseInt(match[2]);
      }
      continue;
    }
    
    // Skip file headers
    if (line.startsWith('Index:') || 
        line.startsWith('===') || 
        line.startsWith('---') || 
        line.startsWith('+++')) {
      continue;
    }
    
    if (line === '') {
      continue; // Skip empty lines at end
    }
    
    const nextLine = i < lines.length - 1 ? lines[i + 1] : null;

    if (line.startsWith('-') || line.startsWith('+')) {
      // This is a change line
      inHunk = true;
      
      if (line.startsWith('-')) {
        const content = line.substring(1);
        
        // Find corresponding added line for word diff
        const nextAddedLineIndex = lines.findIndex((l, idx) => idx > i && l.startsWith('+'));
        
        if (nextAddedLineIndex !== -1) {
          const nextLine = lines[nextAddedLineIndex];
          if (nextLine) {
            const newLineContent = nextLine.substring(1);
            
            const wordDiff = diffWords(content, newLineContent);
            const removedWords = wordDiff.filter(part => part.removed).map(part => part.value.trim()).filter(w => w);
            const enhanced = addInlineMarkers(content, removedWords, 'removed');
            currentChunk.push(`${oldLineNum.toString().padStart(3)} - ${enhanced}`);
          } else {
            currentChunk.push(`${oldLineNum.toString().padStart(3)} - ${content}`);
          }
        } else {
          currentChunk.push(`${oldLineNum.toString().padStart(3)} - ${content}`);
        }
        oldLineNum++;
      } else {
        const content = line.substring(1);
        
        // Find corresponding removed line for word diff
        const prevRemovedLines = lines.slice(0, i).reverse();
        const prevRemovedLineIndex = prevRemovedLines.findIndex(l => l.startsWith('-'));
        
        if (prevRemovedLineIndex !== -1) {
          const prevLine = prevRemovedLines[prevRemovedLineIndex];
          if (prevLine) {
            const originalLineContent = prevLine.substring(1);
            
            const wordDiff = diffWords(originalLineContent, content);
            const addedWords = wordDiff.filter(part => part.added).map(part => part.value.trim()).filter(w => w);
            const enhanced = addInlineMarkers(content, addedWords, 'added');
            currentChunk.push(`${newLineNum.toString().padStart(3)} + ${enhanced}`);
          } else {
            currentChunk.push(`${newLineNum.toString().padStart(3)} + ${content}`);
          }
        } else {
          currentChunk.push(`${newLineNum.toString().padStart(3)} + ${content}`);
        }
        newLineNum++;
      }
    } else {
      // Context line (unchanged) - line starts with space
      const content = line.startsWith(' ') ? line.substring(1) : line;
      currentChunk.push(`${oldLineNum.toString().padStart(3)}   ${content}`);
      oldLineNum++;
      newLineNum++;
      
      // Check if this ends a hunk and we should start a new chunk
      if (inHunk && nextLine && !nextLine.startsWith('-') && !nextLine.startsWith('+') && nextLine.trim() !== '') {
        // Look ahead to see if there are more changes coming
        let hasMoreChanges = false;
        for (let j = i + 1; j < lines.length; j++) {
          const lookAheadLine = lines[j];
          if (lookAheadLine && (lookAheadLine.startsWith('-') || lookAheadLine.startsWith('+'))) {
            hasMoreChanges = true;
            break;
          }
          if (j > i + 6) break; // Don't look too far ahead
        }
        
        if (hasMoreChanges) {
          // More changes coming, add chunk separator
          result.push(...currentChunk);
          result.push('...'); // Chunk separator
          currentChunk = [];
          inHunk = false;
        }
      }
    }
  }

  // Add any remaining chunk
  if (currentChunk.length > 0) {
    result.push(...currentChunk);
  }

  return result.join('\n');
}


/**
 * Add inline highlighting markers for markdown rendering
 */
function addInlineMarkers(content: string, changes: string[], type: 'removed' | 'added'): string {
  let enhanced = content;

  // Sort changes by length (longest first) to avoid partial replacements
  const sortedChanges = changes.sort((a, b) => b.length - a.length);

  for (const change of sortedChanges) {
    if (change && enhanced.includes(change)) {
      // Use markdown highlighting for terminal rendering
      const marker = type === 'removed' ? '~~' : '**'; // strikethrough vs bold
      const highlighted = `${marker}${change}${marker}`;
      
      enhanced = enhanced.replace(
        new RegExp(escapeRegex(change), 'g'),
        highlighted
      );
    }
  }

  return enhanced;
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}