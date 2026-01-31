import { z } from 'zod';

/**
 * Zod schemas for Vertex AI provider
 * Comprehensive validation for all Vertex-specific types
 */

/**
 * Vertex authentication configuration schema
 */
export const VertexAuthConfigSchema = z.object({
  type: z.enum(['service-account', 'adc', 'token']),
  projectId: z.string().min(1, 'Project ID is required'),
  region: z.string().min(1, 'Region is required').default('us-central1'),
  keyFile: z.string().optional(),
  credentials: z.record(z.unknown()).optional(),
  token: z.string().optional(),
  scopes: z.array(z.string()).optional()
});

export type VertexAuthConfig = z.infer<typeof VertexAuthConfigSchema>;

/**
 * Vertex provider configuration schema
 */
export const VertexConfigSchema = z.object({
  auth: VertexAuthConfigSchema,
  apiVersion: z.string().default('v1'),
  timeout: z.number().positive().default(30000),
  retries: z.number().int().min(0).max(5).default(3),
  rateLimiting: z.boolean().default(true),
  enableLogging: z.boolean().default(true),
  customEndpoint: z.string().url().optional()
});

export type VertexConfig = z.infer<typeof VertexConfigSchema>;

/**
 * Vertex API message schemas
 */
export const VertexContentSchema = z.object({
  role: z.enum(['user', 'model', 'function']),
  parts: z.array(z.object({
    text: z.string().optional(),
    functionCall: z.object({
      name: z.string(),
      args: z.record(z.unknown())
    }).optional(),
    functionResponse: z.object({
      name: z.string(),
      response: z.record(z.unknown())
    }).optional(),
    // Multimodal support for Gemini
    inlineData: z.object({
      mimeType: z.string(),
      data: z.string() // Base64 encoded data
    }).optional(),
    fileData: z.object({
      mimeType: z.string(),
      fileUri: z.string() // GCS URI
    }).optional()
  }))
});

export type VertexContent = z.infer<typeof VertexContentSchema>;

/**
 * Vertex generation request schema
 */
export const VertexGenerationRequestSchema = z.object({
  contents: z.array(VertexContentSchema),
  tools: z.array(z.object({
    functionDeclarations: z.array(z.object({
      name: z.string(),
      description: z.string(),
      parameters: z.record(z.unknown())
    }))
  })).optional(),
  systemInstruction: z.object({
    parts: z.array(z.object({
      text: z.string()
    }))
  }).optional(),
  generationConfig: z.object({
    temperature: z.number().min(0).max(2).optional(),
    topP: z.number().min(0).max(1).optional(),
    topK: z.number().int().positive().optional(),
    maxOutputTokens: z.number().int().positive().optional(),
    candidateCount: z.number().int().positive().default(1),
    stopSequences: z.array(z.string()).optional(),
    thinkingConfig: z.object({
      // eslint-disable-next-line @typescript-eslint/naming-convention
      thinking_budget: z.number().int().positive().optional(),
      // eslint-disable-next-line @typescript-eslint/naming-convention
      include_thoughts: z.boolean().optional()
    }).optional()
  }).optional(),
  safetySettings: z.array(z.object({
    category: z.string(),
    threshold: z.string()
  })).optional()
});

export type VertexGenerationRequest = z.infer<typeof VertexGenerationRequestSchema>;

/**
 * Vertex generation response schema
 */
export const VertexCandidateSchema = z.object({
  content: VertexContentSchema.optional(),
  finishReason: z.enum(['FINISH_REASON_UNSPECIFIED', 'STOP', 'MAX_TOKENS', 'SAFETY', 'RECITATION', 'OTHER']).optional(),
  safetyRatings: z.array(z.object({
    category: z.string(),
    probability: z.string()
  })).optional(),
  citationMetadata: z.object({
    citations: z.array(z.object({
      startIndex: z.number().optional(),
      endIndex: z.number().optional(),
      uri: z.string().optional(),
      title: z.string().optional(),
      license: z.string().optional(),
      publicationDate: z.string().optional()
    }))
  }).optional()
});

export const VertexGenerationResponseSchema = z.object({
  candidates: z.array(VertexCandidateSchema).optional(),
  usageMetadata: z.object({
    promptTokenCount: z.number().int().nonnegative(),
    candidatesTokenCount: z.number().int().nonnegative(),
    totalTokenCount: z.number().int().nonnegative(),
    thoughtsTokenCount: z.number().int().nonnegative().optional() // Gemini 2.5 thinking tokens
  }).optional(),
  modelVersion: z.string().optional()
});

export type VertexGenerationResponse = z.infer<typeof VertexGenerationResponseSchema>;
export type VertexCandidate = z.infer<typeof VertexCandidateSchema>;

/**
 * Vertex streaming response schema
 */
export const VertexStreamChunkSchema = z.object({
  candidates: z.array(VertexCandidateSchema).optional(),
  usageMetadata: z.object({
    promptTokenCount: z.number().int().nonnegative().optional(),
    candidatesTokenCount: z.number().int().nonnegative().optional(),
    totalTokenCount: z.number().int().nonnegative().optional()
  }).optional(),
  modelVersion: z.string().optional()
});

export type VertexStreamChunk = z.infer<typeof VertexStreamChunkSchema>;

/**
 * Vertex error response schema
 */
export const VertexErrorSchema = z.object({
  error: z.object({
    code: z.number(),
    message: z.string(),
    status: z.string().optional(),
    details: z.array(z.record(z.unknown())).optional()
  })
});

export type VertexError = z.infer<typeof VertexErrorSchema>;

/**
 * Model information schema
 */
