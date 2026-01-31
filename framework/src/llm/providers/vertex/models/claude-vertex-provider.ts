import type {
  LLMRequest,
  LLMResponse,
  ModelCapabilities,
  ProviderExecutionContext
} from '../../../core/types/index.js';
import type { StreamChunk } from '../../../core/types/streaming.js';
import type { VertexAuthConfig, ClaudeVertexRequest, ClaudeVertexResponse } from '../schemas.js';
import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Claude streaming response interfaces
interface ClaudeStreamChunk {
  type: string;
  delta?: { text?: string };
  // eslint-disable-next-line @typescript-eslint/naming-convention
  content_block?: {
    type: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  };
  usage?: { 
    // eslint-disable-next-line @typescript-eslint/naming-convention
    output_tokens?: number 
  };
}

// Claude error response interface
interface ClaudeErrorResponse {
  error?: { message?: string };
}
import { VertexAuth } from '../auth/vertex-auth.js';
import {
  convertToClaudeVertexFormat,
  extractSystemPrompt,
  convertFromClaudeVertexResponse
} from '../utils/message-converter.js';
import { logger } from '../../../../utils/logger.js';
import {
  LLMErrorClass,
  createProviderExecutionError,
  createNetworkError,
  createRateLimitError,
  createModelUnavailableError
} from '../../../core/errors/index.js';

/**
 * Claude model provider for Vertex AI
 * Handles Claude-specific API interactions with thinking block extraction
 */
export class ClaudeVertexProvider {
  private readonly auth: VertexAuth;
  private readonly projectId: string;
  private readonly region: string;
  private readonly PROVIDER_NAME = 'vertex';

  // Supported Claude models on Vertex
  private readonly SUPPORTED_MODELS = [
    'claude-sonnet-4@20250514'
  ] as const;

