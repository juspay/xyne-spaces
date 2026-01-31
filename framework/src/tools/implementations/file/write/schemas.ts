import { z } from 'zod';

/**
 * Schema for WriteToolInput - simplified to match  exactly
 */
export const WriteToolInputSchema = z.object({
  // eslint-disable-next-line @typescript-eslint/naming-convention
  file_path: z.string()
    .min(1, 'File path cannot be empty')
    .describe('The absolute path to the file to write (must be absolute, not relative)'),
  
  content: z.string()
    .describe('The content to write to the file')
});

/**
 * Schema for WriteToolOutput - superset of  output + useful metadata
 *  returns: Simple success confirmation (exact format varies)
 * We return: success confirmation + rich metadata (no input echoes)
 */
export const WriteToolOutputSchema = z.object({
  // ✅ CORE:  compatible output
  success: z.boolean()
    .describe('Whether the write operation succeeded'),
  
  // ✅ KEEP: Useful metadata (superset of )
  bytesWritten: z.number()
    .int()
    .min(0)
    .describe('Number of bytes written to the file'),
  
  created: z.boolean()
    .describe('Whether the file was created (vs updated)'),
  
  originalContent: z.string()
    .optional()
    .describe('Previous content of the file (for undo/comparison)'),
  
  contentChanged: z.boolean()
    .describe('Whether the content actually changed from previous'),
  
  directoryCreated: z.boolean()
    .describe('Whether parent directories were created'),
  
  lastModified: z.date()
    .describe('New modification timestamp of the file'),
  
  diffSummary: z.object({
    linesAdded: z.number().int().min(0),
    linesRemoved: z.number().int().min(0),
    linesModified: z.number().int().min(0),
    hasChanges: z.boolean()
  }).optional()
    .describe('Summary of changes made to the file'),
  
  suggestions: z.array(z.string())
    .optional()
    .describe('Helpful suggestions based on the write operation')
  
  // ❌ REMOVED: Input echoes
  // - filePath (echoes input file_path)
  // - newContent (echoes input content)
  // - encoding (echoes input encoding, use default)
});

/**
 * LLM output schema for WriteTool - clean, minimal output for LLM consumption
 */
export const WriteToolLLMOutputSchema = z.union([
  z.object({
    message: z.string()
      .describe('Success message'),
    linesWritten: z.number()
      .int()
      .min(0)
      .describe('Number of lines written to the file'),
    newFile: z.boolean()
      .describe('Whether a new file was created')
  }),
  z.object({
    error: z.string()
      .describe('Error message if the write operation failed')
  })
]);

/**
 * TypeScript types derived from schemas
 */
export type WriteToolInput = z.infer<typeof WriteToolInputSchema>;
export type WriteToolOutput = z.infer<typeof WriteToolOutputSchema>;
export type WriteToolLLMOutput = z.infer<typeof WriteToolLLMOutputSchema>;