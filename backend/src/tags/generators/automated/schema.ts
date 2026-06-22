import { z } from 'zod';
import { GeneratedTagSchema } from '../../schema.js';

export const AutomatedScriptOutputSchema = z.array(GeneratedTagSchema);

export type AutomatedScriptOutput = z.infer<typeof AutomatedScriptOutputSchema>;
