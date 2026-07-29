import { promises as fs } from 'fs';
import type { ToolExecutionContext, ToolExecutionResult } from '../../../core/types/tool.js';
import { BaseTool } from '../../../core/base-tool.js';
import { Tool } from '../../../core/decorators.js';
import { logger } from '../../../../utils/logger.js';
import { 
  ReadToolInputSchema, 
  ReadToolOutputSchema,
  ReadToolLLMOutputSchema,
  type ReadToolInput,
  type ReadToolOutput,
  type ReadToolLLMOutput
} from './schemas.js';
import { 
  validateFilePath,
  getFileMetadata,
  isTextFile 
} from './security.js';
import { 
  processLines,
  validateLineParameters,
  type LineProcessingOptions 
} from './line-processor.js';
import { 
  generateReadSuggestions,
  type SuggestionContext
} from './suggestion-generator.js';

/**
 * File reading limits
 */
const DEFAULT_LINE_LIMIT = 2000; // Default number of lines to read
const MAX_LINE_LENGTH = 2000; // Maximum characters per line

/**
 * ReadTool for reading file content - simplified to match  exactly
 * Matches  with cat -n format, offset/limit support, and image handling
 */
@Tool({
  name: 'read',
  description: 'Reads a file from the local filesystem. Supports offset and limit parameters for large files, returns content with line numbers in cat -n format.',
  inputSchema: ReadToolInputSchema,
  outputSchema: ReadToolOutputSchema,
  llmOutputSchema: ReadToolLLMOutputSchema,
  version: '2.0.0',
  tags: ['file', 'io', 'read'],
  category: 'file'
})
export class ReadTool extends BaseTool<ReadToolInput, ReadToolOutput, ReadToolLLMOutput> {
  protected readonly inputSchema = ReadToolInputSchema;
  protected readonly outputSchema = ReadToolOutputSchema;
  protected readonly toolName = 'read';

  /**
   * Extract minimal content for LLM - matches  format
   * Returns content with optional suggestions when truncated/modified
   */
  public getLLMOutput(result: ToolExecutionResult<ReadToolOutput>): ReadToolLLMOutput {
    if (!result.success) {
      return {
        content: '',
        error: result.error?.message || 'File read failed'
      };
    }

    if (!result.data) {
      return {
        content: '',
        error: 'No data returned from read operation'
      };
    }

    const data = result.data;
    
    // Return content with optional suggestions
    const output: ReadToolLLMOutput = {
      content: data.content
    };

    if (data.suggestions && data.suggestions.length > 0) {
      output.suggestions = data.suggestions;
    }
    
    return output;
  }

  /**
   * Execute file reading - simplified to match 
   */
  protected async executeInternal(
    input: ReadToolInput,
    context: ToolExecutionContext
  ): Promise<ReadToolOutput> {
    
    // Apply defaults (match  behavior)
    const encoding = 'utf8'; // Always use UTF-8 like 
    const offset = input.offset || 1;
    const limit = Math.min(input.limit || DEFAULT_LINE_LIMIT, DEFAULT_LINE_LIMIT); // Default 2000 lines 

    logger.debug('Starting file read operation', {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      file_path: input.file_path,
      offset,
      limit,
      executionId: context.executionId
    });

    try {
      // Validate and resolve file path (supports both relative and absolute)
      const resolvedPath = validateFilePath(input.file_path, this.getEffectiveCwd(context));
      
      // Get file metadata
      const metadata = await getFileMetadata(resolvedPath);
      
      if (!metadata.isFile) {
        throw new Error('Path does not point to a file');
      }
      
      // Check if file is empty
      if (metadata.size === 0) {
        logger.warn('Reading empty file', {
          filePath: resolvedPath,
          executionId: context.executionId
        });
        
        // Generate suggestions for empty file
        const emptySuggestionContext: SuggestionContext = {
          totalLines: 0,
          linesRead: 0,
          startLine: 0,
          endLine: 0,
          truncated: false,
          filePath: resolvedPath
        };
        
        const emptySuggestions = generateReadSuggestions(emptySuggestionContext);
        
        return {
          content: '',
          size: 0,
          lastModified: metadata.lastModified instanceof Date ? metadata.lastModified : new Date(metadata.lastModified),
          isTextFile: true,
          totalLines: 0,
          linesRead: 0,
          startLine: 0,
          endLine: 0,
          truncated: false,
          isEmpty: true,
          suggestions: emptySuggestions.length > 0 ? emptySuggestions : undefined
        };
      }
      
      // Read file content as buffer first for binary detection (no size limits like )
      const buffer = await fs.readFile(resolvedPath);
      
      // Check if it's a text file
      const isText = isTextFile(buffer);
      
      // For image files, we still read them but note they're binary
      if (!isText) {
        logger.info('Reading binary/image file', {
          filePath: resolvedPath,
          size: metadata.size,
          executionId: context.executionId
        });
      }
      
      // Convert to string with specified encoding
      const rawContent = buffer.toString(encoding);
      
      // Validate line parameters
      const lineParams = validateLineParameters(offset, limit);
      
      // Process lines with cat -n formatting, offset, and limit
      const lineProcessingOptions: LineProcessingOptions = {
        offset: lineParams.offset,
        limit: lineParams.limit,
        maxLineLength: MAX_LINE_LENGTH // Truncate at 2000 chars per line
      };
      
      const lineResult = processLines(rawContent, lineProcessingOptions);
      
      // Generate helpful suggestions for LLM usage
      const suggestionContext: SuggestionContext = {
        totalLines: lineResult.totalLines,
        linesRead: lineResult.linesRead,
        startLine: lineResult.startLine,
        endLine: lineResult.endLine,
        truncated: lineResult.truncated,
        offset,
        limit,
        filePath: resolvedPath
      };
      
      const suggestions = generateReadSuggestions(suggestionContext);
      
      const result: ReadToolOutput = {
        content: lineResult.content,
        size: metadata.size,
        lastModified: metadata.lastModified instanceof Date ? metadata.lastModified : new Date(metadata.lastModified),
        isTextFile: isText,
        totalLines: lineResult.totalLines,
        linesRead: lineResult.linesRead,
        startLine: lineResult.startLine,
        endLine: lineResult.endLine,
        truncated: lineResult.truncated,
        isEmpty: lineResult.isEmpty,
        suggestions: suggestions.length > 0 ? suggestions : undefined
      };

      // Log appropriate level based on file type and size
      const logLevel = !isText ? 'warn' : 'info';
      logger[logLevel]('File read completed', {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        file_path: resolvedPath,
        size: metadata.size,
        isTextFile: isText,
        totalLines: lineResult.totalLines,
        linesRead: lineResult.linesRead,
        truncated: lineResult.truncated,
        executionId: context.executionId
      });

      // Add system reminder for empty files as per specification
      if (lineResult.isEmpty) {
        logger.warn('System reminder: File has empty contents', {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          file_path: resolvedPath,
          executionId: context.executionId
        });
      }

      return result;

    } catch (error) {
      logger.error('File read operation failed', error as Error, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        file_path: input.file_path,
        executionId: context.executionId
      });

      throw error;
    }
  }
}