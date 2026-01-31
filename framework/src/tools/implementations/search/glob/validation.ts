import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../../../../utils/logger.js';

/**
 * Validation and security utilities for glob operations
 */

/**
 * Simple gitignore pattern matcher
 */
class GitignorePattern {
  private pattern: string;
  private isNegation: boolean;
  private isDirectory: boolean;
  private regex: RegExp;

  constructor(pattern: string) {
    this.pattern = pattern.trim();
    this.isNegation = this.pattern.startsWith('!');
    this.isDirectory = this.pattern.endsWith('/');
    
    if (this.isNegation) {
      this.pattern = this.pattern.slice(1);
    }
    
    if (this.isDirectory) {
      this.pattern = this.pattern.slice(0, -1);
    }

    // Convert gitignore pattern to regex
    this.regex = this.createRegex();
  }

  private createRegex(): RegExp {
    let regexPattern = this.pattern;
    
    // Escape special regex characters except * and ?
    regexPattern = regexPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    
    // Convert gitignore wildcards to regex
    regexPattern = regexPattern.replace(/\\\*/g, '[^/]*'); // * matches anything except /
    regexPattern = regexPattern.replace(/\\\?/g, '[^/]'); // ? matches single char except /
    regexPattern = regexPattern.replace(/\*\*/g, '.*'); // ** matches anything including /
    
    // Handle leading slash (absolute path from repo root)
    if (regexPattern.startsWith('/')) {
      regexPattern = '^' + regexPattern.slice(1);
    } else {
      // For patterns without leading slash, match anywhere in the path
      regexPattern = '(^|/)' + regexPattern;
    }
    
    // Handle trailing patterns
    if (this.isDirectory) {
      // For directory patterns, match the directory and anything inside it
      regexPattern = regexPattern + '(/|$)';
    } else if (!regexPattern.includes('/')) {
      // For simple name patterns, allow them to appear anywhere
      regexPattern = regexPattern + '(/.*)?$';
    } else {
      // For specific file paths
      regexPattern = regexPattern + '$';
    }
    
    return new RegExp(regexPattern);
  }

  matches(filePath: string, _isDir: boolean): boolean {
    // Directory vs file distinction is now handled in the regex pattern itself
    return this.regex.test(filePath);
  }

  get isNegationPattern(): boolean {
    return this.isNegation;
  }
}

/**
 * Load and parse .gitignore file
 */
export async function loadGitignorePatterns(basePath: string): Promise<GitignorePattern[]> {
  const gitignorePath = path.join(basePath, '.gitignore');
  
  try {
    const content = await fs.readFile(gitignorePath, 'utf8');
    const lines = content.split('\n');
    const patterns: GitignorePattern[] = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      // Skip empty lines and comments
      if (trimmed === '' || trimmed.startsWith('#')) {
        continue;
      }
      patterns.push(new GitignorePattern(trimmed));
    }
    
    logger.debug('Loaded .gitignore patterns', { 
      gitignorePath, 
      patternCount: patterns.length 
    });
    
    return patterns;
  } catch (error) {
    // .gitignore file doesn't exist or can't be read
    logger.debug('No .gitignore file found or error reading it', { 
      gitignorePath, 
      error: error instanceof Error ? error.message : String(error) 
    });
    return [];
  }
}

/**
 * Check if a file should be ignored based on gitignore patterns
 */
export function isGitIgnored(
  filePath: string, 
  basePath: string, 
  gitignorePatterns: GitignorePattern[], 
  isDirectory: boolean
): boolean {
  if (gitignorePatterns.length === 0) {
    return false;
  }
  
  const relativePath = path.relative(basePath, filePath);
  
  // Start with not ignored
  let ignored = false;
  
  // Apply patterns in order (later patterns can override earlier ones)
  for (const pattern of gitignorePatterns) {
    if (pattern.matches(relativePath, isDirectory)) {
      ignored = !pattern.isNegationPattern;
    }
  }
  
  return ignored;
}

/**
 * Validate and resolve search path (accepts both relative and absolute paths  )
 */
