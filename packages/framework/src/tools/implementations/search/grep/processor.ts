import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import type { MatchResult, SearchStats, GrepToolInput } from './schemas.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Search processing utilities for grep operations
 */

/**
 * Execute ripgrep search with specified options
 */
export async function executeRipgrep(
  pattern: string,
  searchPath: string,
  options: {
    glob?: string;
    type?: string;
    multiline?: boolean;
    caseInsensitive?: boolean;
    contextBefore?: number;
    contextAfter?: number;
    contextAround?: number;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    output_mode: 'content' | 'files_with_matches' | 'count';
    headLimit?: number;
  }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const args = buildRipgrepArgs(pattern, searchPath, options);
    
    logger.debug('Executing ripgrep command', {
      command: 'rg',
      args: args.slice(0, 10) // Log first 10 args to avoid huge logs
    });
    
    // console.log('Debug - Full ripgrep command:', ['rg', ...args].join(' '));

    const child = spawn('rg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env }
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code: number | null) => {
      resolve({
        stdout,
        stderr,
        exitCode: code || 0
      });
    });

    child.on('error', (error: Error) => {
      logger.error('Ripgrep execution failed', error);
      reject(error);
    });

    // Set timeout to prevent hanging
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Ripgrep execution timed out'));
    }, 30000); // 30 second timeout

    child.on('close', () => {
      clearTimeout(timeout);
    });
  });
}

/**
 * Build ripgrep command arguments
 */
function buildRipgrepArgs(
  pattern: string,
  searchPath: string,
  options: {
    glob?: string;
    type?: string;
    multiline?: boolean;
    caseInsensitive?: boolean;
    contextBefore?: number;
    contextAfter?: number;
    contextAround?: number;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    output_mode: 'content' | 'files_with_matches' | 'count';
    headLimit?: number;
  }
): string[] {
  const args: string[] = [];

  // Output mode flags
  switch (options.output_mode) {
    case 'files_with_matches':
      args.push('--files-with-matches');
      break;
    case 'count':
      args.push('--count');
      break;
    // 'content' mode is default, no flag needed
  }

  // Search behavior flags
  if (options.caseInsensitive) {
    args.push('--ignore-case');
  }

  if (options.multiline) {
    args.push('--multiline', '--multiline-dotall');
  }

  // Context flags
  if (options.contextAround !== undefined) {
    args.push('--context', options.contextAround.toString());
  } else {
    if (options.contextBefore !== undefined) {
      args.push('--before-context', options.contextBefore.toString());
    }
    if (options.contextAfter !== undefined) {
      args.push('--after-context', options.contextAfter.toString());
    }
  }

  // Line numbers - always include for content mode
  if (options.output_mode === 'content') {
    args.push('--line-number');
    args.push('--heading'); // Force filename headers even for single files
  }

  // File filtering
  if (options.type) {
    // Special handling for 'js' type to include both JavaScript and TypeScript
    if (options.type === 'js') {
      args.push('--type', 'js');
      args.push('--type', 'typescript');
    } else {
      args.push('--type', options.type);
    }
  }

  if (options.glob) {
    args.push('--glob', options.glob);
  }

  // Head limit (applied via max-count for content mode)
  if (options.headLimit && options.output_mode === 'content') {
    args.push('--max-count', options.headLimit.toString());
  }

  // Performance and output options (removed conflicting --no-heading and --no-filename)
  
  // Pattern and path
  args.push(pattern, searchPath);

  return args;
}

/**
 * Search for pattern in a single file using ripgrep
 */
export async function searchInFile(
  filePath: string,
  pattern: string,
  options: {
    multiline?: boolean;
    caseInsensitive?: boolean;
    contextBefore?: number;
    contextAfter?: number;
    contextAround?: number;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    output_mode: 'content' | 'files_with_matches' | 'count';
  }
): Promise<{ matches: MatchResult[]; matchCount: number }> {
  try {
    const result = await executeRipgrep(pattern, filePath, options);
    return parseRipgrepOutput(result.stdout, result.stderr, result.exitCode, options, filePath);
  } catch (error) {
    logger.warn('Error executing ripgrep for file search', {
      filePath,
      error: error instanceof Error ? error.message : String(error)
    });
    return { matches: [], matchCount: 0 };
  }
}

