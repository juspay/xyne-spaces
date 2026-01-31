import { promises as fs } from 'fs';
import path from 'path';
import { minimatch } from 'minimatch';
// LsToolInput removed - no longer needed in validation

/**
 * Validate and resolve a directory path for LS operations (absolute paths required)
 */
export function validateLsPath(inputPath: string): string {
  // Require absolute paths for LS operations
  if (!path.isAbsolute(inputPath)) {
    throw new Error('Absolute paths are required for LS operations');
  }

  // Security check: prevent path traversal before normalization
  if (inputPath.includes('..')) {
    throw new Error('Path traversal detected in path');
  }

  // Normalize the path to prevent issues
  const normalized = path.normalize(inputPath);

  return normalized;
}

/**
 * Validate ignore patterns
 */
export function validateIgnorePatterns(patterns?: string[]): string[] {
  if (!patterns) return [];

  // Validate each pattern
  for (const pattern of patterns) {
    if (typeof pattern !== 'string') {
      throw new Error('Ignore patterns must be strings');
    }
    if (pattern.length > 100) {
      throw new Error('Ignore pattern too long');
    }
    if (pattern.includes('..')) {
      throw new Error('Path traversal not allowed in ignore patterns');
    }
  }

  return patterns;
}

// validateLsOptions removed - no longer needed for simplified interface

/**
 * Check if a directory exists and is accessible
 */
export async function validateDirectory(dirPath: string): Promise<{
  exists: boolean;
  isDirectory: boolean;
  isReadable: boolean;
}> {
  try {
    const stats = await fs.stat(dirPath);
    
    // Check if it's a directory
    if (!stats.isDirectory()) {
      return {
        exists: true,
        isDirectory: false,
        isReadable: false
      };
    }

    // Check if it's readable
    try {
      await fs.access(dirPath, fs.constants.R_OK);
      return {
        exists: true,
        isDirectory: true,
        isReadable: true
      };
    } catch {
      return {
        exists: true,
        isDirectory: true,
        isReadable: false
      };
    }
  } catch {
    // Directory doesn't exist or other error
    return {
      exists: false,
      isDirectory: false,
      isReadable: false
    };
  }
}

/**
 * Check if an entry should be ignored based on patterns
 */
export function shouldIgnoreEntry(entryName: string, relativePath: string, ignorePatterns: string[]): boolean {
  if (ignorePatterns.length === 0) return false;

  return ignorePatterns.some(pattern => {
    // Check against both name and relative path
    return minimatch(entryName, pattern) || minimatch(relativePath, pattern);
  });
}

/**
 * Check if an entry is hidden
 */
export function isHiddenEntry(entryName: string): boolean {
  return entryName.startsWith('.') && entryName !== '.' && entryName !== '..';
}

/**
 * Get file extension from filename
 */
export function getFileExtension(filename: string): string | undefined {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1 || lastDot === 0 || lastDot === filename.length - 1) return undefined;
  return filename.slice(lastDot + 1).toLowerCase();
}

/**
 * Map file system errors to user-friendly messages
 */
export function mapFileSystemError(error: unknown, context: string): Error {
  if (!(error instanceof Error)) {
    return new Error(`Unknown error occurred while accessing ${context}`);
  }

  const message = error.message.toLowerCase();

  if (message.includes('enoent') || message.includes('no such file')) {
    return new Error(`Directory does not exist: ${context}`);
  }

  if (message.includes('eacces') || message.includes('permission denied')) {
    return new Error(`Permission denied: Cannot access ${context}`);
  }

  if (message.includes('enotdir')) {
    return new Error(`Not a directory: ${context}`);
  }

  if (message.includes('emfile') || message.includes('too many open files')) {
    return new Error('Too many files open. Please try again later.');
  }

  // Return original error if we can't map it
  return error;
}