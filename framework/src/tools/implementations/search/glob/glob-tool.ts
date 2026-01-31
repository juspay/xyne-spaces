import path from 'path';
import type { ToolExecutionContext, ToolExecutionResult } from '../../../core/types/tool.js';
import { BaseTool } from '../../../core/base-tool.js';
import { Tool } from '../../../core/decorators.js';
import { logger } from '../../../../utils/logger.js';
import {
  GlobToolInputSchema,
  GlobToolOutputSchema,
  GlobToolLLMOutputSchema,
  type GlobToolInput,
  type GlobToolOutput,
  type GlobToolLLMOutput
} from './schemas.js';
import {
  validateGlobPath,
  validateGlobPattern,
  validateSearchDirectory,
  mapFileSystemError
} from './validation.js';
import {
  findGlobMatches,
  generateGlobStats,
  analyzeGlobPattern
} from './processor.js';
// validateGlobOptions, processGlobResults removed - no longer needed for simplified interface

/**
 * GlobTool for finding files using glob patterns - simplified to match  exactly
 * Features:
 * - Fast file pattern matching like 
 * - Simple interface with optional search path
 * - Returns matching file paths sorted by modification time
 * - Rich metadata output while keeping simple interface
 * - Security validation for paths and patterns
 */
@Tool({
  name: 'glob',
  description: 'Fast file pattern matching tool that works with any codebase size. Supports glob patterns like "**/*.js" or "src/**/*.ts". Returns matching file paths sorted by modification time.',
  inputSchema: GlobToolInputSchema,
  outputSchema: GlobToolOutputSchema,
  llmOutputSchema: GlobToolLLMOutputSchema,
  version: '1.0.0',
  tags: ['files', 'glob', 'pattern', 'search', 'find'],
  category: 'search'
})
export class GlobTool extends BaseTool<GlobToolInput, GlobToolOutput, GlobToolLLMOutput> {
  protected readonly inputSchema = GlobToolInputSchema;
  protected readonly outputSchema = GlobToolOutputSchema;
  protected readonly toolName = 'glob';

  /**
   * Extract minimal content for LLM - clean output for LLM consumption
   */
  public getLLMOutput(result: ToolExecutionResult<GlobToolOutput>): GlobToolLLMOutput {
    if (!result.success) {
      return {
        error: result.error?.message || 'Glob search failed'
      };
    }

    if (!result.data) {
      return {
        error: 'No data returned from glob operation'
      };
    }

    const data = result.data;
    
    // If results were truncated, add suggestion to use more specific pattern
    if (data.stats.truncated) {
      return {
        matches: data.matches,
        totalMatches: data.stats.totalMatches,
        searchPattern: data.stats.pattern,
        truncated: true,
        suggestion: 'Results were limited to 100 files. Consider using a more specific pattern or path to get targeted results.'
      };
    }
    
    return {
      matches: data.matches,
      totalMatches: data.stats.totalMatches,
      searchPattern: data.stats.pattern
    };
  }

  /**
   * Execute glob search - simplified to match 
   */
  protected async executeInternal(
    input: GlobToolInput,
    context: ToolExecutionContext
  ): Promise<GlobToolOutput> {
    const startTime = Date.now();

    // Apply defaults (match  behavior)
    const pattern = input.pattern;
    const searchPath = input.path || '.'; // Default to current directory like 
    const followSymlinks = false; // Default like 
    const ignoreHidden = true; // Default like 
    // maxDepth, limit removed - no limits in simplified interface

    logger.debug('Starting glob search operation', {
      pattern: pattern.substring(0, 100), // Log first 100 chars for debugging
      searchPath,
      followSymlinks,
      ignoreHidden,
      executionId: context.executionId
    });

    try {
      // Validate inputs
      const resolvedPath = validateGlobPath(searchPath);
      validateGlobPattern(pattern);
      // No complex option validation needed for simplified interface

      // Check if search path exists and is a directory
      const pathExists = await validateSearchDirectory(resolvedPath);
      if (!pathExists) {
        throw new Error(`Search directory does not exist: ${resolvedPath}`);
      }

      // Analyze pattern for potential performance issues
      const { isExpensive, warnings } = analyzeGlobPattern(pattern, resolvedPath);
      
      if (isExpensive) {
        logger.warn('Potentially expensive glob pattern detected', {
          pattern,
          warnings,
          executionId: context.executionId
        });
      }

      logger.debug('Directory validated, starting glob search', {
        resolvedPath: path.resolve(resolvedPath),
        patternWarnings: warnings,
        executionId: context.executionId
      });

      // Perform glob search (simplified options for  compatibility)
      const searchOptions = {
        followSymlinks,
        ignoreHidden
        // maxDepth, limit removed - no limits in simplified interface
      };

      const { matches, stats: baseStats } = await findGlobMatches(
        resolvedPath,
        pattern,
        searchOptions
      );

      // Sort results by modification time ( behavior)
      const sortedMatches = matches.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());

      // Generate final statistics
      const searchDuration = Date.now() - startTime;
      const stats = generateGlobStats(baseStats, searchDuration);

      // Construct result with  compatible simple array + rich metadata
      const result: GlobToolOutput = {
        // ✅ CORE:  compatible output
        matches: sortedMatches.map(match => match.path), // Simple array of paths, sorted by modification time
        
        // ✅ ENHANCED: Rich metadata per match  
        // eslint-disable-next-line @typescript-eslint/naming-convention
        detailed_matches: sortedMatches.map(match => ({
          path: match.path,
          relativePath: match.relativePath,
          size: match.size,
          lastModified: match.lastModified,
          isDirectory: match.isDirectory,
          isFile: match.isFile,
          extension: match.extension
        })),
        
        // ✅ KEEP: Useful metadata (no input echoes)
        stats
        
        // ❌ REMOVED: Input echoes (options object)
      };

      logger.info('Glob search operation completed', {
        pattern: pattern.substring(0, 50),
        totalMatches: stats.totalMatches,
        directoriesSearched: stats.directoriesSearched,
        searchDuration: stats.searchDuration,
        returnedMatches: sortedMatches.length,
        executionId: context.executionId
      });

      return result;

    } catch (error) {
      logger.error('Glob search operation failed', error as Error, {
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