import { z } from 'zod';

/**
 * Configuration schema for ConversationCompactor
 */
export const ConversationCompactorConfigSchema = z.object({
  config: z.any(), // LLMClientConfig
  model: z.string().min(1)
});

/**
 * Input schema for shouldCompact method
 */
export const ShouldCompactInputSchema = z.object({
  messages: z.array(z.any()), // Message[]
  thresholdPercentage: z.number().min(0).max(100)
});

/**
 * Input schema for compact method
 */
export const CompactInputSchema = z.object({
  messages: z.array(z.any()), // Message[]
  systemPrompt: z.string()
});

/**
 * Output schema for token count operations
 */
export const TokenCountOutputSchema = z.object({
  tokenCount: z.number().min(0),
  contextWindow: z.number().min(0),
  usagePercentage: z.number().min(0).max(100),
  supportsNativeCounting: z.boolean()
});

/**
 * Output schema for compact operation
 */
export const CompactOutputSchema = z.object({
  compactedMessages: z.array(z.any()), // Message[]
  originalTokenCount: z.number().min(0),
  compactedTokenCount: z.number().min(0),
  reductionPercentage: z.number().min(0).max(100)
});

/**
 * Analysis output schema
 */
export const ConversationAnalysisSchema = z.object({
  tokenCount: z.number().min(0),
  contextWindow: z.number().min(0),
  usagePercentage: z.number().min(0).max(100),
  shouldCompact: z.boolean(),
  recommendation: z.string(),
  estimatedReduction: z.number().min(0).optional()
});

/**
 * Token counting info schema
 */
export const TokenCountingInfoSchema = z.object({
  supportsNativeCounting: z.boolean(),
  contextWindow: z.number().min(0),
  provider: z.string(),
  model: z.string()
});

// Type exports
export type ConversationCompactorConfig = z.infer<typeof ConversationCompactorConfigSchema>;
export type ShouldCompactInput = z.infer<typeof ShouldCompactInputSchema>;
export type CompactInput = z.infer<typeof CompactInputSchema>;
export type TokenCountOutput = z.infer<typeof TokenCountOutputSchema>;
export type CompactOutput = z.infer<typeof CompactOutputSchema>;
export type ConversationAnalysis = z.infer<typeof ConversationAnalysisSchema>;
export type TokenCountingInfo = z.infer<typeof TokenCountingInfoSchema>;