export function validateGlobPath(inputPath?: string): string {
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
 * Validate glob pattern (minimal validation)
 */
export function validateGlobPattern(pattern: string): void {
  // Basic safety check only
  if (pattern.length > 2000) {
    throw new Error('Pattern too long (maximum 2000 characters)');
  }
}

/**
 * Check if a path should be ignored based on options
 */
export function shouldIgnorePath(
  filePath: string,
  options: {
    ignoreHidden?: boolean;
    maxDepth?: number;
    basePath: string;
    gitignorePatterns?: GitignorePattern[];
    isDirectory?: boolean;
  }
): boolean {
  const { ignoreHidden = true, maxDepth, basePath, gitignorePatterns = [], isDirectory = false } = options;
  
  // Check for hidden files/directories
  if (ignoreHidden) {
    const parts = path.relative(basePath, filePath).split(path.sep);
    for (const part of parts) {
      if (part.startsWith('.') && part !== '.' && part !== '..') {
        return true;
      }
    }
  }
  
  // Check gitignore patterns
  if (gitignorePatterns.length > 0) {
    if (isGitIgnored(filePath, basePath, gitignorePatterns, isDirectory)) {
      return true;
    }
  }
  
  // Check depth limit
  if (maxDepth !== undefined) {
    const relativePath = path.relative(basePath, filePath);
    if (relativePath === '.') {
      return false; // Base path itself is always allowed
    }
    const pathParts = relativePath.split(path.sep).filter(part => part !== '');
    const depth = pathParts.length;
    if (depth > maxDepth) {
      return true;
    }
  }
  
  return false;
}

/**
 * Get file information safely
 */
export async function getFileInfo(filePath: string, basePath: string): Promise<{
  path: string;
  relativePath: string;
  size: number;
  lastModified: Date;
  isDirectory: boolean;
  isFile: boolean;
  extension?: string;
}> {
  try {
    const stats = await fs.stat(filePath);
    const relativePath = path.relative(basePath, filePath);
    const extension = path.extname(filePath).slice(1); // Remove leading dot
    
    const result: {
      path: string;
      relativePath: string;
      size: number;
      lastModified: Date;
      isDirectory: boolean;
      isFile: boolean;
      extension?: string;
    } = {
      path: filePath,
      relativePath,
      size: stats.size,
      lastModified: stats.mtime instanceof Date ? stats.mtime : new Date(stats.mtime),
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile()
    };

    if (extension) {
      result.extension = extension;
    }

    return result;
  } catch (error) {
    logger.warn('Error getting file info', {
      filePath,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

/**
 * Check if directory exists and is readable
 */
export async function validateSearchDirectory(dirPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(dirPath);
    return stats.isDirectory();
  } catch (error: unknown) {
    // Check for file not found error
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/**
 * Convert glob pattern to RegExp for matching
 */
export function globToRegex(globPattern: string): RegExp {
  let regexPattern = '';
  let i = 0;
  
  while (i < globPattern.length) {
    const char = globPattern[i];
    
    if (!char) {
      i++;
      continue;
    }
    
    if (char === '*') {
      if (globPattern[i + 1] === '*') {
        // Handle ** for recursive directory matching
        if (globPattern[i + 2] === '/') {
          regexPattern += '(?:.*/)?';
          i += 3;
        } else {
          regexPattern += '.*';
          i += 2;
        }
      } else {
        // Single * matches anything except path separator
        regexPattern += '[^/]*';
        i++;
      }
    } else if (char === '?') {
      regexPattern += '[^/]';
      i++;
    } else if (char === '[') {
      // Handle character classes [abc] or [a-z]
      const closingBracket = globPattern.indexOf(']', i);
      if (closingBracket !== -1) {
        let charClass = globPattern.slice(i, closingBracket + 1);
        // Escape special regex chars in character class if needed
        charClass = charClass.replace(/\\/g, '\\\\');
        regexPattern += charClass;
        i = closingBracket + 1;
      } else {
        regexPattern += '\\[';
        i++;
      }
    } else if (char === '{') {
      // Handle brace expansion {js,ts}
      const closingBrace = globPattern.indexOf('}', i);
      if (closingBrace !== -1) {
        const options = globPattern.slice(i + 1, closingBrace);
        regexPattern += `(${options.replace(/,/g, '|')})`;
        i = closingBrace + 1;
      } else {
        regexPattern += '\\{';
        i++;
      }
    } else if (/[.+^${}()|[\]\\]/.test(char)) {
      regexPattern += '\\' + char;
      i++;
    } else {
      regexPattern += char;
      i++;
    }
  }
  
  return new RegExp(`^${regexPattern}$`, 'i');
}

/**
 * Map file system errors to user-friendly messages
 */
export function mapFileSystemError(error: unknown, context: string): Error {
  if (error instanceof Error) {
    if ('code' in error) {
      switch (error.code) {
        case 'ENOENT':
          return new Error(`Directory not found: ${context}`);
        case 'EACCES':
          return new Error(`Permission denied: ${context}`);
        case 'ENOTDIR':
          return new Error(`Not a directory: ${context}`);
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