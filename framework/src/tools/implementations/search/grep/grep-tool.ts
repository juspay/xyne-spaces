import path from 'path';
import type { ToolExecutionContext, ToolExecutionResult } from '../../../core/types/tool.js';
import { BaseTool } from '../../../core/base-tool.js';
import { Tool } from '../../../core/decorators.js';
import { logger } from '../../../../utils/logger.js';
import {
  GrepToolInputSchema,
  GrepToolOutputSchema,
  GrepToolLLMOutputSchema,
  type GrepToolInput,
  type GrepToolOutput,
  type GrepToolLLMOutput,
  type MatchResult,
  MAX_GREP_RESULTS
} from './schemas.js';
import {
  validateSearchPath,
  validatePattern,
  validateFileType,
  validateGlobPattern,
  getFileInfo,
  mapFileSystemError
} from './validation.js';
import {
  executeRipgrep,
  parseRipgrepOutput,
  processSearchResults,
  generateSearchStats,
  validateContextOptions
} from './processor.js';

/**
 * Maximum character limit for grep output
 */
const MAX_OUTPUT_CHARACTERS = 30000;

/**
 * Truncate output if it exceeds the character limit
 */
function truncateOutput(output: string): { content: string; wasTruncated: boolean } {
  if (output.length <= MAX_OUTPUT_CHARACTERS) {
    return { content: output, wasTruncated: false };
  }
  
  const truncated = output.substring(0, MAX_OUTPUT_CHARACTERS);
  const lastNewlineIndex = truncated.lastIndexOf('\n');
  
  // Try to truncate at a newline to avoid cutting off mid-line
  const finalContent = lastNewlineIndex > MAX_OUTPUT_CHARACTERS - 1000 
    ? truncated.substring(0, lastNewlineIndex)
    : truncated;
    
  return { 
    content: finalContent + '\n... (output truncated after 30000 characters)', 
    wasTruncated: true 
  };
}

/**
 * GrepTool for searching patterns in files with powerful filtering and output options
 * Features:
 * - Regular expression pattern matching
 * - Multiple output modes (content, files_with_matches, count)
 * - File type and glob pattern filtering
 * - Context lines and line number display
 * - Multiline and case-insensitive search
 * - Head limit for controlling output size
 * - Comprehensive performance tracking
 */
@Tool({
  name: 'grep',
  description: 'A powerful search tool built on ripgrep',
  inputSchema: GrepToolInputSchema,
  outputSchema: GrepToolOutputSchema,
  llmOutputSchema: GrepToolLLMOutputSchema,
  version: '1.0.0',
  tags: ['search', 'grep', 'pattern', 'regex', 'files'],
  category: 'search'
})
export class GrepTool extends BaseTool<GrepToolInput, GrepToolOutput, GrepToolLLMOutput> {
  protected readonly inputSchema = GrepToolInputSchema;
  protected readonly outputSchema = GrepToolOutputSchema;
  protected readonly toolName = 'grep';

  /**
   * Extract minimal content for LLM - results with counts
   */
  public getLLMOutput(result: ToolExecutionResult<GrepToolOutput>): GrepToolLLMOutput {
    if (!result.success) {
      return {
        error: result.error?.message || 'Search failed'
      };
    }

    if (!result.data) {
      return {
        error: 'No data returned from search operation'
      };
    }

    const data = result.data;
    const stats = data.stats;
    
    // Generate results based on output mode
    let results: string;
    switch (data.output_mode) {
      case 'files_with_matches':
        results = data.filesFound ? data.filesFound.join('\n') : '';
        break;
      
      case 'content':
        if (data.matches && data.matches.length > 0) {
          results = data.matches
            .map(match => match.content || `${match.filePath}:${match.lineNumber}`)
            .join('\n');
        } else {
          results = '';
        }
        break;
      
      case 'count':
        if (data.matches && data.matches.length > 0) {
          results = data.matches
            .map(match => `${match.filePath}:${match.matchCount || 0}`)
            .join('\n');
        } else {
          results = '';
        }
        break;
      
      default:
        results = '';
    }

    // Apply character-based truncation
    const truncationResult = truncateOutput(results);
    results = truncationResult.content;
    const characterTruncated = truncationResult.wasTruncated;

    // If no matches, return error object
    if (stats.totalMatches === 0) {
      return {
        error: 'No matches found'
      };
    }

    // If results were truncated (either by count or character limit), add suggestion
    if (stats.truncated || characterTruncated) {
      let suggestion = '';
      if (stats.truncated && characterTruncated) {
        suggestion = `Results were limited to ${MAX_GREP_RESULTS} entries and truncated at ${MAX_OUTPUT_CHARACTERS} characters. Consider using a more specific pattern, path, or file type filter to get targeted results.`;
      } else if (stats.truncated) {
        suggestion = `Results were limited to ${MAX_GREP_RESULTS} entries. Consider using a more specific pattern, path, or file type filter to get targeted results.`;
      } else {
        suggestion = `Output was truncated at ${MAX_OUTPUT_CHARACTERS} characters. Consider using a more specific pattern, path, or file type filter to get targeted results.`;
      }
      
      return {
        results,
        totalMatches: stats.totalMatches,
        filesWithMatches: stats.filesWithMatches,
        totalFiles: stats.totalFiles,
        truncated: true,
        suggestion
      };
    }

    // Return structured data with counts
    return {
      results,
      totalMatches: stats.totalMatches,
      filesWithMatches: stats.filesWithMatches,
      totalFiles: stats.totalFiles
    };
  }

