import { promises as fs } from 'fs';
import path from 'path';
import { sanitizeFilePath } from '../../../../utils/validation.js';
// EditOperation type no longer needed for simplified interface

/**
 * Validation utilities for edit operations
 */

/**
 * Validate and normalize file path for editing (accepts both relative and absolute paths like )
 */
export function validateEditFilePath(filePath: string, cwd?: string): string {
  // Accept both absolute and relative paths like 
  // Check for path traversal attempts that go outside the current directory
  if (!path.isAbsolute(filePath)) {
    const resolved = path.resolve(cwd || process.cwd(), filePath);
    const normalized = path.normalize(resolved);
    if (!normalized.startsWith(cwd || process.cwd())) {
      throw new Error('Path traversal detected in file path');
    }
  }
  
  // Sanitize the path
  const sanitized = sanitizeFilePath(filePath);
  
  // Convert to absolute path for processing
  const resolved = path.isAbsolute(sanitized) 
    ? path.normalize(sanitized)
    : path.resolve(cwd || process.cwd(), sanitized);
  
  return resolved;
}

/**
 * Check if file exists and get its content
 */
export async function getFileContent(filePath: string): Promise<{
  exists: boolean;
  content?: string;
  size?: number;
  lastModified?: Date;
}> {
  try {
    const stats = await fs.stat(filePath);
    
    if (!stats.isFile()) {
      throw new Error('Path exists but is not a file');
    }
    
    const content = await fs.readFile(filePath, 'utf8');
    
    return {
      exists: true,
      content,
      size: stats.size,
      lastModified: stats.mtime
    };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { exists: false };
    }
    // Check for different error shapes (testing environment compatibility)
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return { exists: false };
    }
    throw error;
  }
}

// validateEditOperations removed - no longer needed for simplified  interface
// Simple validation is now handled directly in edit-tool.ts

/**
 * Validate content for potential security issues
 */
export function validateEditContent(_content: string): void {
  // Content validation removed - allowing all content
}

/**
 * Map file system errors to user-friendly messages
 */
export function mapFileSystemError(error: unknown, filePath: string): Error {
  // Handle both Error instances and error-like objects (for testing environments)
  if ((error instanceof Error && 'code' in error) || 
      (error && typeof error === 'object' && 'code' in error && 'message' in error)) {
    
    // Type-safe access to error properties
    interface ErrorWithCode {
      code: string;
      message: string;
    }
    
    const typedError = error as ErrorWithCode;
    const errorCode = typedError.code;
    const errorMessage = typedError.message || 'Unknown error';
    
    switch (errorCode) {
      case 'EACCES':
      case 'EPERM':
        return new Error(`Permission denied: Cannot read/write ${filePath}. Check file permissions.`);
      case 'ENOENT':
        return new Error(`File not found: ${filePath}. Check if the file exists and path is correct.`);
      case 'ENOSPC':
        return new Error(`No space left on device: Cannot write to ${filePath}`);
      case 'EMFILE':
      case 'ENFILE':
        return new Error(`Too many open files: Cannot access ${filePath}`);
      case 'EROFS':
        return new Error(`Read-only file system: Cannot write to ${filePath}`);
      case 'ENOTDIR':
        return new Error(`Not a directory: Parent path of ${filePath} is not a directory`);
      case 'EISDIR':
        return new Error(`Is a directory: ${filePath} is a directory, not a file`);
      case 'ENAMETOOLONG':
        return new Error(`File name too long: ${filePath}`);
      default:
        return new Error(`File system error: ${errorMessage}`);
    }
  }
  
  return new Error(`Unknown error accessing file: ${error instanceof Error ? error.message : 'Unknown error'}`);
}