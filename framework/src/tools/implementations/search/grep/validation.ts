import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../../../../utils/logger.js';

/**
 * Validation and security utilities for grep operations
 */

/**
 * Validate and resolve search path (accepts both relative and absolute paths  )
 */
export function validateSearchPath(inputPath?: string): string {
  const resolvedPath = inputPath || '.';
  
  // Check for path traversal attempts in relative paths only
  if (inputPath && !path.isAbsolute(inputPath) && (inputPath.includes('../') || inputPath.includes('..\\') || inputPath === '..')) {
    throw new Error('Path traversal detected in search path');
  }
  
  // Convert to absolute path for processing
  const absolutePath = path.isAbsolute(resolvedPath) 
    ? path.normalize(resolvedPath)
    : path.resolve(resolvedPath);

  return absolutePath;
}

/**
 * Validate regex pattern (minimal validation - let ripgrep handle pattern validation)
 */
export function validatePattern(pattern: string): void {
  // Basic safety checks only
  if (pattern.length > 5000) {
    throw new Error('Pattern too long (maximum 5000 characters)');
  }

  // Test if the regex is valid (keep this as it's a basic sanity check)
  try {
    new RegExp(pattern);
  } catch (error) {
    throw new Error(`Invalid regex pattern: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Validate file type filter (minimal validation - let ripgrep handle type validation)
 */
export function validateFileType(fileType?: string): string[] {
  if (!fileType) {
    return [];
  }

  // Basic safety check only
  if (fileType.length > 200) {
    throw new Error('File type parameter too long (maximum 200 characters)');
  }

  // Let ripgrep handle the actual file type validation
  return [];
}

/**
 * Validate glob pattern (minimal validation - let ripgrep handle glob validation)
 */
export function validateGlobPattern(globPattern?: string): void {
  if (!globPattern) {
    return;
  }

  // Basic safety check only
  if (globPattern.length > 1000) {
    throw new Error('Glob pattern too long (maximum 1000 characters)');
  }
}

/**
 * Check if a file should be searched based on filters
 */
export function shouldSearchFile(
  filePath: string, 
  typeExtensions: string[], 
  globPattern?: string
): boolean {
  const fileExtension = path.extname(filePath).toLowerCase();
  
  // Check type filter
  if (typeExtensions.length > 0) {
    if (!typeExtensions.includes(fileExtension)) {
      return false;
    }
  }
  
  // Check glob filter (simplified implementation)
  if (globPattern) {
    const fileName = path.basename(filePath);
    const regex = globPatternToRegex(globPattern);
    if (!regex.test(fileName)) {
      return false;
    }
  }
  
  return true;
}

/**
 * Convert glob pattern to regex (simplified implementation)
 */
function globPatternToRegex(globPattern: string): RegExp {
  let regexPattern = '';
  
  for (let i = 0; i < globPattern.length; i++) {
    const char = globPattern[i];
    
    if (!char) continue;
    
    if (char === '*') {
      regexPattern += '.*';
    } else if (char === '?') {
      regexPattern += '.';
    } else if (char === '{') {
      // Handle {js,ts} pattern
      const closingBrace = globPattern.indexOf('}', i);
      if (closingBrace !== -1) {
        const options = globPattern.slice(i + 1, closingBrace);
        regexPattern += `(${options.replace(/,/g, '|')})`;
        i = closingBrace; // Skip to closing brace
      } else {
        regexPattern += '\\{';
      }
    } else if (/[.+^${}()|[\]\\]/.test(char)) {
      regexPattern += '\\' + char;
    } else {
      regexPattern += char;
    }
  }
  
  return new RegExp(`^${regexPattern}$`, 'i');
}

/**
 * Get file information safely
 */
export async function getFileInfo(filePath: string): Promise<{ exists: boolean; isFile: boolean; isDirectory: boolean }> {
  try {
    const stats = await fs.stat(filePath);
    return {
      exists: true,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory()
    };
  } catch (error: unknown) {
    // Check for file not found error
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return {
        exists: false,
        isFile: false,
        isDirectory: false
      };
    }
    throw error;
  }
}

/**
 * Recursively find files in directory
 */
export async function findFiles(
  dirPath: string, 
  typeExtensions: string[], 
  globPattern?: string
): Promise<string[]> {
  const files: string[] = [];
  
  async function walkDir(currentPath: string): Promise<void> {
    try {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        
        if (entry.isDirectory()) {
          // Skip hidden directories and common build/cache directories
          if (!entry.name.startsWith('.') && 
              !['node_modules', 'dist', 'build', 'coverage', '.git'].includes(entry.name)) {
            await walkDir(fullPath);
          }
        } else if (entry.isFile()) {
          if (shouldSearchFile(fullPath, typeExtensions, globPattern)) {
            files.push(fullPath);
          }
        }
      }
    } catch (error) {
      logger.warn('Error reading directory', {
        directory: currentPath,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  
  await walkDir(dirPath);
  return files;
}

/**
 * Map file system errors to user-friendly messages
 */
export function mapFileSystemError(error: unknown, context: string): Error {
  if (error instanceof Error) {
    if ('code' in error) {
      switch (error.code) {
        case 'ENOENT':
          return new Error(`File or directory not found: ${context}`);
        case 'EACCES':
          return new Error(`Permission denied: ${context}`);
        case 'EISDIR':
          return new Error(`Expected file but found directory: ${context}`);
        case 'EMFILE':
        case 'ENFILE':
          return new Error('Too many open files. Try reducing search scope.');
        default:
          return new Error(`File system error: ${error.message}`);
      }
    }
    return error;
  }
  
  return new Error(`Unknown error: ${String(error)}`);
}