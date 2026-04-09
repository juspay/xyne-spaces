/**
 * Unified Bot Framework - External Runtime
 *
 * Handles execution of external (config-based) bots via HTTP/SSE.
 * Uses pluggable adapters for SSE parsing and authentication.
 */

import type {
  BotCatalogEntry,
  BotExecutionContext,
  BotEvent,
  ExternalBotDefinition,
  ToolOutput,
} from '../types/index.js';
import type { ExecutionRequest } from '../orchestrator/execution-orchestrator.js';
import {
  createContentEvent,
  createToolOutputEvent,
  createDoneEvent,
  createErrorEvent,
  isExternalBot,
} from '../types/index.js';
import { sseParserRegistry } from '../adapters/index.js';
import { logger } from '@/utils/logger';

/**
 * External Bot Runtime
 *
 * Executes external bots via HTTP/SSE with pluggable adapters.
 */
class ExternalBotRuntime {
  /**
   * Execute an external bot
   * Returns an async generator of BotEvents
   */
  async *execute(
    entry: BotCatalogEntry,
    context: BotExecutionContext,
    request: ExecutionRequest
  ): AsyncGenerator<BotEvent> {
    const definition = entry.definition;

    if (!isExternalBot(definition)) {
      throw new Error('Expected external bot definition');
    }

    const { externalApi } = definition;

    // Build request
    const requestBody = this.buildRequestBody(definition, context, request);
    const headers = this.buildHeaders(definition, context, request);

    try {
      // Make HTTP request
      const response = await fetch(externalApi.endpoint, {
        method: externalApi.method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`External API error: ${response.status} - ${errorText}`);
      }

      if (externalApi.responseType === 'streaming') {
        yield* this.handleStreamingResponse(response, definition);
      } else {
        yield* this.handleNonStreamingResponse(response);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[ExternalBotRuntime] Execution error for ${definition.id}:`, errorMessage);
      yield createErrorEvent(errorMessage);
    }
  }

  /**
   * Handle streaming SSE response using pluggable parser
   */
  private async *handleStreamingResponse(
    response: Response,
    definition: ExternalBotDefinition
  ): AsyncGenerator<BotEvent> {
    if (!response.body) {
      throw new Error('No response body from external API');
    }

    // Get the appropriate SSE parser based on config
    const parserName = definition.externalApi.sseParser || 'default';
    const parser = sseParserRegistry.get(parserName);

    // Delegate to the parser
    yield* parser.parseStream(response.body.getReader());
  }

  /**
   * Handle non-streaming response
   */
  private async *handleNonStreamingResponse(response: Response): AsyncGenerator<BotEvent> {
    const data = await response.json();
    const { content, toolOutputs } = this.extractContentAndToolOutputs(data);

    if (content) {
      yield createContentEvent(content, content);
    }

    if (toolOutputs) {
      for (const output of toolOutputs) {
        yield createToolOutputEvent(output);
      }
    }

    yield createDoneEvent(content, undefined, toolOutputs);
  }

  /**
   * Extract content and tool outputs from response data
   */
  private extractContentAndToolOutputs(data: unknown): {
    content: string;
    toolOutputs?: ToolOutput[];
  } {
    if (typeof data === 'string') {
      return { content: data };
    }

    if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      let content = '';

      // Extract content
      if (typeof obj.content === 'string') {
        content = obj.content;
      } else if (typeof obj.message === 'string') {
        content = obj.message;
      } else if (typeof obj.response === 'string') {
        content = obj.response;
      } else if (typeof obj.text === 'string') {
        content = obj.text;
      } else {
        content = JSON.stringify(data);
      }

      // Extract tool outputs
      let toolOutputs: ToolOutput[] | undefined;
      if (Array.isArray(obj.tool_outputs)) {
        toolOutputs = obj.tool_outputs as ToolOutput[];
      } else if (Array.isArray(obj.toolOutputs)) {
        toolOutputs = obj.toolOutputs as ToolOutput[];
      }

      return { content, toolOutputs };
    }

    return { content: JSON.stringify(data) };
  }

  /**
   * Build request body from template
   */
  private buildRequestBody(
    definition: ExternalBotDefinition,
    context: BotExecutionContext,
    request: ExecutionRequest
  ): Record<string, unknown> {
    const { externalApi } = definition;
    const template = externalApi.requestBodyTemplate || {
      message: '{{message}}',
    };

    const replacePlaceholders = (obj: unknown): unknown => {
      if (typeof obj === 'string') {
        return obj
          .replace('{{message}}', request.message)
          .replace('{{userId}}', request.userId)
          .replace('{{userEmail}}', request.userEmail || '')
          .replace('{{userName}}', request.userName || '')
          .replace('{{channelId}}', request.channelId)
          .replace('{{conversationId}}', request.conversationId)
          .replace('{{sessionId}}', context.sessionId || '');
      }

      if (Array.isArray(obj)) {
        return obj.map(replacePlaceholders);
      }

      if (obj && typeof obj === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
          result[key] = replacePlaceholders(value);
        }
        return result;
      }

      return obj;
    };

    const requestBody = replacePlaceholders(template) as Record<string, unknown>;

    // Add session_id if available
    if (context.sessionId) {
      requestBody.session_id = context.sessionId;
    }

    return requestBody;
  }

  /**
   * Build headers for request
   */
  private buildHeaders(
    definition: ExternalBotDefinition,
    _context: BotExecutionContext,
    request: ExecutionRequest
  ): Record<string, string> {
    const { externalApi } = definition;
    const headers: Record<string, string> = {
      ...externalApi.headers,
    };

    // Add authentication
    switch (externalApi.authType) {
      case 'api_key':
        if (externalApi.authEnvVar) {
          const apiKey = process.env[externalApi.authEnvVar];
          logger.info(`[ExternalBotRuntime] API key auth - envVar: ${externalApi.authEnvVar}, key present: ${!!apiKey}`);
          if (apiKey) {
            const headerName = externalApi.authHeader || 'X-API-Key';
            headers[headerName] = apiKey;
            logger.info(`[ExternalBotRuntime] Added ${headerName} header`);
          } else {
            logger.warn(`[ExternalBotRuntime] API key not found in env: ${externalApi.authEnvVar}`);
          }
        }
        break;
    }

    // Add context headers
    headers['X-Xyne-User-Id'] = request.userId;
    headers['X-Xyne-Channel-Id'] = request.channelId;
    headers['X-Xyne-Conversation-Id'] = request.conversationId;
    if (request.userEmail) {
      headers['X-Xyne-User-Email'] = request.userEmail;
    }
    if (request.userName) {
      headers['X-Xyne-User-Name'] = request.userName;
    }

    return headers;
  }
}

// Export singleton instance
export const externalBotRuntime = new ExternalBotRuntime();