export const VertexModelInfoSchema = z.object({
  name: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  version: z.string().optional(),
  supportedGenerationMethods: z.array(z.string()).optional(),
  temperature: z.object({
    minimum: z.number(),
    maximum: z.number()
  }).optional(),
  topP: z.object({
    minimum: z.number(),
    maximum: z.number()
  }).optional(),
  topK: z.object({
    minimum: z.number(),
    maximum: z.number()
  }).optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  inputTokenLimit: z.number().int().positive().optional()
});

export type VertexModelInfo = z.infer<typeof VertexModelInfoSchema>;

/**
 * Claude on Vertex specific schemas
 */
export const ClaudeVertexMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.union([
    z.string(),
    z.array(z.object({
      type: z.enum(['text', 'tool_use', 'tool_result', 'thinking', 'image', 'document']),
      text: z.string().optional(),
      thinking: z.string().optional(), // Claude 4 thinking content
      signature: z.string().optional(), // Claude 4 thinking signature
      id: z.string().optional(),
      name: z.string().optional(),
      input: z.record(z.unknown()).optional(),
      // eslint-disable-next-line @typescript-eslint/naming-convention
      tool_use_id: z.string().optional(),
      content: z.unknown().optional(),
      // eslint-disable-next-line @typescript-eslint/naming-convention
      is_error: z.boolean().optional(),
      // Image/document source for multimodal content
      source: z.object({
        type: z.enum(['base64']),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        media_type: z.string(),
        data: z.string()
      }).optional()
    }))
  ])
});

export const ClaudeVertexRequestSchema = z.object({
  // eslint-disable-next-line @typescript-eslint/naming-convention
  anthropic_version: z.string().default('vertex-2023-10-16'),
  // Note: model is specified in URL path, not in request body for Claude on Vertex
  // eslint-disable-next-line @typescript-eslint/naming-convention
  max_tokens: z.number().int().positive(),
  messages: z.array(ClaudeVertexMessageSchema),
  system: z.string().optional(),
  tools: z.array(z.object({
    name: z.string(),
    description: z.string(),
    // eslint-disable-next-line @typescript-eslint/naming-convention
    input_schema: z.record(z.unknown())
  })).optional(),
  thinking: z.object({
    type: z.literal('enabled'),
    // eslint-disable-next-line @typescript-eslint/naming-convention
    budget_tokens: z.number().int().positive().optional()
  }).optional(),
  temperature: z.number().min(0).max(1).optional(),
  // eslint-disable-next-line @typescript-eslint/naming-convention
  top_p: z.number().min(0).max(1).optional(),
  // eslint-disable-next-line @typescript-eslint/naming-convention
  top_k: z.number().int().positive().optional(),
  // eslint-disable-next-line @typescript-eslint/naming-convention
  stop_sequences: z.array(z.string()).optional(),
  stream: z.boolean().optional()
});

export type ClaudeVertexRequest = z.infer<typeof ClaudeVertexRequestSchema>;
export type ClaudeVertexMessage = z.infer<typeof ClaudeVertexMessageSchema>;

/**
 * Claude response with thinking schema
 */
export const ClaudeVertexResponseSchema = z.object({
  id: z.string(),
  type: z.literal('message'),
  role: z.literal('assistant'),
  content: z.array(z.object({
    type: z.enum(['text', 'tool_use', 'thinking']),
    text: z.string().optional(),
    thinking: z.string().optional(), // Claude 4 thinking content
    signature: z.string().optional(), // Encrypted thinking (Claude 4)
    id: z.string().optional(),
    name: z.string().optional(),
    input: z.record(z.unknown()).optional()
  })),
  model: z.string(),
  // eslint-disable-next-line @typescript-eslint/naming-convention
  stop_reason: z.enum(['end_turn', 'max_tokens', 'stop_sequence', 'tool_use']).optional(),
  // eslint-disable-next-line @typescript-eslint/naming-convention
  stop_sequence: z.string().optional(),
  usage: z.object({
    // eslint-disable-next-line @typescript-eslint/naming-convention
    input_tokens: z.number().int().nonnegative(),
    // eslint-disable-next-line @typescript-eslint/naming-convention
    output_tokens: z.number().int().nonnegative(),
    // eslint-disable-next-line @typescript-eslint/naming-convention
    thinking_tokens: z.number().int().nonnegative().optional() // Claude 4 thinking tokens
  })
});

export type ClaudeVertexResponse = z.infer<typeof ClaudeVertexResponseSchema>;

/**
 * Validation helper functions
 */
export function validateVertexConfig(config: unknown): config is VertexConfig {
  try {
    VertexConfigSchema.parse(config);
    return true;
  } catch {
    return false;
  }
}

export function validateVertexRequest(request: unknown): request is VertexGenerationRequest {
  try {
    VertexGenerationRequestSchema.parse(request);
    return true;
  } catch {
    return false;
  }
}

export function validateClaudeVertexRequest(request: unknown): request is ClaudeVertexRequest {
  try {
    ClaudeVertexRequestSchema.parse(request);
    return true;
  } catch {
    return false;
  }
}

/**
 * Schema parsing with error handling
 */
export function parseVertexResponse(data: unknown): VertexGenerationResponse {
  return VertexGenerationResponseSchema.parse(data);
}

export function parseVertexStreamChunk(data: unknown): VertexStreamChunk {
  return VertexStreamChunkSchema.parse(data);
}

export function parseClaudeVertexResponse(data: unknown): ClaudeVertexResponse {
  return ClaudeVertexResponseSchema.parse(data);
}

export function parseVertexError(data: unknown): VertexError {
  return VertexErrorSchema.parse(data);
}