/**
 * Parse ripgrep output into MatchResult format
 */
export function parseRipgrepOutput(
  stdout: string,
  stderr: string,
  exitCode: number,
  options: {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    output_mode: 'content' | 'files_with_matches' | 'count';
  },
  searchedFilePath?: string
): { matches: MatchResult[]; matchCount: number } {
  const matches: MatchResult[] = [];
  let matchCount = 0;

  // Handle ripgrep exit codes
  if (exitCode === 1) {
    // No matches found - this is normal
    return { matches: [], matchCount: 0 };
  } else if (exitCode === 2) {
    // Error occurred
    throw new Error(`Ripgrep error: ${stderr || 'Unknown error'}`);
  } else if (exitCode !== 0) {
    // Other non-zero exit codes
    throw new Error(`Ripgrep exited with code ${exitCode}: ${stderr}`);
  }

  if (!stdout.trim()) {
    return { matches: [], matchCount: 0 };
  }

  const lines = stdout.trim().split('\n');
  
  switch (options.output_mode) {
    case 'content': {
      // Parse content mode output - ripgrep returns all lines including context
      // When searching multiple files, ripgrep groups by file with filename headers
      let currentFile = searchedFilePath || '';
      
      for (const line of lines) {
        // Skip empty lines
        if (!line.trim()) {
          continue;
        }
        
        // Check if this line is a filename header (no line number, just a path)
        const hasColon = line.includes(':');
        const isSeparator = line.trim() === '--';
        
        // Check if this looks like a context line (number-content format)
        const contextLineMatch = /^\d+-/.test(line.trim());
        
        if (!hasColon && !contextLineMatch && !isSeparator) {
          // This is a filename header
          currentFile = line.trim();
          continue;
        }
        
        const parsed = parseRipgrepLine(line);
        if (parsed) {
          matches.push({
            filePath: parsed.filePath || currentFile,
            lineNumber: parsed.lineNumber,
            content: parsed.content
          });
          matchCount++;
        }
      }
      break;
    }

    case 'files_with_matches': {
      // For files_with_matches mode, each line is a file path (with filenames enabled)
      for (const line of lines) {
        const filePath = line.trim();
        if (filePath) {
          // Use searchedFilePath if provided (e.g., for searchInContent), otherwise use ripgrep output
          matches.push({ filePath: searchedFilePath || filePath });
          matchCount++;
        }
      }
      break;
    }

    case 'count': {
      // For count mode, each line shows "filename:count"
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          const colonIndex = trimmed.lastIndexOf(':');
          if (colonIndex > 0) {
            const filePath = trimmed.substring(0, colonIndex);
            const count = parseInt(trimmed.substring(colonIndex + 1), 10);
            if (!isNaN(count)) {
              matches.push({ filePath, matchCount: count });
              matchCount += count;
            }
          }
        }
      }
      break;
    }

  }

  return { matches, matchCount };
}


/**
 * Parse a single line from ripgrep output (match or context)
 */
