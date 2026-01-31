import { promises as fs } from 'fs';
import path from 'path';
import { sanitizeFilePath } from '../../../../utils/validation.js';

/**
 * Security utilities for file write operations
 */

/**
 * Validate and normalize file path for writing (accepts both relative and absolute paths like )
 */
export function validateWriteFilePath(filePath: string, cwd?: string): string {
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
  
  // Check for dangerous file extensions
  const dangerousExtensions: string[] = [
    // Removed all restrictions to allow any file extension
  ];
  
  const fileExtension = path.extname(resolved).toLowerCase();
  if (dangerousExtensions.includes(fileExtension)) {
    throw new Error(`Writing files with extension ${fileExtension} is not allowed for security reasons`);
  }
  
  // Check for sensitive file names
  const fileName = path.basename(resolved).toLowerCase();
  const sensitiveFiles = [
    'passwd', 'shadow', 'hosts', 'resolv.conf',
    '.bashrc', '.profile', '.zshrc', '.bash_profile',
    'authorized_keys', 'known_hosts', 'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519'
  ];
  
  if (sensitiveFiles.includes(fileName)) {
    throw new Error(`Writing to sensitive file ${fileName} is not allowed`);
  }
  
  return resolved;
}

/**
 * Create parent directories if they don't exist
 */
export async function ensureDirectoryExists(filePath: string): Promise<boolean> {
  const dirPath = path.dirname(filePath);
  
  try {
    await fs.access(dirPath);
    return false; // Directory already existed
  } catch {
    // Directory doesn't exist, create it
    await fs.mkdir(dirPath, { recursive: true });
    return true; // Directory was created
  }
}

/**
 * Check if file exists and get its current content
 */
export async function getExistingFileInfo(filePath: string): Promise<{
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
    // Check for different error shapes
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return { exists: false };
    }
    throw error;
  }
}

/**
 * Validate content for potential security issues
 */
export function validateFileContent(_content: string): void {
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
        return new Error(`Permission denied: Cannot write to ${filePath}. Use terminal to write file if required.`);
      case 'ENOENT':
        return new Error(`ENOENT: No such file or directory: ${filePath}. Parent directory may not exist.`);
      case 'ENOSPC':
        return new Error(`No space left on device: Cannot write to ${filePath}`);
      case 'EMFILE':
      case 'ENFILE':
        return new Error(`Too many open files: Cannot write to ${filePath}`);
      case 'EROFS':
        return new Error(`Read-only file system: Cannot write to ${filePath}`);
      case 'ENOTDIR':
        return new Error(`Not a directory: Parent path of ${filePath} is not a directory`);
      case 'EISDIR':
        return new Error(`Is a directory: ${filePath} is a directory, not a file`);
      case 'ENAMETOOLONG':
        return new Error(`File name too long: ${filePath}`);
      default:
        return new Error(`File system error: ${errorMessage}. Use terminal to write file if required.`);
    }
  }
  
  return new Error(`Unknown error writing file: ${error instanceof Error ? error.message : 'Unknown error'}. Use terminal to write file if required.`);
}