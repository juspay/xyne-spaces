import { promises as fs } from 'fs';
import type { ToolExecutionContext, ToolExecutionResult } from '../../../core/types/tool.js';
import { BaseTool } from '../../../core/base-tool.js';
import { Tool } from '../../../core/decorators.js';
import { logger } from '../../../../utils/logger.js';
import {
  MultiEditToolInputSchema,
  MultiEditToolOutputSchema,
  MultiEditToolLLMOutputSchema,
  type MultiEditToolInput,
  type MultiEditToolOutput,
  type MultiEditToolLLMOutput
} from './schemas.js';
import {
  validateFilePath,
  validateFileContent,
  validateEditOperations,
  mapFileSystemError
} from './validation.js';
import {
  applyMultipleEdits,
  createContentPreview,
  writeFileAtomically
} from './processor.js';
import { generateMultiEditDiff } from '../../../../utils/diff-generator.js';

/**
 * MultiEdit tool for making multiple edits to a single file in one operation
 * 
 * This tool is built on top of the Edit tool and allows you to perform multiple 
 * find-and-replace operations efficiently. Prefer this tool over the Edit tool 
 * when you need to make multiple edits to the same file.
 * 
 * Features:
 * - Atomic operations (all edits succeed or none are applied)
 * - Sequential processing (each edit operates on the result of the previous)
 * - Comprehensive validation and security checks
 * - Detailed operation results and statistics
 */
@Tool({
  name: 'multiedit',
  description: 'This is a tool for making multiple edits to a single file in one operation. It is built on top of the Edit tool and allows you to perform multiple find-and-replace operations efficiently. Prefer this tool over the Edit tool when you need to make multiple edits to the same file.',
  inputSchema: MultiEditToolInputSchema,
  outputSchema: MultiEditToolOutputSchema,
  llmOutputSchema: MultiEditToolLLMOutputSchema,
  version: '1.0.0',
  tags: ['file', 'edit', 'modify', 'replace', 'batch'],
  category: 'file'
})
export class MultiEditTool extends BaseTool<MultiEditToolInput, MultiEditToolOutput, MultiEditToolLLMOutput> {
  protected readonly inputSchema = MultiEditToolInputSchema;
  protected readonly outputSchema = MultiEditToolOutputSchema;
  protected readonly toolName = 'multiedit';

  /**
   * Extract minimal content for LLM - handles partial success/failure
   */
  public getLLMOutput(result: ToolExecutionResult<MultiEditToolOutput>): MultiEditToolLLMOutput {
    if (!result.success) {
      return {
        error: result.error?.message || 'MultiEdit failed'
      };
    }

    if (!result.data) {
      return {
        error: 'No data returned from multiedit operation'
      };
    }

    const data = result.data;
    
    // Build failed edits array
    const failedEdits = data.edits_applied
      .filter(edit => !edit.success)
      .map(edit => ({
        error: `Failed to replace "${edit.old_string}" with "${edit.new_string}"`,
        index: edit.operation_index
      }));

    const output: MultiEditToolLLMOutput = {
      message: `Applied ${data.successful_edits} of ${data.total_edits} edits successfully`
    };

    if (failedEdits.length > 0) {
      output.failedEdits = failedEdits;
    }

    return output;
  }

  /**
   * Execute multiple edit operations on a single file
   */
  protected async executeInternal(
    input: MultiEditToolInput,
    context: ToolExecutionContext
  ): Promise<MultiEditToolOutput> {
    const startTime = Date.now();
    const { file_path: filePath, edits } = input;

    logger.info('Starting MultiEdit operation', {
      filePath,
      editCount: edits.length,
      executionId: context.executionId
    });

    try {
      // Validate input parameters
      validateEditOperations(edits);
      
      // Validate and resolve file path
      const pathInfo = await validateFilePath(filePath, this.getEffectiveCwd(context));
      const resolvedPath = pathInfo.resolvedPath;

      // Read current file content
      const originalContent = await fs.readFile(resolvedPath, 'utf8');
      const originalSize = originalContent.length;

      // Validate file content for security
      validateFileContent(originalContent, resolvedPath);


      // Apply all edit operations sequentially
      const editResult = applyMultipleEdits(resolvedPath, originalContent, edits);

      // Check if any edits were successful
      const successfulEdits = editResult.editResults.filter(r => r.success);
      
      if (successfulEdits.length === 0) {
        // No edits were applied - throw error for consistency with Edit tool
        
        throw new Error('None of the provided edits could be applied to the file');
      }

      // Write modified content to file atomically
      await writeFileAtomically(resolvedPath, editResult.modifiedContent);
      
      const finalSize = editResult.modifiedContent.length;
      const preview = createContentPreview(editResult.modifiedContent);
      
      // Generate enhanced diff with chunk separation showing all changes
      const diff = generateMultiEditDiff(originalContent, editResult.modifiedContent, resolvedPath);

      const result: MultiEditToolOutput = {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        file_path: resolvedPath,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        total_edits: edits.length,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        successful_edits: successfulEdits.length,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        edits_applied: editResult.editResults,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        file_size_before: originalSize,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        file_size_after: finalSize,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        content_preview: preview,
        diff
      };

      const duration = Date.now() - startTime;
      logger.info('MultiEdit operation completed successfully', {
        filePath: resolvedPath,
        totalEdits: edits.length,
        successfulEdits: successfulEdits.length,
        originalSize,
        finalSize,
        duration,
        executionId: context.executionId
      });

      return result;

    } catch (error) {
      logger.error('MultiEdit operation failed', error as Error, {
        filePath,
        editCount: edits.length,
        executionId: context.executionId
      });

      // Map file system errors to user-friendly messages
      const mappedError = mapFileSystemError(error, filePath);
      throw mappedError;
    }
  }
}