function parseRipgrepLine(
  line: string
): { content: string; lineNumber?: number; isMatch: boolean; filePath?: string } | null {
  if (!line.trim()) {
    return null;
  }

  // Skip group separator lines
  if (line.trim() === '--') {
    return null;
  }

  let lineNumber: number | undefined;
  let content: string;
  let isMatch = false;
  let filePath: string | undefined;

  // Look for filename:linenum:content or filename:linenum-content format
  const colonIndices = [];
  let searchIndex = 0;
  while ((searchIndex = line.indexOf(':', searchIndex)) !== -1) {
    colonIndices.push(searchIndex);
    searchIndex++;
  }
  
  const dashIndex = line.indexOf('-');
  
  if (colonIndices.length >= 2) {
    // Format: filename:linenum:content or filename:linenum-content
    const firstColon = colonIndices[0]!;
    const secondColon = colonIndices[1]!;
    
    filePath = line.substring(0, firstColon);
    const lineNumStr = line.substring(firstColon + 1, secondColon);
    const potentialLineNumber = parseInt(lineNumStr, 10);
    
    if (!isNaN(potentialLineNumber)) {
      lineNumber = potentialLineNumber;
      content = line.substring(secondColon + 1);
      isMatch = true;
    } else {
      content = line;
    }
  } else if (colonIndices.length === 1 && dashIndex > colonIndices[0]!) {
    // Format: filename:linenum-content (context line)
    const colonIndex = colonIndices[0]!;
    filePath = line.substring(0, colonIndex);
    const lineNumStr = line.substring(colonIndex + 1, dashIndex);
    const potentialLineNumber = parseInt(lineNumStr, 10);
    
    if (!isNaN(potentialLineNumber)) {
      lineNumber = potentialLineNumber;
      content = line.substring(dashIndex + 1);
      isMatch = false;
    } else {
      content = line;
    }
  } else if (colonIndices.length === 1) {
    // Old format: linenum:content (no filename)
    const colonIndex = colonIndices[0]!;
    const lineNumStr = line.substring(0, colonIndex);
    const potentialLineNumber = parseInt(lineNumStr, 10);
    
    if (!isNaN(potentialLineNumber)) {
      lineNumber = potentialLineNumber;
      content = line.substring(colonIndex + 1);
      isMatch = true;
    } else {
      content = line;
    }
  } else if (dashIndex > 0) {
    // Old format: linenum-content (no filename)
    const lineNumStr = line.substring(0, dashIndex);
    const potentialLineNumber = parseInt(lineNumStr, 10);
    
    if (!isNaN(potentialLineNumber)) {
      lineNumber = potentialLineNumber;
      content = line.substring(dashIndex + 1);
      isMatch = false;
    } else {
      content = line;
    }
  } else {
    // No line number, treat as content
    content = line;
    isMatch = true; // Assume it's a match if no context separator
  }

  const result: { content: string; lineNumber?: number; isMatch: boolean; filePath?: string } = {
    content,
    isMatch
  };
  
  if (lineNumber !== undefined) {
    result.lineNumber = lineNumber;
  }
  
  if (filePath !== undefined) {
    result.filePath = filePath;
  }
  
  return result;
}


/**
 * Search for pattern in file content (async ripgrep-based implementation with fallback)
 */
