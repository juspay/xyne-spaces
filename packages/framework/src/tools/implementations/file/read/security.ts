import { promises as fs } from 'fs';
import path from 'path';
import { sanitizeFilePath } from '../../../../utils/validation.js';

/**
 * Security utilities for file operations
 */

/**
 * Validate and normalize file path (accepts both relative and absolute paths like )
 */
export function validateFilePath(filePath: string, cwd?: string): string {
  // Accept both absolute and relative paths like 
  // Only check for path traversal in relative paths
  if (!path.isAbsolute(filePath) && (filePath.includes('../') || filePath.includes('..\\') || filePath === '..')) {
    throw new Error('Path traversal detected in file path');
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
 * Check if file size is within limits before reading
 */
export async function validateFileSize(filePath: string, maxSize: number): Promise<void> {
  try {
    const stats = await fs.stat(filePath);
    
    if (!stats.isFile()) {
      throw new Error('Path does not point to a file');
    }
    
    if (stats.size > maxSize) {
      throw new Error(`File size (${stats.size} bytes) exceeds maximum allowed size (${maxSize} bytes)`);
    }
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Failed to validate file size');
  }
}

/**
 * Detect if a file appears to be a text file based on content
 */
export function isTextFile(content: Buffer): boolean {
  // Check for binary content indicators
  const firstKB = content.subarray(0, 1024);
  
  // Look for null bytes (common in binary files)
  for (let i = 0; i < firstKB.length; i++) {
    if (firstKB[i] === 0) {
      return false;
    }
  }
  
  // Check for high ratio of control characters
  let controlChars = 0;
  for (let i = 0; i < firstKB.length; i++) {
    const byte = firstKB[i];
    // Count control characters except common ones (tab, newline, carriage return)
    if (byte !== undefined && byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
      controlChars++;
    }
  }
  
  // If more than 10% are control characters, likely binary
  const controlRatio = controlChars / firstKB.length;
  return controlRatio < 0.1;
}

/**
 * Get file metadata safely
 */
export async function getFileMetadata(filePath: string): Promise<{
  size: number;
  lastModified: Date;
  isFile: boolean;
}> {
  try {
    const stats = await fs.stat(filePath);
    
    return {
      size: stats.size,
      lastModified: stats.mtime,
      isFile: stats.isFile()
    };
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      if (error.code === 'ENOENT') {
        throw new Error(`File not found: ${filePath}`);
      }
      if (error.code === 'EACCES') {
        throw new Error(`Permission denied: ${filePath}`);
      }
    }
    throw new Error(`Failed to read file metadata: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}