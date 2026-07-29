import { z } from 'zod';

/**
 * Input schema for ReadTool - simplified to match  exactly
 */
export const ReadToolInputSchema = z.object({
  // eslint-disable-next-line @typescript-eslint/naming-convention
  file_path: z.string()
    .min(1, 'File path cannot be empty')
    .describe('The absolute path to the file to read (must be absolute, not relative)'),
  
  limit: z.number()
    .int()
    .min(1, 'Limit must be positive')
    .optional()
    .describe('The number of lines to read. Only provide if the file is too large to read at once.'),
  
  offset: z.number()
    .int()
    .min(1, 'Offset must be a positive line number')
    .optional()
    .describe('The line number to start reading from. Only provide if the file is too large to read at once')
});

/**
 * Output schema for ReadTool - superset of  output + useful metadata
 *  returns: simple content string with line numbers (cat -n format)
 * We return: same content + rich metadata (no input echoes)
 */
export const ReadToolOutputSchema = z.object({
  // ✅ CORE:  compatible output
  content: z.string()
    .describe('File content with line numbers in cat -n format'),
  
  // ✅ KEEP: Useful metadata (superset of )
  size: z.number()
    .int()
    .min(0, 'Size cannot be negative')
    .describe('File size in bytes'),
  
  lastModified: z.date()
    .describe('Last modification date of the file'),
  
  isTextFile: z.boolean()
    .describe('Whether the file appears to be a text file'),
  
  totalLines: z.number()
    .int()
    .min(0, 'Total lines cannot be negative')
    .describe('Total number of lines in the file'),
  
  linesRead: z.number()
    .int()
    .min(0, 'Lines read cannot be negative')
    .describe('Number of lines actually read and returned'),
  
  startLine: z.number()
    .int()
    .min(0, 'Start line must be non-negative')
    .describe('First line number included in the output'),
  
  endLine: z.number()
    .int()
    .min(0, 'End line must be non-negative')
    .describe('Last line number included in the output'),
  
  truncated: z.boolean()
    .describe('Whether any lines were truncated due to length limits'),
  
  isEmpty: z.boolean()
    .describe('Whether the file is empty'),

  suggestions: z.array(z.string())
    .optional()
    .describe('Helpful suggestions for reading more content when truncated')
  
  // ❌ REMOVED: Input echoes
  // - filePath (echoes input file_path)
  // - encoding (echoes input encoding, use default)
});

/**
 * LLM output schema for ReadTool - clean, minimal output for LLM consumption
 * This is what the LLM actually receives, not the full internal output
 */
export const ReadToolLLMOutputSchema = z.union([
  z.object({
    content: z.string()
      .describe('File content with line numbers in cat -n format'),
    suggestions: z.array(z.string())
      .optional()
      .describe('Helpful suggestions for reading more content when truncated')
  }),
  z.object({
    error: z.string()
      .describe('Error message if the read operation failed')
  })
]);

/**
 * TypeScript types derived from schemas
 */
export type ReadToolInput = z.infer<typeof ReadToolInputSchema>;
export type ReadToolOutput = z.infer<typeof ReadToolOutputSchema>;
export type ReadToolLLMOutput = z.infer<typeof ReadToolLLMOutputSchema>;