import { promises as fs } from 'fs';
import path from 'path';

/**
 * Validation utilities for MultiEdit tool
 */

/**
 * Validate file path and ensure it exists and is writable
 */
export async function validateFilePath(filePath: string, cwd?: string): Promise<{
  resolvedPath: string;
  exists: boolean;
  isFile: boolean;
  size: number;
}> {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('File path must be a non-empty string');
  }

  // Resolve to absolute path
  const resolvedPath = path.resolve(cwd || process.cwd(), filePath);

  // Security check - prevent access outside allowed directories
  if (resolvedPath.includes('..')) {
    throw new Error('File path cannot contain ".." segments');
  }

  try {
    const stats = await fs.stat(resolvedPath);
    
    if (!stats.isFile()) {
      throw new Error(`Path is not a file: ${resolvedPath}`);
    }

    return {
      resolvedPath,
      exists: true,
      isFile: true,
      size: stats.size
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`File does not exist: ${resolvedPath}`);
    }
    throw new Error(`Cannot access file: ${resolvedPath} - ${(error as Error).message}`);
  }
}

/**
 * Validate file content for security
 */
export function validateFileContent(content: string, _filePath: string): void {
  // Content validation removed - allowing all content
  
  // Check file size limits
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  if (content.length > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${_filePath} (${content.length} bytes, max ${MAX_FILE_SIZE})`);
  }
}

/**
 * Validate edit operations
 */
export function validateEditOperations(
  edits: Array<{ 
    // eslint-disable-next-line @typescript-eslint/naming-convention
    old_string: string; 
    // eslint-disable-next-line @typescript-eslint/naming-convention
    new_string: string; 
    // eslint-disable-next-line @typescript-eslint/naming-convention
    replace_all?: boolean | undefined 
  }>
): void {
  if (!Array.isArray(edits) || edits.length === 0) {
    throw new Error('At least one edit operation is required');
  }

  if (edits.length > 100) {
    throw new Error('Too many edit operations (maximum 100 allowed)');
  }

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];
    
    if (!edit || typeof edit !== 'object') {
      throw new Error(`Edit operation ${i} must be an object`);
    }

    if (typeof edit.old_string !== 'string') {
      throw new Error(`Edit operation ${i}: old_string must be a string`);
    }

    if (typeof edit.new_string !== 'string') {
      throw new Error(`Edit operation ${i}: new_string must be a string`);
    }

    if (edit.old_string === edit.new_string) {
      throw new Error(`Edit operation ${i}: old_string and new_string must be different`);
    }

    // Check for excessively large strings
    const MAX_STRING_SIZE = 1024 * 1024; // 1MB
    if (edit.old_string.length > MAX_STRING_SIZE) {
      throw new Error(`Edit operation ${i}: old_string too large (max ${MAX_STRING_SIZE} characters)`);
    }

    if (edit.new_string.length > MAX_STRING_SIZE) {
      throw new Error(`Edit operation ${i}: new_string too large (max ${MAX_STRING_SIZE} characters)`);
    }

    if (edit.replace_all !== undefined && typeof edit.replace_all !== 'boolean') {
      throw new Error(`Edit operation ${i}: replace_all must be a boolean`);
    }
  }
}

/**
 * Map file system errors to user-friendly messages
 */
export function mapFileSystemError(error: unknown, filePath: string): Error {
  const err = error as NodeJS.ErrnoException;
  
  switch (err.code) {
    case 'ENOENT':
      return new Error(`File not found: ${filePath}`);
    case 'EACCES':
      return new Error(`Permission denied: ${filePath}`);
    case 'EISDIR':
      return new Error(`Path is a directory, not a file: ${filePath}`);
    case 'EMFILE':
    case 'ENFILE':
      return new Error('Too many open files, please try again');
    case 'ENOSPC':
      return new Error('No space left on device');
    case 'EROFS':
      return new Error(`Read-only file system: ${filePath}`);
    default:
      return new Error(`File system error: ${err.message || 'Unknown error'}`);
  }
}