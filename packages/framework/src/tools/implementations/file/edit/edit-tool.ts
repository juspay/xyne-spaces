import { promises as fs } from 'fs';
import type { ToolExecutionContext, ToolExecutionResult } from '../../../core/types/tool.js';
import { BaseTool } from '../../../core/base-tool.js';
import { Tool } from '../../../core/decorators.js';
import { logger } from '../../../../utils/logger.js';
import { 
  EditToolInputSchema, 
  EditToolOutputSchema,
  EditToolLLMOutputSchema,
  type EditToolInput,
  type EditToolOutput,
  type EditToolLLMOutput
} from './schemas.js';
import { 
  validateEditFilePath,
  getFileContent,
  validateEditContent
} from './validation.js';
import { generateGitStyleDiff } from '../../../../utils/diff-generator.js';

/**
 * EditTool for simple find-and-replace operations - simplified to match  exactly
 * Features:
 * - Simple find/replace operations 
 * - Git-style diff generation with line numbers
 * - Automatic file creation if file doesn't exist
 * - Replace all or just first occurrence
 * - Rich metadata output while keeping simple interface
 */
@Tool({
  name: 'edit',
  description: 'Performs exact string replacements in files. The edit will FAIL if `old_string` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use `replace_all` to change every instance of `old_string`.',
  inputSchema: EditToolInputSchema,
  outputSchema: EditToolOutputSchema,
  llmOutputSchema: EditToolLLMOutputSchema,
  version: '1.0.0',
  tags: ['file', 'edit', 'replace', 'modify'],
  category: 'file'
})
export class EditTool extends BaseTool<EditToolInput, EditToolOutput, EditToolLLMOutput> {
  protected readonly inputSchema = EditToolInputSchema;
  protected readonly outputSchema = EditToolOutputSchema;
  protected readonly toolName = 'edit';

  /**
   * Extract minimal content for LLM - just message and diff
   */
  public getLLMOutput(result: ToolExecutionResult<EditToolOutput>): EditToolLLMOutput {
    if (!result.success) {
      return {
        error: result.error?.message || 'Edit failed'
      };
    }

    if (!result.data) {
      return {
        error: 'No data returned from edit operation'
      };
    }

    return {
      message: 'File updated successfully'
    };
  }

  /**
   * Execute file editing with simple find/replace - compatible
   */
  protected async executeInternal(
    input: EditToolInput,
    context: ToolExecutionContext
  ): Promise<EditToolOutput> {
    
    // Apply defaults (match behavior)
    const encoding = 'utf8'; // Always UTF-8 like 
    const replaceAll = input.replace_all ?? false;

    logger.debug('Starting file edit operation', {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      file_path: input.file_path,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      old_string_length: input.old_string.length,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      new_string_length: input.new_string.length,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      replace_all: replaceAll,
      executionId: context.executionId
    });

    try {
      // Validate and resolve file path (supports both relative and absolute)
      const resolvedPath = validateEditFilePath(input.file_path, this.getEffectiveCwd(context));
      
      // Validate that old_string and new_string are different
      if (input.old_string === input.new_string) {
        throw new Error('old_string and new_string must be different');
      }
      
      // Note: Empty old_string is allowed for new file creation (replacing empty content)
      
      // Get existing file information
      const fileInfo = await getFileContent(resolvedPath);
      
      // Handle file existence
      const fileExists = fileInfo.exists;
      
      if (!fileExists) {
        throw new Error(`File does not exist: ${resolvedPath}`);
      }
      
      const originalContent = fileInfo.content || '';
      
      // Validate original content for security issues
      if (originalContent.length > 0) {
        validateEditContent(originalContent);
      }
      
      // Perform find/replace operation
      let newContent: string;
      let replacementsMade = 0;
      
      // Special case: empty old_string means we're creating/adding content
      if (input.old_string === '') {
        newContent = originalContent + input.new_string;
        replacementsMade = 1;
      } else if (replaceAll) {
        // Replace all occurrences
        const regex = new RegExp(escapeRegex(input.old_string), 'g');
        const matches = originalContent.match(regex);
        replacementsMade = matches ? matches.length : 0;
        
        if (replacementsMade === 0) {
          throw new Error('old_string not found in file');
        }
        
        newContent = originalContent.replace(regex, input.new_string);
      } else {
        // Replace only first occurrence
        const index = originalContent.indexOf(input.old_string);
        if (index !== -1) {
          // Check if the string appears multiple times when replace_all is false
          const secondIndex = originalContent.indexOf(input.old_string, index + input.old_string.length);
          if (secondIndex !== -1) {
            throw new Error(`old_string appears multiple times in the file. Use replace_all=true to replace all occurrences, or provide a more specific string that appears only once.`);
          }
          
          newContent = originalContent.substring(0, index) + 
                      input.new_string + 
                      originalContent.substring(index + input.old_string.length);
          replacementsMade = 1;
        } else {
          throw new Error('old_string not found in file');
        }
      }
      
      // Check if content actually changed
      const contentChanged = originalContent !== newContent;
      
      // Validate final content for security issues
      validateEditContent(newContent);
      
      // Generate git-style diff with line numbers
      const diff = generateGitStyleDiff(originalContent, newContent, input.file_path);
      
      // Write the file only if content changed
      if (contentChanged) {
        await fs.writeFile(resolvedPath, newContent, { encoding });
      }
      
      // Get file stats after writing
      const stats = await fs.stat(resolvedPath);
      const bytesWritten = Buffer.byteLength(newContent, encoding);
      
      // Ensure lastModified is a proper Date object
      const lastModified = stats.mtime instanceof Date ? stats.mtime : new Date(stats.mtime);
      
      const result: EditToolOutput = {
        // ✅ CORE:  compatible output
        success: true,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        replacements_made: replacementsMade,
        
        // ✅ ENHANCED: Git-style diff (better than )
        diff,
        
        // ✅ KEEP: Useful metadata
        fileExists,
        fileCreated: false,
        originalContent: originalContent,
        newContent,
        contentChanged,
        bytesWritten,
        lastModified
        
        // ❌ REMOVED: Input echoes (file_path, old_string, new_string)
      };

      logger.info('File edit operation completed', {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        file_path: resolvedPath,
        replacementsMade,
        contentChanged,
        fileCreated: false,
        executionId: context.executionId
      });

      return result;

    } catch (error) {
      logger.error('File edit operation failed', error as Error, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        file_path: input.file_path,
        executionId: context.executionId
      });

      // Throw error like other tools do
      throw error instanceof Error ? error : new Error('Unknown error occurred');
    }
  }
}

/**
 * Escape special regex characters for literal string matching
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

