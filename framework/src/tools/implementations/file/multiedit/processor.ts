import { promises as fs } from 'fs';
import type { EditOperation, EditOperationResult } from './schemas.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Core processing utilities for MultiEdit operations
 */

/**
 * Apply multiple edit operations to file content sequentially
 * Each edit operates on the result of the previous edit
 */
export function applyMultipleEdits(
  filePath: string,
  content: string,
  edits: EditOperation[]
): {
  modifiedContent: string;
  editResults: EditOperationResult[];
  successful: boolean;
} {
  let currentContent = content;
  const editResults: EditOperationResult[] = [];
  let allSuccessful = true;

  logger.debug('Starting MultiEdit operations', {
    filePath,
    editCount: edits.length,
    originalLength: content.length
  });

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i]!;
    
    try {
      const result = applySingleEdit(currentContent, edit, i);
      editResults.push(result);
      
      if (result.success) {
        currentContent = result.modifiedContent;
        logger.debug(`Edit ${i} applied successfully`, {
          occurrencesReplaced: result.occurrences_replaced,
          newLength: currentContent.length
        });
      } else {
        allSuccessful = false;
        logger.warn(`Edit ${i} failed`, {
          reason: 'No matches found for old_string'
        });
      }
    } catch (error) {
      const errorResult: EditOperationResult = {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        operation_index: i,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        old_string: edit.old_string,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        new_string: edit.new_string,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        occurrences_replaced: 0,
        success: false
      };
      editResults.push(errorResult);
      allSuccessful = false;
      
      logger.error(`Edit ${i} failed with error`, error as Error, {
        editOperation: edit
      });
      
      // Continue with remaining edits instead of stopping
    }
  }

  return {
    modifiedContent: currentContent,
    editResults,
    successful: allSuccessful
  };
}

/**
 * Apply a single edit operation to content
 */
function applySingleEdit(
  content: string,
  edit: EditOperation,
  operationIndex: number
): EditOperationResult & { modifiedContent: string } {
  const { 
     
    old_string: oldString, 
     
    new_string: newString, 
     
    replace_all: replaceAll = false 
  } = edit;

  // Check if old_string exists in content
  if (!content.includes(oldString)) {
    return {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      operation_index: operationIndex,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      old_string: oldString,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      new_string: newString,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      occurrences_replaced: 0,
      success: false,
      modifiedContent: content
    };
  }

  let modifiedContent: string;
  let occurrencesReplaced: number;

  if (replaceAll) {
    // Replace all occurrences
    const regex = new RegExp(escapeRegex(oldString), 'g');
    const matches = content.match(regex);
    occurrencesReplaced = matches?.length || 0;
    modifiedContent = content.replace(regex, newString);
  } else {
    // Replace only the first occurrence
    const index = content.indexOf(oldString);
    if (index === -1) {
      return {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        operation_index: operationIndex,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        old_string: oldString,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        new_string: newString,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        occurrences_replaced: 0,
        success: false,
        modifiedContent: content
      };
    }
    
    modifiedContent = content.substring(0, index) + 
                     newString + 
                     content.substring(index + oldString.length);
    occurrencesReplaced = 1;
  }

  return {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    operation_index: operationIndex,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    old_string: oldString,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    new_string: newString,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    occurrences_replaced: occurrencesReplaced,
    success: true,
    modifiedContent
  };
}

/**
 * Escape special regex characters for literal string replacement
 */
function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Create content preview for output
 */
export function createContentPreview(content: string): {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  first_100_chars: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  last_100_chars: string;
} {
  const contentLength = content.length;
  
  return {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    first_100_chars: content.substring(0, Math.min(100, contentLength)),
    // eslint-disable-next-line @typescript-eslint/naming-convention
    last_100_chars: contentLength > 100 
      ? content.substring(Math.max(0, contentLength - 100))
      : content
  };
}

/**
 * Write modified content back to file atomically
 */
export async function writeFileAtomically(
  filePath: string,
  content: string
): Promise<void> {
  const tempFile = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  
  try {
    // Write to temporary file first
    await fs.writeFile(tempFile, content, 'utf8');
    
    // Atomically move temp file to target location
    await fs.rename(tempFile, filePath);
    
    logger.debug('File written atomically', {
      filePath,
      contentLength: content.length
    });
  } catch (error) {
    // Clean up temp file if it exists
    try {
      await fs.unlink(tempFile);
    } catch {
      // Ignore cleanup errors
    }
    
    throw error;
  }
}

/**
 * Create backup of original file before modification
 */
export async function createBackup(filePath: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}.backup.${timestamp}`;
  
  try {
    await fs.copyFile(filePath, backupPath);
    logger.debug('Backup created', { originalFile: filePath, backupFile: backupPath });
    return backupPath;
  } catch (error) {
    logger.error('Failed to create backup', error as Error, { filePath });
    throw new Error(`Failed to create backup: ${(error as Error).message}`);
  }
}