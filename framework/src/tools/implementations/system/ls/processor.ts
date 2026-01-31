import { promises as fs } from 'fs';
import path from 'path';
import type { LsDetailedEntry, LsStats } from './schemas.js';
// LsToolInput removed - no longer needed in processor
import { 
  shouldIgnoreEntry, 
  isHiddenEntry, 
  getFileExtension 
} from './validation.js';
import { logger } from '../../../../utils/logger.js';

/**
 * List entries in a directory
 */
export async function listDirectory(
  dirPath: string,
  options: {
    showHidden?: boolean;
    recursive?: boolean;
    maxDepth?: number;
    ignorePatterns?: string[];
    includeSize?: boolean;
    // includePermissions, includeOwner removed for simplified interface
  },
  currentDepth = 0,
  cwd?: string
): Promise<{ entries: LsDetailedEntry[]; stats: Partial<LsStats> }> {
  const {
    showHidden = false,
    recursive = false,
    maxDepth,
    ignorePatterns = [],
    includeSize = true
    // includePermissions, includeOwner removed for simplified interface
  } = options;

  const entries: LsDetailedEntry[] = [];
  let filesCount = 0;
  let directoriesCount = 0;
  let symlinksCount = 0;
  let hiddenCount = 0;
  let totalSize = 0;

  try {
    const dirEntries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const dirEntry of dirEntries) {
      const entryName = dirEntry.name;
      const fullPath = path.join(dirPath, entryName);
      const relativePath = path.relative(cwd || process.cwd(), fullPath);

      // Check if entry should be ignored
      if (shouldIgnoreEntry(entryName, relativePath, ignorePatterns)) {
        continue;
      }

      // Check if entry is hidden
      const isHidden = isHiddenEntry(entryName);
      if (isHidden && !showHidden) {
        continue;
      }

      if (isHidden) {
        hiddenCount++;
      }

      try {
        const stats = await fs.stat(fullPath);
        
        // Determine entry type
        let entryType: 'file' | 'directory' | 'symlink' | 'other';
        if (dirEntry.isSymbolicLink()) {
          entryType = 'symlink';
          symlinksCount++;
        } else if (dirEntry.isDirectory()) {
          entryType = 'directory';
          directoriesCount++;
        } else if (dirEntry.isFile()) {
          entryType = 'file';
          filesCount++;
          if (includeSize) {
            totalSize += stats.size;
          }
        } else {
          entryType = 'other';
        }

        // Create entry object (simplified for  compatibility)
        const entry: LsDetailedEntry = {
          name: entryName,
          type: entryType,
          modified: new Date(stats.mtime),
          isHidden
          // path, relativePath removed from simplified schema
        };

        // Add optional fields
        if (includeSize && entryType === 'file') {
          entry.size = stats.size;
        }

        if (entryType === 'file') {
          entry.extension = getFileExtension(entryName);
        }

        // permissions and owner removed from simplified schema for  compatibility

        entries.push(entry);

        // Recursively process subdirectories if requested
        if (recursive && entryType === 'directory' && (maxDepth === undefined || currentDepth < maxDepth)) {
          try {
            const subResult = await listDirectory(fullPath, options, currentDepth + 1, cwd);
            entries.push(...subResult.entries);
            
            // Accumulate stats
            filesCount += subResult.stats.filesCount || 0;
            directoriesCount += subResult.stats.directoriesCount || 0;
            symlinksCount += subResult.stats.symlinksCount || 0;
            hiddenCount += subResult.stats.hiddenCount || 0;
            totalSize += subResult.stats.totalSize || 0;
          } catch (error) {
            logger.warn('Failed to read subdirectory', {
              directory: fullPath,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      } catch (error) {
        logger.warn('Failed to stat entry', {
          entry: fullPath,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  } catch (error) {
    throw new Error(`Failed to read directory ${dirPath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    entries,
    stats: {
      filesCount,
      directoriesCount,
      symlinksCount,
      hiddenCount,
      totalSize
    }
  };
}

/**
 * Sort entries based on criteria
 */
export function sortEntries(
  entries: LsDetailedEntry[],
  sortBy: 'name' | 'size' | 'modified' | 'type',
  sortOrder: 'asc' | 'desc'
): LsDetailedEntry[] {
  return entries.sort((a: LsDetailedEntry, b: LsDetailedEntry): number => {
    let comparison = 0;

    switch (sortBy) {
      case 'name':
        comparison = a.name.localeCompare(b.name);
        break;
      case 'size':
        comparison = (a.size || 0) - (b.size || 0);
        break;
      case 'modified':
        comparison = a.modified.getTime() - b.modified.getTime();
        break;
      case 'type':
        comparison = a.type.localeCompare(b.type);
        break;
      default:
        comparison = 0;
    }

    return sortOrder === 'desc' ? -comparison : comparison;
  });
}

/**
 * Apply limit to entries
 */
export function applyLimit(entries: LsDetailedEntry[], limit?: number): { 
  limitedEntries: LsDetailedEntry[]; 
  truncated: boolean; 
} {
  if (!limit || entries.length <= limit) {
    return { limitedEntries: entries, truncated: false };
  }

  return {
    limitedEntries: entries.slice(0, limit),
    truncated: true
  };
}

/**
 * Generate comprehensive statistics
 */
export function generateLsStats(
  baseStats: Partial<LsStats>,
  searchDuration: number,
  totalEntries: number
): LsStats {
  return {
    totalEntries,
    filesCount: baseStats.filesCount || 0,
    directoriesCount: baseStats.directoriesCount || 0,
    symlinksCount: baseStats.symlinksCount || 0,
    hiddenCount: baseStats.hiddenCount || 0,
    totalSize: baseStats.totalSize || 0,
    searchDuration: Math.max(1, searchDuration) // Ensure minimum 1ms
    // searchPath and truncated removed (input echoes)
  };
}

// validateLsOptions removed - no longer needed for simplified interface

// formatPermissions function removed - not needed for simplified interface