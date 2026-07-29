import { z } from 'zod';

/**
 * Schema for a single edit operation within MultiEdit
 */
export const EditOperationSchema = z.object({
  // eslint-disable-next-line @typescript-eslint/naming-convention
  old_string: z.string()
    .min(0, 'Old string cannot be negative length')
    .describe('The text to replace'),
  // eslint-disable-next-line @typescript-eslint/naming-convention
  new_string: z.string()
    .min(0, 'New string cannot be negative length') 
    .describe('The text to replace it with'),
  // eslint-disable-next-line @typescript-eslint/naming-convention
  replace_all: z.boolean()
    .default(false)
    .optional()
    .describe('Replace all occurences of old_string (default false).')
}).refine(
  (data) => data.old_string !== data.new_string,
  {
    message: 'old_string and new_string must be different',
    path: ['new_string']
  }
);

/**
 * Schema for MultiEdit tool input - matches  exactly
 */
export const MultiEditToolInputSchema = z.object({
  // eslint-disable-next-line @typescript-eslint/naming-convention
  file_path: z.string()
    .min(1, 'File path cannot be empty')
    .max(4096, 'File path too long')
    .describe('The absolute path to the file to modify'),
  edits: z.array(EditOperationSchema)
    .min(1, 'At least one edit operation is required')
    .max(100, 'Too many edit operations (max 100)')
    .describe('Array of edit operations to perform sequentially on the file')
});

/**
 * Schema for edit operation result
 */
export const EditOperationResultSchema = z.object({
  // eslint-disable-next-line @typescript-eslint/naming-convention
  operation_index: z.number()
    .int()
    .min(0)
    .describe('Index of the edit operation'),
  // eslint-disable-next-line @typescript-eslint/naming-convention
  old_string: z.string()
    .describe('The text that was replaced'),
  // eslint-disable-next-line @typescript-eslint/naming-convention
  new_string: z.string()
    .describe('The text it was replaced with'),
  // eslint-disable-next-line @typescript-eslint/naming-convention
  occurrences_replaced: z.number()
    .int()
    .min(0)
    .describe('Number of occurrences that were replaced'),
  success: z.boolean()
    .describe('Whether this edit operation succeeded')
});

/**
 * Schema for MultiEdit tool output - matches  exactly
 */
export const MultiEditToolOutputSchema = z.object({
  // eslint-disable-next-line @typescript-eslint/naming-convention
  file_path: z.string()
    .describe('The absolute path to the file that was modified'),
  // eslint-disable-next-line @typescript-eslint/naming-convention
  total_edits: z.number()
    .int()
    .min(0)
    .describe('Total number of edit operations attempted'),
  // eslint-disable-next-line @typescript-eslint/naming-convention
  successful_edits: z.number()
    .int()
    .min(0)
    .describe('Number of edit operations that succeeded'),
  // eslint-disable-next-line @typescript-eslint/naming-convention
  edits_applied: z.array(EditOperationResultSchema)
    .describe('Details of each edit operation that was applied'),
  // eslint-disable-next-line @typescript-eslint/naming-convention
  file_size_before: z.number()
    .int()
    .min(0)
    .describe('File size in bytes before modifications'),
  // eslint-disable-next-line @typescript-eslint/naming-convention
  file_size_after: z.number()
    .int()
    .min(0)
    .describe('File size in bytes after modifications'),
  // eslint-disable-next-line @typescript-eslint/naming-convention
  content_preview: z.object({
    // eslint-disable-next-line @typescript-eslint/naming-convention
    first_100_chars: z.string()
      .describe('First 100 characters of the modified file'),
    // eslint-disable-next-line @typescript-eslint/naming-convention
    last_100_chars: z.string()
      .describe('Last 100 characters of the modified file')
  }).describe('Preview of the modified file content'),
  
  diff: z.string()
    .describe('Git-style diff showing all changes made to the file')
});

/**
 * LLM output schema for MultiEditTool - clean, minimal output for LLM consumption
 */
export const MultiEditToolLLMOutputSchema = z.union([
  z.object({
    message: z.string()
      .describe('Success message'),
    failedEdits: z.array(z.object({
      error: z.string()
        .describe('Error message for the failed edit'),
      index: z.number()
        .int()
        .describe('Index of the edit that failed')
    })).optional()
      .describe('Array of edits that failed (if any)')
  }),
  z.object({
    error: z.string()
      .describe('Error message if the multiedit operation failed')
  })
]);

// Export TypeScript types
export type EditOperation = z.infer<typeof EditOperationSchema>;
export type MultiEditToolInput = z.infer<typeof MultiEditToolInputSchema>;
export type EditOperationResult = z.infer<typeof EditOperationResultSchema>;
export type MultiEditToolOutput = z.infer<typeof MultiEditToolOutputSchema>;
export type MultiEditToolLLMOutput = z.infer<typeof MultiEditToolLLMOutputSchema>;