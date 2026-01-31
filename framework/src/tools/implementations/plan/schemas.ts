import { z } from 'zod';

/**
 * Input schema for PlanModeRespond tool
 */
export const PlanModeRespondInputSchema = z.object({
  content: z.string()
    .describe('Plan content provided by the user. If non-empty, indicates plan acceptance.')
});

/**
 * Output schema for PlanModeRespond tool
 */
export const PlanModeRespondOutputSchema = z.object({
  success: z.boolean()
    .describe('Whether the plan response operation succeeded'),
  
  message: z.string()
    .describe('Response message indicating next steps'),
  
  planAccepted: z.boolean()
    .describe('Whether the plan was accepted (content is non-empty)')
});

/**
 * LLM output schema for PlanModeRespond tool - simple message only
 */
export const PlanModeRespondLLMOutputSchema = z.object({
  message: z.string()
    .describe('Message instructing the LLM on next steps based on plan acceptance')
});

/**
 * TypeScript types derived from schemas
 */
export type PlanModeRespondInput = z.infer<typeof PlanModeRespondInputSchema>;
export type PlanModeRespondOutput = z.infer<typeof PlanModeRespondOutputSchema>;
export type PlanModeRespondLLMOutput = z.infer<typeof PlanModeRespondLLMOutputSchema>;