export async function searchInContent(
  filePath: string,
  content: string,
  pattern: string,
  options: {
    multiline?: boolean;
    caseInsensitive?: boolean;
    contextBefore?: number;
    contextAfter?: number;
    contextAround?: number;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    output_mode: 'content' | 'files_with_matches' | 'count';
  }
): Promise<{ matches: MatchResult[]; matchCount: number }> {
  // For content-based search, we'll write to a temp file and use ripgrep
  // This maintains compatibility while leveraging ripgrep's performance
  try {
    const tempFile = `/tmp/rg-search-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
    await fs.writeFile(tempFile, content, 'utf8');
    
    try {
      const result = await executeRipgrep(pattern, tempFile, options);
      return parseRipgrepOutput(result.stdout, result.stderr, result.exitCode, options, filePath);
    } finally {
      // Clean up temp file
      try {
        await fs.unlink(tempFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  } catch (error) {
    logger.warn('Error in content search with ripgrep, falling back to regex', {
      error: error instanceof Error ? error.message : String(error)
    });
    
    // Fallback to original regex-based implementation if ripgrep fails
    return searchInContentFallback(filePath, content, pattern, options);
  }
}

/**
 * Fallback regex-based content search (original implementation)
 */
function searchInContentFallback(
  filePath: string,
  content: string,
  pattern: string,
  options: {
    multiline?: boolean;
    caseInsensitive?: boolean;
    contextBefore?: number;
    contextAfter?: number;
    contextAround?: number;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    output_mode: 'content' | 'files_with_matches' | 'count';
  }
): { matches: MatchResult[]; matchCount: number } {
  const {
    multiline = false,
    caseInsensitive = false,
    output_mode: outputMode
  } = options;

  // Prepare regex flags
  let flags = 'g';
  if (caseInsensitive) flags += 'i';
  if (multiline) flags += 'ms';

  const regex = new RegExp(pattern, flags);
  const matches: MatchResult[] = [];
  let matchCount = 0;

  if (outputMode === 'files_with_matches') {
    const hasMatch = regex.test(content);
    return { matches: hasMatch ? [{ filePath }] : [], matchCount: hasMatch ? 1 : 0 };
  }

  // Content mode
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    
    const lineMatches = Array.from(line.matchAll(regex));
    if (lineMatches.length > 0) {
      matchCount += lineMatches.length;
      matches.push({
        filePath,
        lineNumber: i + 1, // Always include line numbers
        content: line
      });
    }
  }

  return { matches, matchCount };
}

/**
 * Process search results according to output mode
 */
export function processSearchResults(
  allMatches: Map<string, { matches: MatchResult[]; matchCount: number }>,
  outputMode: 'content' | 'files_with_matches' | 'count',
  headLimit?: number
): {
  matches?: MatchResult[];
  filesFound?: string[];
  truncated: boolean;
} {
  let truncated = false;

  switch (outputMode) {
    case 'content': {
      const allContentMatches: MatchResult[] = [];
      for (const { matches } of allMatches.values()) {
        allContentMatches.push(...matches);
      }

      let finalMatches = allContentMatches;
      if (headLimit && allContentMatches.length > headLimit) {
        finalMatches = allContentMatches.slice(0, headLimit);
        truncated = true;
      }

      return { matches: finalMatches, truncated };
    }

    case 'files_with_matches': {
      const filesWithMatches = Array.from(allMatches.keys()).filter(
        filePath => allMatches.get(filePath)!.matchCount > 0
      );

      let finalFiles = filesWithMatches;
      if (headLimit && filesWithMatches.length > headLimit) {
        finalFiles = filesWithMatches.slice(0, headLimit);
        truncated = true;
      }

      return { filesFound: finalFiles, truncated };
    }

    case 'count': {
      // For count mode, return match counts per file
      const countResults: MatchResult[] = [];
      for (const [filePath, { matchCount }] of allMatches) {
        if (matchCount > 0) {
          countResults.push({ filePath, matchCount });
        }
      }
      let finalCounts = countResults;
      if (headLimit && countResults.length > headLimit) {
        finalCounts = countResults.slice(0, headLimit);
        truncated = true;
      }
      return { matches: finalCounts, truncated };
    }

    default:
      throw new Error(`Unsupported output mode: ${outputMode as string}`);
  }
}

/**
 * Generate search statistics
 */
export function generateSearchStats(
  allMatches: Map<string, { matches: MatchResult[]; matchCount: number }>,
  searchDuration: number,
  truncated: boolean
): SearchStats {
  const totalFiles = allMatches.size;
  let filesWithMatches = 0;
  let totalMatches = 0;

  for (const { matchCount } of allMatches.values()) {
    if (matchCount > 0) {
      filesWithMatches++;
      totalMatches += matchCount;
    }
  }

  return {
    totalFiles,
    filesWithMatches,
    totalMatches,
    searchDuration: Math.max(1, searchDuration), // Ensure minimum 1ms
    truncated
  };
}

/**
 * Validate context options
 */
export function validateContextOptions(input: GrepToolInput): void {
  const { "-A": contextAfter, "-B": contextBefore, "-C": contextAround, output_mode: outputMode } = input;
  
  // Context options only work with content mode
  if ((contextAfter || contextBefore || contextAround) && outputMode !== 'content') {
    throw new Error('Context options (-A, -B, -C) require output mode to be "content"');
  }
  
  // Line numbers only work with content mode
  if (input["-n"] && outputMode !== 'content') {
    throw new Error('Line numbers option (-n) requires output mode to be "content"');
  }
}

/**
 * Apply head limit to search operations
 */
export function shouldStopSearching(
  foundMatches: number,
  headLimit?: number,
  outputMode?: string
): boolean {
  if (!headLimit) {
    return false;
  }

  switch (outputMode) {
    case 'content':
      return foundMatches >= headLimit;
    case 'files_with_matches':
      return foundMatches >= headLimit;
    case 'count':
      return foundMatches >= headLimit;
    default:
      return false;
  }
}