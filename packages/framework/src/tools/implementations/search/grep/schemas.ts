import { z } from 'zod';

/**
 * Maximum number of results that can be returned by grep tool
 */
export const MAX_GREP_RESULTS = 1000;

/**
 * Schema for grep tool input
 */
export const GrepToolInputSchema = z.object({
  pattern: z.string()
    .min(1, 'Pattern cannot be empty')
    .max(1000, 'Pattern too long')
    .describe('Regular expression pattern to search for'),
  path: z.string()
    .max(500, 'Path too long')
    .optional()
    .describe('File or directory to search in (defaults to current working directory)'),
  glob: z.string()
    .max(200, 'Glob pattern too long')
    .optional()
    .describe('Glob pattern to filter files (e.g., "*.js", "*.{ts,tsx}")'),
  type: z.string()
    .max(50, 'Type filter too long')
    .optional()
    .describe('File type to search (js, py, rust, go, java, etc.)'),
  // eslint-disable-next-line @typescript-eslint/naming-convention
  output_mode: z.enum(['content', 'files_with_matches', 'count'])
    .default('files_with_matches')
    .optional()
    .describe('Output mode: content shows lines, files_with_matches shows file paths, count shows match counts'),
  multiline: z.boolean()
    .default(false)
    .optional()
    .describe('Enable multiline mode where patterns can span lines'),
  // eslint-disable-next-line @typescript-eslint/naming-convention
  "-i": z.boolean()
    .default(false)
    .optional()
    .describe('Case insensitive search (rg -i)'),
  // eslint-disable-next-line @typescript-eslint/naming-convention
  "-A": z.number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .describe('Number of lines to show after each match (rg -A). Requires output_mode: "content", ignored otherwise.'),
  // eslint-disable-next-line @typescript-eslint/naming-convention
  "-B": z.number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .describe('Number of lines to show before each match (rg -B). Requires output_mode: "content", ignored otherwise.'),
  // eslint-disable-next-line @typescript-eslint/naming-convention
  "-C": z.number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .describe('Number of lines to show before and after each match (rg -C). Requires output_mode: "content", ignored otherwise.'),
  // eslint-disable-next-line @typescript-eslint/naming-convention
  "-n": z.boolean()
    .default(false)
    .optional()
    .describe('Show line numbers in output (rg -n). Requires output_mode: "content", ignored otherwise.'),
  // eslint-disable-next-line @typescript-eslint/naming-convention
  head_limit: z.number()
    .int()
    .min(1)
    .max(MAX_GREP_RESULTS)
    .optional()
    .describe(`Limit output to first N lines/entries, equivalent to "| head -N". Works across all output modes: content (limits output lines), files_with_matches (limits file paths), count (limits count entries). Maximum allowed is ${MAX_GREP_RESULTS}. When unspecified, defaults to ${MAX_GREP_RESULTS}.`)
});

/**
 * Schema for a single match result
 */
export const MatchResultSchema = z.object({
  filePath: z.string()
    .describe('Path to the file containing the match'),
  lineNumber: z.number()
    .int()
    .min(1)
    .optional()
    .describe('Line number where match was found'),
  content: z.string()
    .optional()
    .describe('The matched line content'),
  matchStart: z.number()
    .int()
    .min(0)
    .optional()
    .describe('Start position of match in the line'),
  matchEnd: z.number()
    .int()
    .min(0)
    .optional()
    .describe('End position of match in the line'),
  contextBefore: z.array(z.string())
    .optional()
    .describe('Lines before the match for context'),
  contextAfter: z.array(z.string())
    .optional()
    .describe('Lines after the match for context'),
  matchCount: z.number()
    .int()
    .min(0)
    .optional()
    .describe('Number of matches in this file (for count mode)')
});

/**
 * Schema for file count result
 */
export const FileCountSchema = z.object({
  filePath: z.string()
    .describe('Path to the file'),
  matchCount: z.number()
    .int()
    .min(0)
    .describe('Number of matches found in the file')
});

/**
 * Schema for search statistics
 */
export const SearchStatsSchema = z.object({
  totalFiles: z.number()
    .int()
    .min(0)
    .describe('Total number of files searched'),
  filesWithMatches: z.number()
    .int()
    .min(0)
    .describe('Number of files containing matches'),
  totalMatches: z.number()
    .int()
    .min(0)
    .describe('Total number of matches found'),
  searchDuration: z.number()
    .min(0)
    .describe('Search duration in milliseconds'),
  truncated: z.boolean()
    .default(false)
    .optional()
    .describe('Whether results were truncated due to head limit')
});

/**
 * Schema for grep tool output
 */
export const GrepToolOutputSchema = z.object({
  pattern: z.string()
    .describe('The search pattern that was used'),
  searchPath: z.string()
    .describe('The path that was searched'),
  // eslint-disable-next-line @typescript-eslint/naming-convention
  output_mode: z.enum(['content', 'files_with_matches', 'count'])
    .describe('Output mode that was used'),
  matches: z.array(MatchResultSchema)
    .optional()
    .describe('Match results (for content and files_with_matches modes)'),
  filesFound: z.array(z.string())
    .optional()
    .describe('List of file paths with matches (for files_with_matches mode)'),
  stats: SearchStatsSchema
    .describe('Search statistics and metadata'),
  options: z.object({
    glob: z.string().optional(),
    type: z.string().optional(),
    multiline: z.boolean().optional(),
    caseInsensitive: z.boolean().optional(),
    contextAfter: z.number().optional(),
    contextBefore: z.number().optional(),
    contextAround: z.number().optional(),
    showLineNumbers: z.boolean().optional(),
    headLimit: z.number().optional()
  }).describe('Search options that were applied')
});

/**
 * LLM output schema for GrepTool - clean, minimal output for LLM consumption
 */
export const GrepToolLLMOutputSchema = z.union([
  z.object({
    results: z.string()
      .describe('Search results formatted as strings'),
    totalMatches: z.number()
      .int()
      .min(0)
      .describe('Total number of matches found'),
    filesWithMatches: z.number()
      .int()
      .min(0)
      .describe('Number of files containing matches'),
    totalFiles: z.number()
      .int()
      .min(0)
      .describe('Total number of files searched'),
    truncated: z.boolean()
      .optional()
      .describe('Whether results were truncated due to head_limit'),
    suggestion: z.string()
      .optional()
      .describe('Suggestion for getting more targeted results when truncated')
  }),
  z.object({
    error: z.string()
      .describe('Error message if the grep operation failed')
  })
]);

// Export TypeScript types
export type GrepToolInput = z.infer<typeof GrepToolInputSchema>;
export type MatchResult = z.infer<typeof MatchResultSchema>;
export type FileCount = z.infer<typeof FileCountSchema>;
export type SearchStats = z.infer<typeof SearchStatsSchema>;
export type GrepToolOutput = z.infer<typeof GrepToolOutputSchema>;
export type GrepToolLLMOutput = z.infer<typeof GrepToolLLMOutputSchema>;