import { BaseTokenCounter } from '../base-token-counter.js';
import type { Message } from '../../../../core/types/messages.js';
import type { VertexConfig, VertexContent } from '../../../../providers/vertex/schemas.js';
import { VertexAuth } from '../../../../providers/vertex/auth/vertex-auth.js';
import { ToolDefinition } from '../../../../core/index.js';
import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { logger } from '../../../../../utils/logger.js';
import {
  convertToVertexFormat,
  extractSystemPrompt
} from '../../../../providers/vertex/utils/message-converter.js';

interface VertexTokenResponse {
  totalTokens?: number;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  total_tokens?: number;
}


/**
 * Gemini token counter using Vertex AI native countTokens API
 */
export class GeminiTokenCounter extends BaseTokenCounter {
  private readonly vertexAuth: VertexAuth;
  private readonly vertexConfig: VertexConfig;

  constructor(model: string, config: VertexConfig) {
    super(model, config);
    this.vertexConfig = config;
    this.vertexAuth = new VertexAuth(config.auth);
  }

  async countTokens(messages: readonly Message[], tools: ToolDefinition[], _maxTokens: number): Promise<number> {
    try {
      // Convert framework messages to Vertex format (excluding system messages)
      const vertexMessages = convertToVertexFormat(messages);
      
      // Extract system prompt if present
      const systemPrompt = extractSystemPrompt(messages);
      
      // Call Vertex AI countTokens API
      const response = await this.callVertexCountTokensAPI(vertexMessages, tools, systemPrompt);
      
      const inputTokens = response.totalTokens || response.total_tokens || 0;
      return inputTokens; // Gemini doesn't count output tokens toward context window
    } catch {
      // Fallback to estimation if API call fails
      return this.estimateTokensForMessages(messages); // Gemini doesn't count output tokens toward context window
    }
  }

  getContextWindow(): number {
    const contextWindows: Record<string, number> = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'gemini-2.5-pro': 1048576        // 1M tokens
    };

    // Find the closest match for the model
    for (const [modelPattern, contextWindow] of Object.entries(contextWindows)) {
      if (this.model.toLowerCase().includes(modelPattern.toLowerCase())) {
        return contextWindow;
      }
    }

    return 1048576; // Default to 1M tokens
  }

  supportsTokenCounting(): boolean {
    return true; // Vertex AI provides native token counting
  }

  private async callVertexCountTokensAPI(messages: VertexContent[], tools: ToolDefinition[], systemPrompt?: string): Promise<VertexTokenResponse> {
    const endpoint = `https://${this.vertexConfig.auth.region}-aiplatform.googleapis.com/v1/projects/${this.vertexConfig.auth.projectId}/locations/${this.vertexConfig.auth.region}/publishers/google/models/${this.model}:countTokens`;
    
    const token = await this.vertexAuth.getToken();
    
    // Build request body similar to how the provider does it
    const requestBody: Record<string, unknown> = {
      contents: messages,
    };
    if (systemPrompt) {
      requestBody['systemInstruction'] = {
        parts: [{ text: systemPrompt }]
      };
    }

    if (tools && tools.length > 0) {
      requestBody['tools'] = [{
        functionDeclarations: tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          parameters: this.convertZodSchemaToVertexParameters(tool.inputSchema)
        }))
      }];
    }
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`Vertex countTokens API failed: ${response.status} ${response.statusText}`);
    }
    
    return await response.json() as VertexTokenResponse;
  }


  /**
   * Convert Zod schema to Vertex parameters format
   */
  private convertZodSchemaToVertexParameters(schema: z.ZodSchema<unknown>): Record<string, unknown> {
    interface JsonSchema {
      $ref?: string;
      definitions?: Record<string, JsonSchema>;
      properties?: Record<string, unknown>;
      required?: string[];
      type?: string;
      [key: string]: unknown;
    }

    try {
      const jsonSchema = zodToJsonSchema(schema, {
        name: 'function_parameters',
        target: 'jsonSchema7'
      }) as JsonSchema;
      
      // If the schema uses $ref, extract the referenced definition
      if (jsonSchema.$ref && jsonSchema.definitions) {
        const refKey = jsonSchema.$ref.replace('#/definitions/', '');
        const actualSchema = jsonSchema.definitions[refKey];
        if (actualSchema) {
          return {
            type: 'object',
            ...actualSchema
          };
        }
      }
      
      // Convert to Google Cloud Function format
      return {
        type: 'object',
        properties: jsonSchema.properties || {},
        required: jsonSchema.required || [],
        additionalProperties: false
      };
    } catch (error) {
      logger.warn('Failed to convert Zod schema to Vertex parameters, using fallback', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      // Fallback to empty schema
      return {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: true
      };
    }
  }
}