  // Model capabilities mapping with thinking support
  private readonly MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'claude-sonnet-4@20250514': {
      supportsToolCalling: true,
      supportsStreaming: true,
      supportsThinking: true, // Advanced thinking with interleaved support
      supportsVision: true,
      maxTokens: 64000, // Higher token limit for Claude 4
      maxInputTokens: 200000
    }
  };

  constructor(auth: VertexAuth, _config: VertexAuthConfig) {
    this.auth = auth;
    this.projectId = auth.getProjectId();
    this.region = auth.getRegion();

    logger.debug('Claude Vertex provider initialized', {
      projectId: this.projectId,
      region: this.region,
      supportedModels: this.SUPPORTED_MODELS
    });
  }

  /**
   * Generate response using Claude model with thinking block extraction
   */
  public async generate(
    request: LLMRequest,
    context: ProviderExecutionContext,
    abortSignal?: AbortSignal
  ): Promise<LLMResponse> {
    try {
      // Validate model
      if (!this.isModelSupported(request.model)) {
        throw new LLMErrorClass(createModelUnavailableError(
          this.PROVIDER_NAME,
          request.model,
          `Model ${request.model} is not supported by Claude Vertex provider`
        ));
      }

      // Convert messages to Claude Vertex format
      const claudeMessages = convertToClaudeVertexFormat(request.messages);
      const systemPrompt = request.systemPrompt || extractSystemPrompt(request.messages);

      // Build Claude Vertex request
      const claudeRequest = this.buildClaudeRequest(
        request,
        claudeMessages,
        systemPrompt
      );

      logger.debug('Sending request to Claude on Vertex API', {
        model: request.model,
        messageCount: claudeMessages.length,
        hasSystemPrompt: !!systemPrompt,
        hasTools: !!(request.tools && request.tools.length > 0),
        thinkingMode: request.features?.thinking?.enabled,
        executionId: context.requestId
      });

      // Make API call
      const claudeResponse = await this.callClaudeAPI(claudeRequest, request.model, context, request, abortSignal);

      // Convert response back to common format with thinking extraction
      const response = convertFromClaudeVertexResponse(claudeResponse, context.requestId);

      // Build final LLM response
      const llmResponse: LLMResponse = {
        id: context.requestId,
        model: request.model,
        provider: this.PROVIDER_NAME,
        content: response.content,
        ...(response.thinking && { thinking: response.thinking }), // Claude's thinking block
        ...(response.thinkingSignature && { thinkingSignature: response.thinkingSignature }), // Claude's thinking signature
        ...(response.toolCalls && { toolCalls: response.toolCalls }),
        usage: {
          promptTokens: claudeResponse.usage?.input_tokens || 0,
          completionTokens: claudeResponse.usage?.output_tokens || 0,
          totalTokens: (claudeResponse.usage?.input_tokens || 0) + (claudeResponse.usage?.output_tokens || 0),
          // Use actual thinking tokens from API if available, otherwise estimate
          ...(claudeResponse.usage?.thinking_tokens ? 
            { thinkingTokens: claudeResponse.usage.thinking_tokens } :
            response.thinking ? 
            { thinkingTokens: this.estimateThinkingTokens(response.thinking) } :
            {})
        },
        metadata: {
          requestId: context.requestId,
          model: request.model,
          provider: this.PROVIDER_NAME,
          timestamp: new Date(),
          processingTime: Date.now() - context.startTime.getTime(),
          apiVersion: 'vertex-claude',
          region: this.region,
          rawResponse: claudeResponse
        },
        finishReason: response.finishReason
      };

      logger.debug('Claude Vertex API request completed successfully', {
        model: request.model,
        contentLength: response.content.length,
        thinkingLength: response.thinking?.length || 0,
        toolCallsCount: response.toolCalls?.length || 0,
        usage: llmResponse.usage,
        executionId: context.requestId
      });

      return llmResponse;

    } catch (error) {
      logger.error('Claude Vertex generation failed', error as Error, {
        model: request.model,
        executionId: context.requestId
      });

      if (error instanceof LLMErrorClass) {
        throw error;
      }

      throw new LLMErrorClass(createProviderExecutionError(
        this.PROVIDER_NAME,
        error instanceof Error ? error.message : 'Unknown error during Claude generation',
        true,
        {
          model: request.model,
          executionId: context.requestId
        }
      ));
    }
  }

  /**
   * Generate streaming response using Claude model with thinking blocks
   */
  public async *generateStream(
    request: LLMRequest,
    context: ProviderExecutionContext,
    abortSignal?: AbortSignal
  ): AsyncIterable<StreamChunk> {
    try {
      // Validate model
      if (!this.isModelSupported(request.model)) {
        throw new LLMErrorClass(createModelUnavailableError(
          this.PROVIDER_NAME,
          request.model,
          `Model ${request.model} is not supported by Claude Vertex provider`
        ));
      }

      // Convert messages to Claude Vertex format
      const claudeMessages = convertToClaudeVertexFormat(request.messages);
      const systemPrompt = request.systemPrompt || extractSystemPrompt(request.messages);

      // Build Claude Vertex request for streaming
      const claudeRequest = this.buildClaudeRequest(
        request,
        claudeMessages,
        systemPrompt,
        true // Enable streaming
      );

      logger.debug('Starting Claude Vertex streaming request', {
        model: request.model,
        messageCount: claudeMessages.length,
        thinkingMode: request.features?.thinking?.enabled,
        executionId: context.requestId
      });

      // Make streaming API call
      const stream = this.callClaudeStreamAPI(claudeRequest, request.model, context, request, abortSignal);

      let chunkIndex = 0;
      let currentThinking = '';

      for await (const chunk of stream) {
        // Handle thinking blocks separately
        if (chunk.type === 'thinking') {
          currentThinking += chunk.content || '';
          
          // Yield thinking chunk if enabled
          if (request.features?.thinking?.includeThoughts) {
            yield {
              id: `claude-thinking-${chunkIndex++}`,
              type: 'thinking',
              thinking: chunk.content || '',
              delta: true,
              index: chunkIndex,
              metadata: {
                timestamp: new Date(),
                model: request.model,
                provider: this.PROVIDER_NAME
              }
            };
          }
        } else if (chunk.type === 'content') {
          // Regular content chunk
          yield {
            id: `claude-content-${chunkIndex++}`,
            type: 'content',
            content: chunk.content || '',
            delta: true,
            index: chunkIndex,
            metadata: {
              timestamp: new Date(),
              model: request.model,
              provider: this.PROVIDER_NAME,
              ...(chunk.tokenCount !== undefined && { tokenCount: chunk.tokenCount })
            }
          };
        } else if (chunk.type === 'tool_call' && chunk.toolCall) {
          // Tool call chunk
          yield {
            id: `claude-tool-${chunkIndex++}`,
            type: 'tool_call',
            toolCall: chunk.toolCall,
            delta: false,
            index: chunkIndex,
            metadata: {
              timestamp: new Date(),
              model: request.model,
              provider: this.PROVIDER_NAME
            }
          };
        }
      }

      // Send done chunk with final thinking if any
      yield {
        id: `claude-done-${Date.now()}`,
        type: 'done',
        delta: false,
        metadata: {
          timestamp: new Date(),
          model: request.model,
          provider: this.PROVIDER_NAME,
          ...(currentThinking && { finalThinking: currentThinking })
        }
      };

    } catch (error) {
      logger.error('Claude Vertex streaming failed', error as Error, {
        model: request.model,
        executionId: context.requestId
      });

      if (error instanceof LLMErrorClass) {
        throw error;
      }

      throw new LLMErrorClass(createProviderExecutionError(
        this.PROVIDER_NAME,
        error instanceof Error ? error.message : 'Unknown error during Claude streaming',
        true,
        {
          model: request.model,
          executionId: context.requestId
        }
      ));
    }
  }

  /**
   * Get model capabilities
   */
  public getModelCapabilities(model: string): ModelCapabilities | undefined {
    return this.MODEL_CAPABILITIES[model];
  }

  /**
   * Check if model is supported
   */
  public isModelSupported(model: string): boolean {
    return this.SUPPORTED_MODELS.includes(model as typeof this.SUPPORTED_MODELS[number]);
  }

  /**
   * Build Claude Vertex API request with enhanced thinking support
   */
  private buildClaudeRequest(
    request: LLMRequest,
    claudeMessages: Record<string, unknown>[],
    systemPrompt?: string,
    streaming = false
  ): ClaudeVertexRequest {
    // Create minimal request for Claude on Vertex (note: model is in URL path, not body)
    const claudeRequest: Partial<ClaudeVertexRequest> = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      anthropic_version: 'vertex-2023-10-16', // Correct version for Claude on Vertex
      // eslint-disable-next-line @typescript-eslint/naming-convention
      max_tokens: request.parameters?.maxTokens || 1000,
      messages: claudeMessages as ClaudeVertexRequest['messages']
    };

    // Only add optional parameters if they are explicitly set and non-zero
    // Note: When thinking is enabled, temperature must be 1 (Claude constraint)
    if (request.parameters?.temperature !== undefined && request.parameters.temperature > 0) {
      if (request.features?.thinking?.enabled && request.parameters.temperature !== 1) {
        // Enforce Claude thinking constraint: temperature must be 1 when thinking is enabled
        claudeRequest.temperature = 1;
      } else {
        claudeRequest.temperature = request.parameters.temperature;
      }
    }
    if (request.parameters?.topP !== undefined && request.parameters.topP !== 1) {
      claudeRequest.top_p = request.parameters.topP;
    }
    if (request.parameters?.topK !== undefined) {
      claudeRequest.top_k = request.parameters.topK;
    }
    if (request.parameters?.stopSequences && request.parameters.stopSequences.length > 0) {
      claudeRequest.stop_sequences = request.parameters.stopSequences as string[];
    }
    if (streaming === true) {
      claudeRequest.stream = true;
    }

    // Add thinking configuration for Claude 4 and supported models
    if (request.features?.thinking?.enabled) {
      claudeRequest.thinking = {
        type: 'enabled',
        // eslint-disable-next-line @typescript-eslint/naming-convention
        budget_tokens: request.features.thinking.budgetTokens
      };
    }

    // Add system prompt if provided
    if (systemPrompt) {
      claudeRequest.system = systemPrompt;
    }

    // Add tools if provided
    if (request.tools && request.tools.length > 0) {
      claudeRequest.tools = request.tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        input_schema: this.convertZodSchemaToClaudeSchema(tool.inputSchema)
      }));
    }

    return claudeRequest as ClaudeVertexRequest;
  }

  /**
   * Convert Zod schema to Claude input schema format
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
    } catch (error) {
      logger.warn('Failed to convert Zod schema to Claude schema, using fallback', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      // Fallback to permissive schema
      return {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: true
      };
    }
  }

  /**
   * Make API call to Claude on Vertex
   */
  private async callClaudeAPI(
    request: ClaudeVertexRequest,
    model: string,
    context: ProviderExecutionContext,
    originalRequest?: LLMRequest,
    abortSignal?: AbortSignal
  ): Promise<ClaudeVertexResponse> {
    const url = this.buildAPIUrl(model, false);
    const headers = await this.buildHeaders(originalRequest);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        ...(abortSignal && { signal: abortSignal })
      });

      if (!response.ok) {
        await this.handleAPIError(response, context);
      }

      const data = await response.json() as ClaudeVertexResponse;
      return data;

    } catch (error) {
      if (error instanceof LLMErrorClass) {
        throw error;
      }

      throw new LLMErrorClass(createNetworkError(
        this.PROVIDER_NAME,
        `Network error calling Claude Vertex API: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { context: { model, executionId: context.requestId } }
      ));
    }
  }

  /**
   * Make streaming API call to Claude on Vertex
   */
  private async *callClaudeStreamAPI(
    request: ClaudeVertexRequest,
    model: string,
    context: ProviderExecutionContext,
    originalRequest?: LLMRequest,
    abortSignal?: AbortSignal
  ): AsyncIterable<{ 
    type: 'content' | 'thinking' | 'tool_call'; 
    content?: string; 
    thinking?: string;
    toolCall?: { id: string; name: string; arguments: Record<string, unknown> };
    tokenCount?: number 
  }> {
    const url = this.buildAPIUrl(model, true);
    const headers = await this.buildHeaders(originalRequest);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        ...(abortSignal && { signal: abortSignal })
      });

      if (!response.ok) {
        await this.handleAPIError(response, context);
      }

      // Parse streaming response
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body available');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        
        // Process complete chunks
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() && line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6)) as ClaudeStreamChunk;
              
              // Handle different chunk types
              if (data.type === 'content_block_delta') {
                // Check if this is thinking content
                const text = data.delta?.text || '';
                if (this.isThinkingContent(text)) {
                  yield {
                    type: 'thinking',
                    thinking: this.extractThinkingFromDelta(text)
                  };
                } else {
                  yield {
                    type: 'content',
                    content: text,
                    ...(data.usage?.output_tokens !== undefined && { tokenCount: data.usage.output_tokens })
                  };
                }
              } else if (data.type === 'content_block_start' && data.content_block?.type === 'tool_use') {
                yield {
                  type: 'tool_call',
                  toolCall: {
                    id: data.content_block.id || '',
                    name: data.content_block.name || '',
                    arguments: data.content_block.input || {}
                  }
                };
              }
            } catch (parseError) {
              logger.warn('Failed to parse Claude streaming chunk', {
                line,
                error: parseError,
                executionId: context.requestId
              });
            }
          }
        }
      }

    } catch (error) {
      if (error instanceof LLMErrorClass) {
        throw error;
      }

      throw new LLMErrorClass(createNetworkError(
        this.PROVIDER_NAME,
        `Network error in Claude Vertex streaming: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { context: { model, executionId: context.requestId } }
      ));
    }
  }

  /**
   * Build API URL for Claude on Vertex
   */
  private buildAPIUrl(model: string, streaming: boolean): string {
    const baseUrl = `https://${this.region}-aiplatform.googleapis.com/v1`;
    const endpoint = streaming ? 'streamRawPredict' : 'rawPredict';
    return `${baseUrl}/projects/${this.projectId}/locations/${this.region}/publishers/anthropic/models/${model}:${endpoint}`;
  }

  /**
   * Build request headers with Claude 4 beta features support
   */
  private async buildHeaders(request?: LLMRequest): Promise<Record<string, string>> {
    const authHeader = await this.auth.getAuthorizationHeader();
    
    const headers: Record<string, string> = {
       
      'Authorization': authHeader,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'Content-Type': 'application/json',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'User-Agent': 'agentic-framework-llm/1.0.0'
    };

    // Add Claude 4 interleaved thinking beta header if enabled
    if (request?.model.includes('claude-sonnet-4') && 
        request?.features?.thinking?.interleavedThinking && 
        request?.tools && request.tools.length > 0) {
      headers['anthropic-beta'] = 'interleaved-thinking-2025-05-14';
    }

    return headers;
  }

  /**
   * Handle API errors with proper error mapping
   */
  private async handleAPIError(response: Response, context: ProviderExecutionContext): Promise<never> {
    const status = response.status;
    let errorMessage = `Claude API request failed with status ${status}`;

    try {
      const errorBody = await response.text();
      const errorData = JSON.parse(errorBody) as ClaudeErrorResponse;
      errorMessage = errorData.error?.message || errorMessage;

      // Map specific error codes
      if (status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const retryAfterValue = retryAfter ? parseInt(retryAfter) : undefined;
        throw new LLMErrorClass(createRateLimitError(
          this.PROVIDER_NAME,
          errorMessage,
          {
            ...(retryAfterValue !== undefined && { retryAfter: retryAfterValue }),
            context: { executionId: context.requestId }
          }
        ));
      }

      if (status === 503) {
        throw new LLMErrorClass(createModelUnavailableError(
          this.PROVIDER_NAME,
          context.model,
          errorMessage,
          {
            status: 'overloaded',
            retryable: true,
            context: { executionId: context.requestId }
          }
        ));
      }

    } catch {
      errorMessage = response.statusText || errorMessage;
    }

    throw new LLMErrorClass(createNetworkError(
      this.PROVIDER_NAME,
      errorMessage,
      {
        statusCode: status,
        context: { executionId: context.requestId }
      }
    ));
  }

  /**
   * Helper methods for thinking block processing
   */
  private isThinkingContent(text: string): boolean {
    const lowerText = text.toLowerCase();
    return lowerText.includes('<thinking>') || 
           lowerText.includes('<think>') || 
           lowerText.includes('[thinking]');
  }

  private extractThinkingFromDelta(text: string): string {
    // Extract thinking content from delta chunks
    const patterns = [
      /<thinking>(.*?)(?:<\/thinking>|$)/gims,
      /<think>(.*?)(?:<\/think>|$)/gims,
      /\[thinking\](.*?)(?:\[\/thinking\]|$)/gims
    ];
    
    for (const pattern of patterns) {
      const match = pattern.exec(text);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    
    return text; // Return original if no thinking markers found
  }

  /**
   * Estimate thinking token count (rough approximation)
   */
  private estimateThinkingTokens(thinking: string): number {
    // Rough estimate: ~4 characters per token for English text
    return Math.ceil(thinking.length / 4);
  }
}