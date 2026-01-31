import { z } from 'zod';

/**
 * Schema for LS tool input - simplified to match  exactly
 */
export const LsToolInputSchema = z.object({
  path: z.string()
    .min(1, 'Path cannot be empty')
    .describe('The absolute path to the directory to list (must be absolute, not relative)'),
  
  ignore: z.array(z.string())
    .optional()
    .describe('List of glob patterns to ignore')
});

/**
 * Schema for detailed file/directory entry information
 */
export const LsDetailedEntrySchema = z.object({
  name: z.string()
    .describe('Name of the file or directory'),
  type: z.enum(['file', 'directory', 'symlink', 'other'])
    .describe('Type of the entry'),
  size: z.number()
    .int()
    .min(0)
    .optional()
    .describe('Size in bytes (for files only)'),
  modified: z.date()
    .describe('Last modification timestamp'),
  isHidden: z.boolean()
    .describe('Whether the entry is hidden'),
  extension: z.string()
    .optional()
    .describe('File extension (without dot, for files only)')
});

/**
 * Schema for LS statistics
 */
export const LsStatsSchema = z.object({
  totalEntries: z.number()
    .int()
    .min(0)
    .describe('Total number of entries found'),
  filesCount: z.number()
    .int()
    .min(0)
    .describe('Number of files found'),
  directoriesCount: z.number()
    .int()
    .min(0)
    .describe('Number of directories found'),
  symlinksCount: z.number()
    .int()
    .min(0)
    .describe('Number of symbolic links found'),
  hiddenCount: z.number()
    .int()
    .min(0)
    .describe('Number of hidden entries found'),
  totalSize: z.number()
    .int()
    .min(0)
    .describe('Total size of all files in bytes'),
  searchDuration: z.number()
    .min(0)
    .describe('Time taken to perform the listing in milliseconds')
});

/**
 * Schema for LS tool output - superset of  + rich metadata
 *  returns: Simple array of file/directory names
 * We return:  output + detailed metadata (no input echoes)
 */
export const LsToolOutputSchema = z.object({
  // ✅ CORE:  compatible output
  entries: z.array(z.string())
    .describe('Simple array of file/directory names ( format)'),
  
  // ✅ ENHANCED: Rich metadata per entry
  // eslint-disable-next-line @typescript-eslint/naming-convention
  detailed_entries: z.array(LsDetailedEntrySchema)
    .describe('Detailed info for each entry'),
  
  // ✅ KEEP: Useful metadata
  stats: LsStatsSchema
    .describe('Listing statistics and metadata')
  
  // ❌ REMOVED: Input echoes
  // - options object (redundant input echo)
  // - searchPath (echoes input path)
});

/**
 * LLM output schema for LsTool - tree-like directory structure with character limit
 */
export const LsToolLLMOutputSchema = z.union([
  z.object({
    directoryTree: z.string()
      .describe('Tree-like directory structure'),
    totalEntries: z.number()
      .int()
      .describe('Total number of entries found'),
    truncationMessage: z.string()
      .optional()
      .describe('Message if results were truncated')
  }),
  z.object({
    error: z.string()
      .describe('Error message if the ls operation failed')
  })
]);

// Export TypeScript types
export type LsToolInput = z.infer<typeof LsToolInputSchema>;
export type LsDetailedEntry = z.infer<typeof LsDetailedEntrySchema>;
export type LsStats = z.infer<typeof LsStatsSchema>;
export type LsToolOutput = z.infer<typeof LsToolOutputSchema>;
export type LsToolLLMOutput = z.infer<typeof LsToolLLMOutputSchema>;