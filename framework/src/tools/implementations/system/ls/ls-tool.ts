import path from 'path';
import type { ToolExecutionContext, ToolExecutionResult } from '../../../core/types/tool.js';
import { BaseTool } from '../../../core/base-tool.js';
import { Tool } from '../../../core/decorators.js';
import { logger } from '../../../../utils/logger.js';
import {
  LsToolInputSchema,
  LsToolOutputSchema,
  LsToolLLMOutputSchema,
  type LsToolInput,
  type LsToolOutput,
  type LsToolLLMOutput,
  LsDetailedEntry
} from './schemas.js';
import {
  validateLsPath,
  validateIgnorePatterns,
  validateDirectory,
  mapFileSystemError
} from './validation.js';
import {
  listDirectory,
  sortEntries,
  generateLsStats
} from './processor.js';
// applyLimit, validateLsOptions removed - no longer needed for simplified interface

/**
 * LsTool for listing files and directories - simplified to match  exactly
 * Features:
 * - Simple directory listing like 
 * - Optional ignore patterns support
 * - Rich metadata output while keeping simple interface
 * - Security validation for paths and operations
 */
@Tool({
  name: 'ls',
  description: 'Lists files and directories in a given path. The path parameter must be an absolute path, not a relative path. You can optionally provide an array of glob patterns to ignore with the ignore parameter.',
  inputSchema: LsToolInputSchema,
  outputSchema: LsToolOutputSchema,
  llmOutputSchema: LsToolLLMOutputSchema,
  version: '1.0.0',
  tags: ['filesystem', 'directory', 'listing', 'files', 'system'],
  category: 'system'
})
export class LsTool extends BaseTool<LsToolInput, LsToolOutput, LsToolLLMOutput> {
  protected readonly inputSchema = LsToolInputSchema;
  protected readonly outputSchema = LsToolOutputSchema;
  protected readonly toolName = 'ls';

  /**
   * Extract minimal content for LLM - matches  tree format with character limit
   */
  public getLLMOutput(result: ToolExecutionResult<LsToolOutput>): LsToolLLMOutput {
    if (!result.success) {
      return {
        error: result.error?.message || 'Directory listing failed'
      };
    }

    if (!result.data) {
      return {
        error: 'No data returned from ls operation'
      };
    }

    const data = result.data;
    
    // Generate tree-like output similar to 's LS tool
    const treeOutput = this.generateTreeOutput(data.entries, data.detailed_entries);
    const maxCharacters = 40000; // Match 's limit
    
    const output: LsToolLLMOutput = {
      directoryTree: treeOutput.length > maxCharacters ? treeOutput.substring(0, maxCharacters) : treeOutput,
      totalEntries: data.stats.totalEntries
    };

    // Add truncation message if results were limited (matching  format)
    if (treeOutput.length > maxCharacters) {
      output.truncationMessage = `There are more than ${maxCharacters} characters in the repository... Use the LS tool (passing a specific path), Bash tool, and other tools to explore nested directories. The first ${maxCharacters} characters are included below:`;
    }
    
    return output;
  }

  /**
   * Generate tree-like directory structure like 
   */
  private generateTreeOutput(entries: string[], detailedEntries: LsDetailedEntry[]): string {
    const lines: string[] = [];
    
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const detail = detailedEntries.find(d => d.name === entry);
      const isLast = i === entries.length - 1;
      const prefix = isLast ? '└── ' : '├── ';
      
      if (detail?.type === 'directory') {
        lines.push(`${prefix}${entry}/`);
      } else {
        lines.push(`${prefix}${entry}`);
      }
    }
    
    return lines.join('\n');
  }

  /**
   * Execute directory listing - simplified to match 
   */
  protected async executeInternal(
    input: LsToolInput,
    context: ToolExecutionContext
  ): Promise<LsToolOutput> {
    const startTime = Date.now();

    // Apply defaults (match  behavior)
    const searchPath = input.path;
    const ignore = input.ignore;
    const showHidden = false;
    const recursive = false;
    const sortBy = 'name';
    const sortOrder = 'asc';
    const includeSize = true; // Include for metadata
    const includePermissions = false;
    const includeOwner = false;

    logger.debug('Starting LS operation', {
      searchPath,
      showHidden,
      recursive,
      sortBy,
      sortOrder,
      includeSize,
      includePermissions,
      includeOwner,
      ignorePatterns: ignore?.length || 0,
      executionId: context.executionId
    });

    try {
      // Validate inputs
      const resolvedPath = validateLsPath(searchPath);
      const ignorePatterns = validateIgnorePatterns(ignore);
      // No complex option validation needed for simplified interface

      // Check if search path exists and is accessible
      const pathValidation = await validateDirectory(resolvedPath);
      if (!pathValidation.exists) {
        throw new Error(`Directory does not exist: ${resolvedPath}`);
      }
      if (!pathValidation.isDirectory) {
        throw new Error(`Path is not a directory: ${resolvedPath}`);
      }
      if (!pathValidation.isReadable) {
        throw new Error(`Permission denied: Cannot read directory ${resolvedPath}`);
      }

      logger.debug('Directory validated, starting listing', {
        resolvedPath: path.resolve(resolvedPath),
        executionId: context.executionId
      });

      // Perform directory listing (simplified options for  compatibility)
      const listingOptions = {
        showHidden,
        recursive,
        ignorePatterns,
        includeSize,
        includePermissions,
        includeOwner
        // maxDepth removed - not needed for simple listing
      };

      const { entries, stats: baseStats } = await listDirectory(
        resolvedPath,
        listingOptions,
        0,
        this.getEffectiveCwd(context)
      );

      // Sort entries ( default: alphabetical)
      const sortedEntries = sortEntries(entries, sortBy, sortOrder);

      // No limit applied - show all entries like 
      const finalEntries = sortedEntries;

      // Generate final statistics
      const searchDuration = Date.now() - startTime;
      const stats = generateLsStats(
        baseStats,
        searchDuration,
        finalEntries.length
      );

      // Construct result with  compatible simple array + rich metadata
      const result: LsToolOutput = {
        // ✅ CORE:  compatible output
        entries: finalEntries.map(entry => entry.name), // Simple array of names
        
        // ✅ ENHANCED: Rich metadata per entry
        // eslint-disable-next-line @typescript-eslint/naming-convention
        detailed_entries: finalEntries.map(entry => ({
          name: entry.name,
          type: entry.type,
          size: entry.size,
          modified: entry.modified,
          isHidden: entry.isHidden,
          extension: entry.extension
        })),
        
        // ✅ KEEP: Useful metadata (no input echoes)
        stats
        
        // ❌ REMOVED: Input echoes (options object)
      };

      logger.info('LS operation completed', {
        searchPath: resolvedPath,
        totalEntries: stats.totalEntries,
        filesCount: stats.filesCount,
        directoriesCount: stats.directoriesCount,
        symlinksCount: stats.symlinksCount,
        hiddenCount: stats.hiddenCount,
        totalSize: stats.totalSize,
        searchDuration: stats.searchDuration,
        // truncated removed from simplified interface
        returnedEntries: finalEntries.length,
        executionId: context.executionId
      });

      return result;

    } catch (error) {
      logger.error('LS operation failed', error as Error, {
        searchPath,
        executionId: context.executionId
      });

      // Map file system errors to user-friendly messages
      const mappedError = mapFileSystemError(error, searchPath);
      throw mappedError;
    }
  }
}