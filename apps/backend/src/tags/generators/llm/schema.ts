import { z } from 'zod';
import { GeneratedTagSchema } from '../../schema.js';

export const LlmRawOutputSchema = z.object({
  tags: z.array(GeneratedTagSchema),
});