  /**
   * Execute grep search with comprehensive pattern matching and filtering
   */
  protected async executeInternal(
    input: GrepToolInput,
    context: ToolExecutionContext
  ): Promise<GrepToolOutput> {
    const startTime = Date.now();

    // Apply defaults and validate input
    const {
      pattern,
      path: searchPath = '.',
      glob,
      type,
      output_mode: outputMode = 'files_with_matches',
      multiline = false,
      "-i": caseInsensitive = false,
      "-A": contextAfter,
      "-B": contextBefore,
      "-C": contextAround,
      "-n": showLineNumbers = false,
      head_limit: headLimit
    } = input;

    // Apply hard limit even if head_limit is not specified
    const effectiveHeadLimit = headLimit !== undefined ? Math.min(headLimit, MAX_GREP_RESULTS) : MAX_GREP_RESULTS;

    logger.debug('Starting grep search operation', {
      pattern: pattern.substring(0, 100), // Log first 100 chars for debugging
      searchPath,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      output_mode: outputMode,
      multiline,
      caseInsensitive,
      headLimit,
      executionId: context.executionId
    });

    try {
      // Validate all inputs
      const resolvedPath = validateSearchPath(searchPath);
      validatePattern(pattern);
      validateGlobPattern(glob);
      validateContextOptions(input);
      validateFileType(type);

      // Check if search path exists
      const pathInfo = await getFileInfo(resolvedPath);
      if (!pathInfo.exists) {
        throw new Error(`Search path does not exist: ${resolvedPath}`);
      }

      if (!pathInfo.isFile && !pathInfo.isDirectory) {
        throw new Error(`Invalid search path: ${resolvedPath} is neither a file nor directory`);
      }

      // Use ripgrep directly for better performance
      const searchOptions: {
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
      } = {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        output_mode: outputMode,
        multiline,
        caseInsensitive
      };

      // Only add defined optional properties
      if (glob) searchOptions.glob = glob;
      if (type) searchOptions.type = type;
      if (contextAfter !== undefined) searchOptions.contextAfter = contextAfter;
      if (contextBefore !== undefined) searchOptions.contextBefore = contextBefore;
      if (contextAround !== undefined) searchOptions.contextAround = contextAround;
      searchOptions.headLimit = effectiveHeadLimit;

      // Execute ripgrep search
      const { stdout, stderr, exitCode } = await executeRipgrep(pattern, resolvedPath, searchOptions);
      // Only pass searchedFilePath for file searches, not directory searches
      const searchedFilePath = pathInfo.isFile ? resolvedPath : undefined;
      const ripgrepResult = parseRipgrepOutput(stdout, stderr, exitCode, { 
        // eslint-disable-next-line @typescript-eslint/naming-convention
        output_mode: outputMode 
      }, searchedFilePath);
      
      // Group results by file for statistics
      const searchResults = new Map<string, { matches: MatchResult[]; matchCount: number }>();
      const fileResults = new Map<string, number>();
      
      for (const match of ripgrepResult.matches) {
        const filePath = match.filePath || resolvedPath;
        fileResults.set(filePath, (fileResults.get(filePath) || 0) + 1);
      }
      
      // Convert to expected format
      for (const [filePath, count] of fileResults.entries()) {
        const fileMatches = ripgrepResult.matches.filter(m => (m.filePath || resolvedPath) === filePath);
        searchResults.set(filePath, { matches: fileMatches, matchCount: count });
      }

      // Process results according to output mode
      const processedResults = processSearchResults(
        searchResults,
        outputMode,
        effectiveHeadLimit
      );

      // Generate statistics
      const searchDuration = Date.now() - startTime;
      const stats = generateSearchStats(searchResults, searchDuration, processedResults.truncated);

      // Construct result
      const result: GrepToolOutput = {
        pattern,
        searchPath: path.resolve(resolvedPath),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        output_mode: outputMode,
        stats,
        options: {
          glob,
          type,
          multiline,
          caseInsensitive,
          contextAfter,
          contextBefore,
          contextAround,
          showLineNumbers,
          headLimit: effectiveHeadLimit
        }
      };

      // Add mode-specific results
      if (outputMode === 'content' && processedResults.matches) {
        result.matches = processedResults.matches;
      } else if (outputMode === 'files_with_matches' && processedResults.filesFound) {
        result.filesFound = processedResults.filesFound;
      } else if (outputMode === 'count' && processedResults.matches) {
        result.matches = processedResults.matches;
      }

      logger.info('Grep search operation completed', {
        pattern: pattern.substring(0, 50),
        totalFiles: stats.totalFiles,
        filesWithMatches: stats.filesWithMatches,
        totalMatches: stats.totalMatches,
        searchDuration: stats.searchDuration,
        truncated: stats.truncated,
        executionId: context.executionId
      });

      return result;

    } catch (error) {
      logger.error('Grep search operation failed', error as Error, {
        pattern: pattern.substring(0, 50),
        searchPath,
        executionId: context.executionId
      });

      // Map file system errors to user-friendly messages
      const mappedError = mapFileSystemError(error, searchPath);
      throw mappedError;
    }
  }
}