import { BaseTokenCounter } from '../base-token-counter.js';
import type { Message } from '../../../../core/types/messages.js';
import type { 
  VertexConfig, 
  ClaudeVertexRequest
} from '../../../../providers/vertex/schemas.js';
import { VertexAuth } from '../../../../providers/vertex/auth/vertex-auth.js';
import { 
  convertToClaudeVertexFormat, 
  extractSystemPrompt 
} from '../../../../providers/vertex/utils/message-converter.js';
import { ToolDefinition } from '../../../../core/index.js';
import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

interface VertexClaudeTokenResponse {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  input_tokens?: number;
  usage?: {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    input_tokens?: number;
  };
}


/**
 * Claude token counter for Vertex AI using native count_tokens API
 */
export class ClaudeVertexTokenCounter extends BaseTokenCounter {
  private readonly vertexAuth: VertexAuth;
  private readonly vertexConfig: VertexConfig;

  constructor(model: string, config: VertexConfig) {
    super(model, config);
    this.vertexConfig = config;
    this.vertexAuth = new VertexAuth(config.auth);
  }

  async countTokens(messages: readonly Message[], tools: ToolDefinition[], maxTokens: number): Promise<number> {
    try {
      // Convert to Claude format
      const claudeRequest = this.convertToClaudeFormat(messages, tools);
      
      // Validate the request before sending
      // if (!validateClaudeVertexRequest(claudeRequest)) {
      //   throw new Error('Invalid Claude Vertex request format');
      // }
      
      // Use Vertex AI's Claude token counting endpoint
      const response = await this.callVertexClaudeCountTokens(claudeRequest);
      
      const inputTokens = response.input_tokens || response.usage?.input_tokens || 0;
      return inputTokens + maxTokens; // Include max output tokens for total context window usage
    } catch {
      // Fallback to estimation if API call fails
      return this.estimateTokensForMessages(messages) + maxTokens; // Include max output tokens for estimation
    }
  }

  getContextWindow(): number {
    // Claude 4 context window
    const contextWindows: Record<string, number> = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'claude-sonnet-4@20250514': 200000
    };

    // Find the closest match for the model
    for (const [modelPattern, contextWindow] of Object.entries(contextWindows)) {
      if (this.model.toLowerCase().includes(modelPattern.toLowerCase())) {
        return contextWindow;
      }
    }

    return 200000; // Default to 200K tokens
  }

  supportsTokenCounting(): boolean {
    return true; // Vertex AI provides native Claude token counting
  }

  private async callVertexClaudeCountTokens(request: Partial<ClaudeVertexRequest>): Promise<VertexClaudeTokenResponse> {
    // Use the correct count-tokens endpoint pattern from the working example
    const endpoint = `https://${this.vertexConfig.auth.region}-aiplatform.googleapis.com/v1/projects/${this.vertexConfig.auth.projectId}/locations/${this.vertexConfig.auth.region}/publishers/anthropic/models/count-tokens:rawPredict`;
    
    const authHeader = await this.vertexAuth.getAuthorizationHeader();
    
    // Add model to the request payload as shown in the working example
    const payload = {
      model: this.model,
      ...request
    };
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Vertex Claude count-tokens API failed: ${response.status} ${response.statusText}. Response: ${errorText}`);
    }

    // Parse the response - should contain input_tokens directly
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const result = await response.json() as { input_tokens?: number };
    
    return { 
      // eslint-disable-next-line @typescript-eslint/naming-convention
      input_tokens: result.input_tokens || 0
    };
  }

  private convertToClaudeFormat(messages: readonly Message[], tools: ToolDefinition[]): Partial<ClaudeVertexRequest> {
    // Use the existing helper functions from claude-vertex-provider
    const claudeMessages = convertToClaudeVertexFormat(messages);
    const systemPrompt = extractSystemPrompt(messages);

    // For count-tokens API, only include fields that are accepted
    const payload: Partial<ClaudeVertexRequest> = {
      messages: claudeMessages
    };

    // Add system prompt if present
    if (systemPrompt) {
      payload.system = systemPrompt;
    }

    // Add tools if present - convert to Claude format
    if (tools && tools.length > 0) {
      payload.tools = tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        input_schema: this.convertZodSchemaToClaudeSchema(tool.inputSchema)
      }));
    }

    return payload;
  }

  /**
   * Convert Zod schema to Claude input schema format
   * Duplicated from claude-vertex-provider for consistency
   */
  private convertZodSchemaToClaudeSchema(schema: z.ZodSchema<unknown>): Record<string, unknown> {
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
        name: 'tool_input_schema',
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
          } as Record<string, unknown>;
        }
      }
      
      // Ensure the schema has the required type field
      return {
        type: 'object',
        properties: jsonSchema.properties || {},
        required: jsonSchema.required || [],
        additionalProperties: false
      };
    } catch {
      // Fallback to permissive schema
      return {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: true
      };
    }
  }

}