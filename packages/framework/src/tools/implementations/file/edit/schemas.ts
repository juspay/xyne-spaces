import { z } from 'zod';

/**
 * Schema for edit tool input - simplified to match  exactly
 */
export const EditToolInputSchema = z.object({
  // eslint-disable-next-line @typescript-eslint/naming-convention
  file_path: z.string()
    .min(1, 'File path cannot be empty')
    .describe('The absolute path to the file to modify'),
  
  // eslint-disable-next-line @typescript-eslint/naming-convention
  old_string: z.string()
    .describe('The text to replace'),
  
  // eslint-disable-next-line @typescript-eslint/naming-convention
  new_string: z.string()
    .describe('The text to replace it with (must be different from old_string)'),
  
  // eslint-disable-next-line @typescript-eslint/naming-convention
  replace_all: z.boolean()
    .default(false)
    .optional()
    .describe('Replace all occurences of old_string (default false)')
});

/**
 * Schema for edit tool output - superset of  + git-style diff
 *  returns: Simple success/failure indication
 * We return: success + git-style diff + useful metadata (no input echoes)
 */
export const EditToolOutputSchema = z.object({
  // ✅ CORE:  compatible output
  success: z.boolean()
    .describe('Whether the edit operation succeeded'),
  
  // eslint-disable-next-line @typescript-eslint/naming-convention
  replacements_made: z.number()
    .int()
    .min(0)
    .describe('Number of replacements made'),
  
  // ✅ ENHANCED: Git-style diff (better than )
  diff: z.string()
    .describe('Git-style diff with line numbers showing what changed'),
  
  // ✅ KEEP: Useful metadata
  fileExists: z.boolean()
    .describe('Whether the file existed before editing'),
  
  fileCreated: z.boolean()
    .describe('Whether the file was created during this operation'),
  
  originalContent: z.string()
    .optional()
    .describe('Original file content before edits'),
  
  newContent: z.string()
    .describe('Final file content after edits'),
  
  contentChanged: z.boolean()
    .describe('Whether the file content actually changed'),
  
  bytesWritten: z.number()
    .int()
    .min(0)
    .describe('Number of bytes written to the file'),
  
  lastModified: z.date()
    .describe('Last modification timestamp of the file'),
  
  // Error handling: Tool throws errors instead of returning error field
  
  // ❌ REMOVED: Input echoes and over-complex tracking
  // - filePath (echoes input file_path)
  // - old_string/new_string echoes
  // - Complex editResults array
  // - Multi-edit transaction tracking
  // - encoding (use default)
  // - suggestions (keep it simple)
});

/**
 * LLM output schema for EditTool - clean, minimal output for LLM consumption
 */
export const EditToolLLMOutputSchema = z.union([
  z.object({
    message: z.string()
      .describe('Success message')
  }),
  z.object({
    error: z.string()
      .describe('Error message if the edit operation failed')
  })
]);

// Export TypeScript types
export type EditToolInput = z.infer<typeof EditToolInputSchema>;
export type EditToolOutput = z.infer<typeof EditToolOutputSchema>;
export type EditToolLLMOutput = z.infer<typeof EditToolLLMOutputSchema>;