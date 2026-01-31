import { promises as fs } from 'fs';
import path from 'path';
import type { GlobDetailedMatch, GlobStats, GlobToolInput } from './schemas.js';
import { shouldIgnorePath, getFileInfo, globToRegex, loadGitignorePatterns } from './validation.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Glob processing utilities for pattern matching and file discovery
 */

/**
 * Recursively find files matching the glob pattern
 */
export async function findGlobMatches(
  searchPath: string,
  pattern: string,
  options: {
    followSymlinks?: boolean;
    ignoreHidden?: boolean;
    maxDepth?: number;
    limit?: number;
  }
): Promise<{ matches: GlobDetailedMatch[]; stats: Omit<GlobStats, 'searchDuration'>; truncated: boolean }> {
  const matches: GlobDetailedMatch[] = [];
  const regex = globToRegex(pattern);
  let directoriesSearched = 0;
  let totalMatches = 0;
  let truncated = false;
  
  const { followSymlinks = false } = options;
  const limit = 100; // Hardcoded limit of 100 results
  
  // Load .gitignore patterns from the search root
  const gitignorePatterns = await loadGitignorePatterns(searchPath);
  
  logger.debug('Loaded gitignore patterns for glob search', {
    searchPath,
    patternCount: gitignorePatterns.length,
    patterns: gitignorePatterns.slice(0, 5) // Log first 5 patterns for debugging
  });
  
  async function searchDirectory(currentPath: string): Promise<void> {
    // Check if we should stop due to limit
    if (limit && totalMatches >= limit) {
      truncated = true;
      return;
    }
    
    try {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });
      directoriesSearched++;
      
      for (const entry of entries) {
        // Check if we should stop due to limit
        if (limit && totalMatches >= limit) {
          truncated = true;
          return;
        }
        
        const fullPath = path.join(currentPath, entry.name);
        
        // Check if we should ignore this path
        if (shouldIgnorePath(fullPath, { 
          ...options, 
          basePath: searchPath, 
          gitignorePatterns,
          isDirectory: entry.isDirectory() 
        })) {
          continue;
        }
        
        // Handle symbolic links
        if (entry.isSymbolicLink()) {
          if (!followSymlinks) {
            continue;
          }
          
          try {
            const realPath = await fs.realpath(fullPath);
            const realStats = await fs.stat(realPath);
            
            if (realStats.isDirectory()) {
              await searchDirectory(fullPath);
            } else if (realStats.isFile()) {
              await processFile(fullPath);
            }
          } catch (error) {
            logger.warn('Error following symlink', {
              symlink: fullPath,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        } else if (entry.isDirectory()) {
          // Check if directory name matches pattern
          const relativePath = path.relative(searchPath, fullPath);
          if (regex.test(relativePath) || regex.test(relativePath + '/')) {
            try {
              const fileInfo = await getFileInfo(fullPath, searchPath);
              matches.push(fileInfo);
              totalMatches++;
            } catch (error) {
              logger.warn('Error getting directory info', {
                directory: fullPath,
                error: error instanceof Error ? error.message : String(error)
              });
            }
          }
          
          // Recursively search subdirectory
          await searchDirectory(fullPath);
        } else if (entry.isFile()) {
          await processFile(fullPath);
        }
      }
    } catch (error) {
      logger.warn('Error reading directory', {
        directory: currentPath,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  
  async function processFile(filePath: string): Promise<void> {
    try {
      const relativePath = path.relative(searchPath, filePath);
      
      // Test if file matches the glob pattern
      if (regex.test(relativePath)) {
        const fileInfo = await getFileInfo(filePath, searchPath);
        matches.push(fileInfo);
        totalMatches++;
      }
    } catch (error) {
      logger.warn('Error processing file', {
        file: filePath,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  
  // Start the search
  await searchDirectory(searchPath);
  
  // Sort matches by path for consistent output
  matches.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  
  return {
    matches,
    stats: {
      totalMatches,
      directoriesSearched,
      pattern,
      searchPath: path.resolve(searchPath),
      truncated
    },
    truncated
  };
}

/**
 * Generate glob statistics with timing
 */
export function generateGlobStats(
  baseStats: Omit<GlobStats, 'searchDuration'>,
  searchDuration: number
): GlobStats {
  return {
    ...baseStats,
    searchDuration: Math.max(1, searchDuration) // Ensure minimum 1ms
  };
}

/**
 * Validate glob input options - simplified for  compatibility
 */
export function validateGlobOptions(_input: GlobToolInput): void {
  // For simplified interface, no complex validation needed
  // Pattern and path validation handled in validation.ts
}

/**
 * Filter and limit matches based on options
 */
export function processGlobResults(
  matches: GlobDetailedMatch[],
  limit?: number
): { finalMatches: GlobDetailedMatch[]; truncated: boolean } {
  let finalMatches = matches;
  let truncated = false;
  
  if (limit && matches.length > limit) {
    finalMatches = matches.slice(0, limit);
    truncated = true;
  }
  
  return { finalMatches, truncated };
}

/**
 * Check if we should stop searching due to performance limits
 */
export function shouldStopSearch(
  matchCount: number,
  directoriesSearched: number,
  limit?: number
): boolean {
  // Stop if we've reached the match limit
  if (limit && matchCount >= limit) {
    return true;
  }
  
  // Stop if we've searched too many directories (safety limit)
  if (directoriesSearched > 10000) {
    logger.warn('Search stopped due to directory limit', {
      directoriesSearched,
      maxDirectories: 10000
    });
    return true;
  }
  
  return false;
}

/**
 * Estimate search complexity and warn if potentially expensive
 */
export function analyzeGlobPattern(pattern: string, searchPath: string): {
  isExpensive: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  let isExpensive = false;
  
  // Check for recursive patterns
  if (pattern.includes('**/')) {
    const recursiveCount = (pattern.match(/\*\*/g) || []).length;
    if (recursiveCount > 2) {
      warnings.push('Pattern contains multiple recursive wildcards which may be slow');
      isExpensive = true;
    }
  }
  
  // Check for patterns that start with **
  if (pattern.startsWith('**/')) {
    warnings.push('Pattern starts with ** which searches the entire directory tree');
    isExpensive = true;
  }
  
  // Check for very broad patterns
  if (pattern === '**' || pattern === '**/*' || pattern === '**/**') {
    warnings.push('Very broad pattern may return many results and be slow');
    isExpensive = true;
  }
  
  // Check if searching from root-like directories
  const resolvedPath = path.resolve(searchPath);
  if (resolvedPath === '/' || resolvedPath.match(/^[A-Z]:\\?$/)) {
    warnings.push('Searching from root directory may be very slow');
    isExpensive = true;
  }
  
  return { isExpensive, warnings };
}