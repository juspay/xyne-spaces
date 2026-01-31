import { promises as fs } from 'fs';
import type { ToolExecutionContext, ToolExecutionResult } from '../../../core/types/tool.js';
import { BaseTool } from '../../../core/base-tool.js';
import { Tool } from '../../../core/decorators.js';
import { logger } from '../../../../utils/logger.js';
import { 
  WriteToolInputSchema, 
  WriteToolOutputSchema,
  WriteToolLLMOutputSchema,
  type WriteToolInput,
  type WriteToolOutput,
  type WriteToolLLMOutput
} from './schemas.js';
import { 
  validateWriteFilePath,
  ensureDirectoryExists,
  getExistingFileInfo,
  validateFileContent,
  mapFileSystemError
} from './security.js';
import { 
  processContent,
  generateDiffSummary,
  generateWriteSuggestions
} from './content-processor.js';

/**
 * WriteTool for writing content to files - simplified to match  exactly
 * Features:
 * - Accepts absolute paths like 
 * - Automatic parent directory creation  
 * - Always overwrites existing files like 
 * - UTF-8 encoding (default)
 * - Content change tracking with metadata
 */
@Tool({
  name: 'write',
  description: 'Writes a file to the local filesystem. Overwrites existing files and creates parent directories as needed.',
  inputSchema: WriteToolInputSchema,
  outputSchema: WriteToolOutputSchema,
  llmOutputSchema: WriteToolLLMOutputSchema,
  version: '1.0.0',
  tags: ['file', 'io', 'write'],
  category: 'file'
})
export class WriteTool extends BaseTool<WriteToolInput, WriteToolOutput, WriteToolLLMOutput> {
  protected readonly inputSchema = WriteToolInputSchema;
  protected readonly outputSchema = WriteToolOutputSchema;
  protected readonly toolName = 'write';

  /**
   * Extract minimal content for LLM - includes essential write information
   */
  public getLLMOutput(result: ToolExecutionResult<WriteToolOutput>): WriteToolLLMOutput {
    if (!result.success) {
      return {
        error: result.error?.message || 'File write failed'
      };
    }

    if (!result.data) {
      return {
        error: 'No data returned from write operation'
      };
    }

    const data = result.data;
    
    // Count lines in content (split by newlines)
    const linesWritten = data.diffSummary?.linesAdded || 0;
    
    return {
      message: data.created ? 'File created successfully' : 'File updated successfully',
      linesWritten,
      newFile: data.created
    };
  }

  /**
   * Execute file writing - simplified to match 
   */
  protected async executeInternal(
    input: WriteToolInput,
    context: ToolExecutionContext
  ): Promise<WriteToolOutput> {
    
    // Apply defaults (match  behavior)
    const encoding = 'utf8'; // Always UTF-8 like 
    const createDirectories = true; // Always create directories like 
    const overwrite = true; // Always overwrite like 
    const stripEOFMarkers = true; // Always strip EOF markers

    logger.debug('Starting file write operation', {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      file_path: input.file_path,
      contentLength: input.content.length,
      executionId: context.executionId
    });

    try {
      // Validate and resolve file path (supports both relative and absolute)
      const resolvedPath = validateWriteFilePath(input.file_path, this.getEffectiveCwd(context));
      
      // Process content
      const processedContent = processContent(input.content, stripEOFMarkers);
      
      // Validate content for security issues
      validateFileContent(processedContent);
      
      // Get existing file information
      const existingFileInfo = await getExistingFileInfo(resolvedPath);
      
      // Check if we should overwrite existing files
      if (existingFileInfo.exists && !overwrite) {
        throw new Error(`File already exists and overwrite is disabled: ${resolvedPath}`);
      }
      
      // Create parent directories if needed
      let directoryCreated = false;
      if (createDirectories) {
        directoryCreated = await ensureDirectoryExists(resolvedPath);
      }
      
      // Generate diff summary if file exists
      let diffSummary;
      let contentChanged = true;
      
      if (existingFileInfo.exists && existingFileInfo.content !== undefined) {
        diffSummary = generateDiffSummary(existingFileInfo.content, processedContent);
        contentChanged = diffSummary.hasChanges;
      }
      
      // Write the file
      await fs.writeFile(resolvedPath, processedContent, { encoding });
      
      // Get file stats after writing
      const stats = await fs.stat(resolvedPath);
      const bytesWritten = Buffer.byteLength(processedContent, encoding);
      
      // Ensure lastModified is a proper Date object
      const lastModified = stats.mtime instanceof Date ? stats.mtime : new Date(stats.mtime);
      
      // Generate helpful suggestions
      const suggestions = generateWriteSuggestions(
        resolvedPath,
        !existingFileInfo.exists,
        contentChanged,
        bytesWritten
      );
      
      const result: WriteToolOutput = {
        success: true, // ✅ CORE:  compatible
        bytesWritten,
        created: !existingFileInfo.exists,
        originalContent: existingFileInfo.content,
        contentChanged,
        directoryCreated,
        lastModified,
        diffSummary,
        suggestions: suggestions.length > 0 ? suggestions : undefined
        // ❌ REMOVED: filePath (input echo), newContent (input echo), encoding (input echo)
      };

      logger.info('File write completed successfully', {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        file_path: resolvedPath,
        bytesWritten,
        created: result.created,
        contentChanged,
        directoryCreated,
        executionId: context.executionId
      });

      return result;

    } catch (error) {
      logger.error('File write operation failed', error as Error, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        file_path: input.file_path,
        executionId: context.executionId
      });

      // Map file system errors to user-friendly messages
      const mappedError = mapFileSystemError(error, input.file_path);
      throw mappedError;
    }
  }
}