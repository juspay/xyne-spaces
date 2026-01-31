import { z } from 'zod';

/**
 * Schema for glob tool input - simplified to match  exactly
 */
export const GlobToolInputSchema = z.object({
  pattern: z.string()
    .min(1, 'Pattern cannot be empty')
    .describe('Glob pattern to match files (e.g., "**/*.js", "src/**/*.ts")'),
  
  path: z.string()
    .optional()
    .describe('Directory to search in (defaults to current working directory)')
});

/**
 * Schema for detailed file information
 */
export const GlobDetailedMatchSchema = z.object({
  path: z.string()
    .describe('Full path to the matched file'),
  relativePath: z.string()
    .describe('Path relative to the search directory'),
  size: z.number()
    .int()
    .min(0)
    .describe('File size in bytes'),
  lastModified: z.date()
    .describe('Last modification timestamp'),
  isDirectory: z.boolean()
    .describe('Whether this is a directory'),
  isFile: z.boolean()
    .describe('Whether this is a regular file'),
  extension: z.string()
    .optional()
    .describe('File extension (without dot)')
});

/**
 * Schema for glob statistics
 */
export const GlobStatsSchema = z.object({
  totalMatches: z.number()
    .int()
    .min(0)
    .describe('Total number of matches found'),
  directoriesSearched: z.number()
    .int()
    .min(0)
    .describe('Number of directories searched'),
  searchDuration: z.number()
    .min(0)
    .describe('Search duration in milliseconds'),
  pattern: z.string()
    .describe('The glob pattern that was used'),
  searchPath: z.string()
    .describe('The directory that was searched'),
  truncated: z.boolean()
    .default(false)
    .optional()
    .describe('Whether results were truncated due to result limit')
});

/**
 * Schema for glob tool output - superset of  + rich metadata
 *  returns: Simple array of matching file paths, sorted by modification time
 * We return:  output + detailed metadata (no input echoes)
 */
export const GlobToolOutputSchema = z.object({
  // ✅ CORE:  compatible output
  matches: z.array(z.string())
    .describe('Simple array of matching file paths, sorted by modification time'),
  
  // ✅ ENHANCED: Rich metadata per match
  // eslint-disable-next-line @typescript-eslint/naming-convention
  detailed_matches: z.array(GlobDetailedMatchSchema)
    .describe('Detailed info for each match'),
  
  // ✅ KEEP: Useful metadata
  stats: GlobStatsSchema
    .describe('Search statistics and metadata')
  
  // ❌ REMOVED: Input echoes (options object)
});

/**
 * LLM output schema for GlobTool - clean, minimal output for LLM consumption
 */
export const GlobToolLLMOutputSchema = z.union([
  z.object({
    matches: z.array(z.string())
      .describe('Array of matching file paths'),
    totalMatches: z.number()
      .int()
      .describe('Total number of matches found'),
    searchPattern: z.string()
      .describe('The glob pattern that was used'),
    truncated: z.boolean()
      .optional()
      .describe('Whether results were truncated due to result limit'),
    suggestion: z.string()
      .optional()
      .describe('Suggestion to use more specific pattern when results are truncated')
  }),
  z.object({
    error: z.string()
      .describe('Error message if the glob search failed')
  })
]);

// Export TypeScript types
export type GlobToolInput = z.infer<typeof GlobToolInputSchema>;
export type GlobDetailedMatch = z.infer<typeof GlobDetailedMatchSchema>;
export type GlobStats = z.infer<typeof GlobStatsSchema>;
export type GlobToolOutput = z.infer<typeof GlobToolOutputSchema>;
export type GlobToolLLMOutput = z.infer<typeof GlobToolLLMOutputSchema>;