import type {
  LLMRequest,
  LLMResponse,
  ModelCapabilities,
  ProviderExecutionContext
} from '../../../core/types/index.js';
import type { StreamChunk } from '../../../core/types/streaming.js';
import type { VertexAuthConfig, VertexGenerationRequest, VertexGenerationResponse } from '../schemas.js';
import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Gemini API response interfaces
interface GeminiCandidate {
  content?: {
    parts?: Array<{ 
      text?: string;
      thought?: boolean; // Flag indicating if this part is thinking content
    }>;
  };
  finishReason?: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER';
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    thoughtsTokenCount?: number; // Gemini 2.5 thinking tokens
  };
  modelVersion?: string;
  finishReason?: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER';
}

interface GeminiErrorResponse {
  error?: { message?: string };
}

// SSE event interface
interface SSEEvent {
  event?: string;
  data: string;
  id?: string;
  retry?: number;
}

// Gemini streaming chunk interface
interface GeminiStreamChunk {
  content: string;
  thinking?: string; // Explicit thinking content when available
  tokenCount?: number | undefined;
  isThinking?: boolean | undefined;
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'error' | undefined;
}
import { VertexAuth } from '../auth/vertex-auth.js';
import {
  convertToVertexFormat,
  extractSystemPrompt,
  convertFromVertexResponse
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
 * Gemini model provider for Vertex AI
 * Handles Gemini-specific API interactions and response processing
 */
export class GeminiProvider {
  private readonly auth: VertexAuth;
  private readonly projectId: string;
  private readonly region: string;
  private readonly PROVIDER_NAME = 'vertex';

  // Supported Gemini models
  private readonly SUPPORTED_MODELS = [
    'gemini-2.5-pro',
  ] as const;

  // Model capabilities mapping
  private readonly MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'gemini-2.5-pro': {
      supportsToolCalling: true,
      supportsStreaming: true,
      supportsThinking: true, // Enhanced thinking capabilities
      supportsVision: true,
      maxTokens: 8192,
      maxInputTokens: 2097152
    }
  };

  constructor(auth: VertexAuth, _config: VertexAuthConfig) {
    this.auth = auth;
    this.projectId = auth.getProjectId();
    this.region = auth.getRegion();

    logger.debug('Gemini provider initialized', {
      projectId: this.projectId,
      region: this.region,
      supportedModels: this.SUPPORTED_MODELS
    });
  }

  /**
   * Generate response using Gemini model
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
          `Model ${request.model} is not supported by Gemini provider`
        ));
      }

      // Convert messages to Vertex format
      const vertexMessages = convertToVertexFormat(request.messages);
      const systemPrompt = request.systemPrompt || extractSystemPrompt(request.messages);

      // Build Vertex request
      const vertexRequest = this.buildVertexRequest(
        request,
        vertexMessages,
        systemPrompt
      );

      logger.debug('Sending request to Gemini API', {
        model: request.model,
        messageCount: vertexMessages.length,
        hasSystemPrompt: !!systemPrompt,
        hasTools: !!(request.tools && request.tools.length > 0),
        executionId: context.requestId
      });

      // Make API call
      const vertexResponse = await this.callGeminiAPI(vertexRequest, request.model, context, abortSignal);

      // Convert response back to common format
      const response = convertFromVertexResponse(vertexResponse, context.requestId);

      // Build final LLM response
      const llmResponse: LLMResponse = {
        id: context.requestId,
        model: request.model,
        provider: this.PROVIDER_NAME,
        content: response.content,
        ...(response.thinking && { thinking: response.thinking }),
        ...(response.toolCalls && { toolCalls: response.toolCalls }),
        usage: {
          promptTokens: vertexResponse.usageMetadata?.promptTokenCount || 0,
          completionTokens: vertexResponse.usageMetadata?.candidatesTokenCount || 0,
          totalTokens: vertexResponse.usageMetadata?.totalTokenCount || 0,
          ...(vertexResponse.usageMetadata?.thoughtsTokenCount && { 
            thinkingTokens: vertexResponse.usageMetadata.thoughtsTokenCount 
          })
        },
        metadata: {
          requestId: context.requestId,
          model: request.model,
          provider: this.PROVIDER_NAME,
          timestamp: new Date(),
          processingTime: Date.now() - context.startTime.getTime(),
          apiVersion: 'v1',
          region: this.region
        },
        finishReason: response.finishReason
      };

      logger.debug('Gemini API request completed successfully', {
        model: request.model,
        contentLength: response.content.length,
        toolCallsCount: response.toolCalls?.length || 0,
        usage: llmResponse.usage,
        executionId: context.requestId
      });

      return llmResponse;

    } catch (error) {
      logger.error('Gemini generation failed', error as Error, {
        model: request.model,
        executionId: context.requestId
      });

      if (error instanceof LLMErrorClass) {
        throw error;
      }

      throw new LLMErrorClass(createProviderExecutionError(
        this.PROVIDER_NAME,
        error instanceof Error ? error.message : 'Unknown error during generation',
        true,
        {
          model: request.model,
          executionId: context.requestId
        }
      ));
    }
  }

  /**
   * Generate streaming response using Gemini model
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
          `Model ${request.model} is not supported by Gemini provider`
        ));
      }

      // Convert messages to Vertex format
      const vertexMessages = convertToVertexFormat(request.messages);
      const systemPrompt = request.systemPrompt || extractSystemPrompt(request.messages);

      // Build Vertex request for streaming
      const vertexRequest = this.buildVertexRequest(
        request,
        vertexMessages,
        systemPrompt,
        true // Enable streaming
      );

      logger.debug('Starting Gemini streaming request', {
        model: request.model,
        messageCount: vertexMessages.length,
        executionId: context.requestId
      });

      // Make streaming API call
      const stream = this.callGeminiStreamAPI(vertexRequest, request.model, context, abortSignal);

      let chunkIndex = 0;
      for await (const chunk of stream) {
        
        // Yield thinking chunk if available
        if (chunk.thinking) {
          yield {
            id: `gemini-thinking-${chunkIndex++}`,
            type: 'thinking',
            thinking: chunk.thinking,
            delta: true,
            index: chunkIndex,
            metadata: {
              timestamp: new Date(),
              model: request.model,
              provider: this.PROVIDER_NAME,
              ...(chunk.tokenCount !== undefined && { tokenCount: chunk.tokenCount })
            }
          };
        }

        // Yield content chunk if available
        if (chunk.content) {
          yield {
            id: `gemini-content-${chunkIndex++}`,
            type: 'content',
            content: chunk.content,
            delta: true,
            index: chunkIndex,
            metadata: {
              timestamp: new Date(),
              model: request.model,
              provider: this.PROVIDER_NAME,
              ...(chunk.tokenCount !== undefined && { tokenCount: chunk.tokenCount }),
              ...(chunk.finishReason && { finishReason: chunk.finishReason })
            }
          };
        }

        // Handle thinking-only chunks (when thinking tokens used but no visible content)
        if (!chunk.content && !chunk.thinking && chunk.isThinking) {
          yield {
            id: `gemini-thinking-${chunkIndex++}`,
            type: 'thinking',
            thinking: '', // Empty thinking content but indicates internal reasoning
            delta: true,
            index: chunkIndex,
            metadata: {
              timestamp: new Date(),
              model: request.model,
              provider: this.PROVIDER_NAME,
              ...(chunk.tokenCount !== undefined && { tokenCount: chunk.tokenCount }),
              ...(chunk.finishReason && { finishReason: chunk.finishReason })
            }
          };
        }
      }
      

      // Send done chunk
      yield {
        id: `gemini-done-${Date.now()}`,
        type: 'done',
        delta: false,
        metadata: {
          timestamp: new Date(),
          model: request.model,
          provider: this.PROVIDER_NAME
        }
      };

    } catch (error) {
      logger.error('Gemini streaming failed', error as Error, {
        model: request.model,
        executionId: context.requestId
      });

      if (error instanceof LLMErrorClass) {
        throw error;
      }

      throw new LLMErrorClass(createProviderExecutionError(
        this.PROVIDER_NAME,
        error instanceof Error ? error.message : 'Unknown error during streaming',
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
   * Build Vertex AI API request with thinking support
   */
  private buildVertexRequest(
    request: LLMRequest,
    vertexMessages: Record<string, unknown>[],
    systemPrompt?: string,
    _streaming = false
  ): VertexGenerationRequest {
    const vertexRequest: VertexGenerationRequest = {
      contents: vertexMessages as VertexGenerationRequest['contents'],
      generationConfig: {
        candidateCount: 1,
        temperature: request.parameters?.temperature,
        topP: request.parameters?.topP,
        topK: request.parameters?.topK,
        maxOutputTokens: request.parameters?.maxTokens,
        stopSequences: request.parameters?.stopSequences as string[] | undefined
      }
    };

    // Add thinking configuration for Gemini 2.5 models within generationConfig
    if (request.features?.thinking?.enabled) {
      vertexRequest.generationConfig = {
        candidateCount: 1, // Ensure required field is preserved
        ...vertexRequest.generationConfig,
        thinkingConfig: {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          thinking_budget: request.features.thinking.budgetTokens || -1, // -1 = dynamic
          // eslint-disable-next-line @typescript-eslint/naming-convention
          include_thoughts: request.features.thinking.includeThoughts || false
        }
      };
    }

    // Add system instruction if provided
    if (systemPrompt) {
      vertexRequest.systemInstruction = {
        parts: [{ text: systemPrompt }]
      };
    }

    // Add tools if provided
    if (request.tools && request.tools.length > 0) {
      vertexRequest.tools = [{
        functionDeclarations: request.tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          parameters: this.convertZodSchemaToVertexParameters(tool.inputSchema)
        }))
      }];
    }

    return vertexRequest;
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

  /**
   * Make API call to Gemini
   */
  private async callGeminiAPI(
    request: VertexGenerationRequest,
    model: string,
    context: ProviderExecutionContext,
    abortSignal?: AbortSignal
  ): Promise<VertexGenerationResponse> {
    const url = this.buildAPIUrl(model, false);
    const headers = await this.buildHeaders();

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

      const data = await response.json() as VertexGenerationResponse;
      return data;

    } catch (error) {
      if (error instanceof LLMErrorClass) {
        throw error;
      }

      throw new LLMErrorClass(createNetworkError(
        this.PROVIDER_NAME,
        `Network error calling Gemini API: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { context: { model, executionId: context.requestId } }
      ));
    }
  }

  /**
   * Make streaming API call to Gemini with enhanced SSE parsing
   */
  private async *callGeminiStreamAPI(
    request: VertexGenerationRequest,
    model: string,
    context: ProviderExecutionContext,
    abortSignal?: AbortSignal
  ): AsyncIterable<GeminiStreamChunk> {
    const url = this.buildAPIUrl(model, true);
    const headers = await this.buildHeaders();

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

      // Check if response is actually SSE or JSON
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        const jsonResponse = await response.text();
        
        // Parse as JSON array response (Gemini streaming returns array of responses)
        try {
          const jsonData: unknown = JSON.parse(jsonResponse);
          
          // Handle both single object and array responses
          const responses = Array.isArray(jsonData) ? jsonData : [jsonData];
          
          for (const data of responses) {
            const processed = this.processGeminiChunk(data as GeminiResponse);
            if (processed) {
              yield processed;
            }
          }
        } catch (parseError) {
          logger.warn('Failed to parse Gemini JSON response', { error: parseError });
        }
        return;
      }

      // Enhanced SSE parsing with proper error recovery
      for await (const chunk of this.parseSSEStream(response, context)) {
        yield chunk;
      }

    } catch (error) {
      if (error instanceof LLMErrorClass) {
        throw error;
      }

      throw new LLMErrorClass(createNetworkError(
        this.PROVIDER_NAME,
        `Network error in Gemini streaming: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { context: { model, executionId: context.requestId } }
      ));
    }
  }

  /**
   * Enhanced SSE stream parser with proper event handling
   */
  private async *parseSSEStream(
    response: Response,
    context: ProviderExecutionContext
  ): AsyncIterable<GeminiStreamChunk> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body available');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        
        // Debug logging
        logger.debug('Gemini streaming buffer:', { 
          buffer: buffer.substring(0, 200),
          bufferLength: buffer.length,
          executionId: context.requestId 
        });
        
        // Process complete SSE events
        const events = this.extractSSEEvents(buffer);
        buffer = events.remainder;
        
        logger.debug('Gemini SSE events extracted:', { 
          eventCount: events.events.length,
          events: events.events.map(e => ({ data: e.data?.substring(0, 100) })),
          executionId: context.requestId 
        });
        
        for (const event of events.events) {
          if (event.data && event.data !== '[DONE]') {
            try {
              const chunk = JSON.parse(event.data) as GeminiResponse;
              logger.debug('Gemini chunk parsed:', { 
                chunk: JSON.stringify(chunk, null, 2),
                executionId: context.requestId 
              });
              const processed = this.processGeminiChunk(chunk);
              logger.debug('Gemini chunk processed:', { 
                processed: JSON.stringify(processed, null, 2),
                executionId: context.requestId 
              });
              if (processed) {
                yield processed;
              }
            } catch (parseError) {
              logger.warn('Failed to parse SSE chunk', { 
                event, 
                parseError,
                executionId: context.requestId 
              });
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Extract SSE events from buffer with proper parsing
   */
  private extractSSEEvents(buffer: string): { events: SSEEvent[], remainder: string } {
    const events: SSEEvent[] = [];
    const lines = buffer.split('\n');
    let currentEvent: Partial<SSEEvent> = {};
    let i = 0;

    while (i < lines.length) {
      const rawLine = lines[i];
      if (rawLine === undefined) {
        i++;
        continue;
      }
      
      const line = rawLine.trim();
      
      if (line === '') {
        // End of event
        if (currentEvent.data !== undefined) {
          events.push(currentEvent as SSEEvent);
        }
        currentEvent = {};
      } else if (line.startsWith('data: ')) {
        const data = line.substring(6);
        if (currentEvent.data) {
          currentEvent.data += '\n' + data;
        } else {
          currentEvent.data = data;
        }
      } else if (line.startsWith('event: ')) {
        currentEvent.event = line.substring(7);
      } else if (line.startsWith('id: ')) {
        currentEvent.id = line.substring(4);
      } else if (line.startsWith('retry: ')) {
        const retryValue = parseInt(line.substring(7), 10);
        if (!isNaN(retryValue)) {
          currentEvent.retry = retryValue;
        }
      }
      
      i++;
    }

    // Calculate remainder for incomplete events
    let remainderStartIndex = i;
    if (currentEvent.data !== undefined) {
      // Find the start of the incomplete event
      remainderStartIndex = Math.max(0, i - Object.keys(currentEvent).length);
    }
    
    const remainder = lines.slice(remainderStartIndex).join('\n');
    
    return { events, remainder };
  }

  /**
   * Process Gemini response chunk into stream chunk
   */
  private processGeminiChunk(response: GeminiResponse): GeminiStreamChunk | null {
    
    // Handle case where there's thinking tokens but no visible content
    const hasThinkingTokens = response.usageMetadata?.thoughtsTokenCount || 0;
    const hasContent = response.candidates && response.candidates.length > 0;
    
    if (hasThinkingTokens > 0 && !hasContent) {
      // Return a thinking chunk to indicate internal reasoning occurred
      return {
        content: '', // Empty content since thinking was internal
        tokenCount: hasThinkingTokens,
        isThinking: true,
        finishReason: 'stop' // Thinking completed
      };
    }

    if (!response.candidates || response.candidates.length === 0) {
      return null;
    }

    const candidate = response.candidates[0];
    if (!candidate?.content?.parts) {
      // Still return a chunk if we have usage metadata
      if (response.usageMetadata) {
        return {
          content: '',
          tokenCount: response.usageMetadata.candidatesTokenCount || 0,
          isThinking: hasThinkingTokens > 0,
          finishReason: candidate ? this.mapGeminiFinishReason(candidate.finishReason) : undefined
        };
      }
      return null;
    }

    let content = '';
    let thinking = '';
    let isThinking = false;

    for (const part of candidate.content.parts) {
      if (part.text) {
        if (part.thought) {
          // This part is explicitly marked as thinking content
          thinking += part.text;
          isThinking = true;
        } else {
          // Regular content part
          content += part.text;
        }
      }
    }


    return {
      content,
      ...(thinking && { thinking }),
      ...(response.usageMetadata?.candidatesTokenCount !== undefined && { tokenCount: response.usageMetadata.candidatesTokenCount }),
      // Mark as thinking if we have explicit thinking content or thinking tokens were used
      ...(isThinking || (hasThinkingTokens > 0 && !content)) && { isThinking: true },
      ...(candidate.finishReason && { finishReason: this.mapGeminiFinishReason(candidate.finishReason) })
    };
  }


  /**
   * Map Gemini finish reason to our standard format
   */
  private mapGeminiFinishReason(finishReason?: string): 'stop' | 'length' | 'tool_calls' | 'error' | undefined {
    if (!finishReason) return undefined;
    
    switch (finishReason) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'SAFETY':
      case 'RECITATION':
      case 'OTHER':
        return 'error';
      default:
        return 'stop';
    }
  }

  /**
   * Build API URL for Gemini
   */
  private buildAPIUrl(model: string, streaming: boolean): string {
    const baseUrl = `https://${this.region}-aiplatform.googleapis.com/v1`;
    const endpoint = streaming ? 'streamGenerateContent' : 'generateContent';
    return `${baseUrl}/projects/${this.projectId}/locations/${this.region}/publishers/google/models/${model}:${endpoint}`;
  }

  /**
   * Build request headers
   */
  private async buildHeaders(): Promise<Record<string, string>> {
    const authHeader = await this.auth.getAuthorizationHeader();
    
    return {
       
      'Authorization': authHeader,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'Content-Type': 'application/json',
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'User-Agent': 'agentic-framework-llm/1.0.0'
    };
  }

  /**
   * Handle API errors with proper error mapping
   */
  private async handleAPIError(response: Response, context: ProviderExecutionContext): Promise<never> {
    const status = response.status;
    let errorMessage = `API request failed with status ${status}`;

    try {
      const errorBody = await response.text();
      const errorData = JSON.parse(errorBody) as GeminiErrorResponse;
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
      // If we can't parse the error, use the status text
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
}
