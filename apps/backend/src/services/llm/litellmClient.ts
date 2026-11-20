import { randomUUID } from 'node:crypto';
import { logger } from '@/utils/logger';
import { isAllowedLiteLLMBaseUrl } from '@/services/orgLLMCredentialService';

/**
 * Chat-completions client for the LiteLLM proxy. Drop-in for the subset of the removed
 * agentic-framework `LLMClient` the backend used: one prompt in, text (or a text stream) out.
 */

interface BaseMessage {
  readonly id: string;
  readonly content: string;
  readonly timestamp: string;
  readonly metadata?: Record<string, unknown>;
}
export interface SystemMessage extends BaseMessage {
  readonly type: 'system';
}
export interface UserMessage extends BaseMessage {
  readonly type: 'user';
}
export interface AssistantMessage extends BaseMessage {
  readonly type: 'assistant';
  readonly thinking?: string;
}
export type Message = SystemMessage | UserMessage | AssistantMessage;

const newMessage = <T extends Message['type']>(type: T, content: string) =>
  ({ id: randomUUID(), type, content, timestamp: new Date().toISOString() }) as Extract<Message, { type: T }>;

export const createUserMessage = (content: string): UserMessage => newMessage('user', content);
export const createSystemMessage = (content: string): SystemMessage => newMessage('system', content);
export const createAssistantMessage = (content: string): AssistantMessage => newMessage('assistant', content);

export interface LiteLLMConfig {
  readonly apiKey: string;
  readonly baseUrl?: string;
  /** Per-attempt request timeout in ms. Default 30s. */
  readonly timeout?: number;
  /** Attempts per request when `retry.maxAttempts` is not set. Default 3. */
  readonly retries?: number;
  readonly customHeaders?: Record<string, string>;
}

export interface LLMClientConfig {
  readonly provider: { readonly type: 'litellm'; readonly config: LiteLLMConfig };
  readonly defaultModel: string;
  /** Wins over a per-request temperature, as in the old client. */
  readonly temperature?: number;
  /** Wins over a per-request maxTokens, as in the old client. */
  readonly maxTokens?: number;
  readonly retry?: {
    readonly maxAttempts?: number;
    readonly baseDelay?: number;
    readonly maxDelay?: number;
    readonly exponentialBackoff?: boolean;
  };
}

export interface GenerateOptions {
  readonly messages: readonly Message[];
  readonly systemPrompt?: string;
  readonly model?: string;
  readonly parameters?: {
    readonly temperature?: number;
    readonly maxTokens?: number;
    readonly topP?: number;
  };
  readonly extraBody?: Record<string, unknown>;
  readonly abortSignal?: AbortSignal;
}

export type FinishReason = 'stop' | 'length' | 'tool_calls' | 'error';

export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface LLMResponse {
  readonly id: string;
  readonly model: string;
  readonly provider: 'litellm';
  readonly content: string;
  readonly thinking?: string;
  readonly usage: TokenUsage;
  readonly finishReason: FinishReason;
  readonly metadata: {
    readonly requestId: string;
    readonly model: string;
    readonly provider: 'litellm';
    readonly timestamp: Date;
    readonly processingTime: number;
    readonly rawResponse?: unknown;
  };
}

export interface StreamChunk {
  readonly id: string;
  readonly type: 'content' | 'thinking' | 'metadata' | 'error' | 'done';
  readonly content?: string;
  readonly thinking?: string;
  readonly error?: string;
  readonly metadata?: { readonly timestamp: Date; readonly model?: string; readonly finishReason?: FinishReason };
}

export interface LLMStreamResult {
  readonly stream: AsyncIterable<StreamChunk>;
  /** Resolves once `stream` has been read to the end. */
  readonly finalMessage: Promise<AssistantMessage>;
  readonly metadata: { readonly requestId: string; readonly provider: 'litellm'; readonly model: string; readonly startTime: Date };
}

class LLMHttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'LLMHttpError';
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 30_000;

const isRetryable = (error: unknown): boolean => {
  if (error instanceof LLMHttpError) return error.status === null || error.status === 429 || error.status >= 500;
  return !(error instanceof Error && error.name === 'AbortError');
};

const toFinishReason = (raw: unknown): FinishReason =>
  raw === 'length' ? 'length' : raw === 'tool_calls' || raw === 'function_call' ? 'tool_calls' : raw === 'error' ? 'error' : 'stop';

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => (part && typeof part === 'object' && 'text' in part ? String(part.text ?? '') : '')).join('');
  }
  return '';
};

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

export class LLMClient {
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;

  constructor(private readonly config: LLMClientConfig) {
    const { baseUrl, apiKey, customHeaders } = config.provider.config;
    if (!isAllowedLiteLLMBaseUrl(baseUrl)) {
      throw new Error('LiteLLM base URL must be the configured LITELLM_BASE_URL');
    }
    this.endpoint = `${baseUrl!.replace(/\/+$/, '')}/chat/completions`;
    this.headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...customHeaders,
    };
  }

  async generate(options: GenerateOptions): Promise<LLMResponse> {
    const model = options.model || this.config.defaultModel;
    const startedAt = Date.now();
    const response = await this.withRetry(options.abortSignal, (signal) => this.post(this.body(options, model, false), signal));
    const raw = (await response.json()) as {
      id?: string;
      model?: string;
      choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown }; finish_reason?: unknown }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const choice = raw.choices?.[0];
    const promptTokens = raw.usage?.prompt_tokens ?? 0;
    const completionTokens = raw.usage?.completion_tokens ?? 0;
    const thinking = textOf(choice?.message?.reasoning_content);
    const requestId = raw.id ?? randomUUID();
    return {
      id: requestId,
      model: raw.model ?? model,
      provider: 'litellm',
      content: textOf(choice?.message?.content),
      ...(thinking ? { thinking } : {}),
      usage: { promptTokens, completionTokens, totalTokens: raw.usage?.total_tokens ?? promptTokens + completionTokens },
      finishReason: toFinishReason(choice?.finish_reason),
      metadata: {
        requestId,
        model: raw.model ?? model,
        provider: 'litellm',
        timestamp: new Date(),
        processingTime: Date.now() - startedAt,
        rawResponse: raw,
      },
    };
  }

  async generateStream(options: GenerateOptions): Promise<LLMStreamResult> {
    const model = options.model || this.config.defaultModel;
    const requestId = randomUUID();
    const response = await this.withRetry(options.abortSignal, (signal) => this.post(this.body(options, model, true), signal), {
      streaming: true,
    });
    if (!response.body) throw new LLMHttpError('LiteLLM returned an empty stream', null);

    let resolveFinal!: (message: AssistantMessage) => void;
    let rejectFinal!: (error: Error) => void;
    const finalMessage = new Promise<AssistantMessage>((resolve, reject) => {
      resolveFinal = resolve;
      rejectFinal = reject;
    });
    finalMessage.catch(() => undefined);

    const body = response.body;
    async function* chunks(): AsyncGenerator<StreamChunk> {
      const decoder = new TextDecoder();
      let buffer = '';
      let content = '';
      let thinking = '';
      try {
        for await (const bytes of body as unknown as AsyncIterable<Uint8Array>) {
          buffer += decoder.decode(bytes, { stream: true });
          let newline: number;
          while ((newline = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') continue;
            let event: {
              choices?: Array<{ delta?: { content?: unknown; reasoning_content?: unknown }; finish_reason?: unknown }>;
              error?: { message?: string };
            };
            try {
              event = JSON.parse(data);
            } catch {
              continue;
            }
            if (event.error) throw new Error(event.error.message ?? 'LiteLLM stream error');
            const choice = event.choices?.[0];
            const reasoning = textOf(choice?.delta?.reasoning_content);
            if (reasoning) {
              thinking += reasoning;
              yield { id: requestId, type: 'thinking', thinking: reasoning };
            }
            const text = textOf(choice?.delta?.content);
            if (text) {
              content += text;
              yield { id: requestId, type: 'content', content: text };
            }
            if (choice?.finish_reason) {
              yield {
                id: requestId,
                type: 'metadata',
                metadata: { timestamp: new Date(), model, finishReason: toFinishReason(choice.finish_reason) },
              };
            }
          }
        }
        yield { id: requestId, type: 'done' };
        resolveFinal({ ...createAssistantMessage(content), ...(thinking ? { thinking } : {}) });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        rejectFinal(err);
        yield { id: requestId, type: 'error', error: err.message };
      }
    }

    return {
      stream: chunks(),
      finalMessage,
      metadata: { requestId, provider: 'litellm', model, startTime: new Date() },
    };
  }

  private body(options: GenerateOptions, model: string, stream: boolean): Record<string, unknown> {
    const temperature = this.config.temperature ?? options.parameters?.temperature;
    const maxTokens = this.config.maxTokens ?? options.parameters?.maxTokens;
    const messages = [
      ...(options.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []),
      ...options.messages.map((message) => ({ role: message.type, content: message.content })),
    ];
    return {
      model,
      messages,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
      ...(options.parameters?.topP !== undefined ? { top_p: options.parameters.topP } : {}),
      ...(stream ? { stream: true } : {}),
      ...(options.extraBody ? { extra_body: options.extraBody } : {}),
    };
  }

  private async post(body: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(this.endpoint, { method: 'POST', headers: this.headers, body: JSON.stringify(body), signal });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new LLMHttpError(`LiteLLM request failed: ${error instanceof Error ? error.message : String(error)}`, null);
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 500);
      throw new LLMHttpError(`LiteLLM returned HTTP ${response.status}: ${detail}`, response.status);
    }
    return response;
  }

  private async withRetry(
    callerSignal: AbortSignal | undefined,
    attempt: (signal: AbortSignal) => Promise<Response>,
    { streaming = false }: { streaming?: boolean } = {},
  ): Promise<Response> {
    const { retry } = this.config;
    const maxAttempts = Math.max(1, retry?.maxAttempts ?? this.config.provider.config.retries ?? DEFAULT_ATTEMPTS);
    const baseDelay = retry?.baseDelay ?? DEFAULT_BASE_DELAY_MS;
    const maxDelay = retry?.maxDelay ?? DEFAULT_MAX_DELAY_MS;
    const timeout = this.config.provider.config.timeout ?? DEFAULT_TIMEOUT_MS;

    for (let n = 1; ; n++) {
      // A stream's body outlives this call, so its timeout only covers getting the response headers.
      const connect = new AbortController();
      const timer = streaming ? setTimeout(() => connect.abort(new Error('LiteLLM connect timeout')), timeout) : undefined;
      const limit = streaming ? connect.signal : AbortSignal.timeout(timeout);
      const signal = callerSignal ? AbortSignal.any([callerSignal, limit]) : limit;
      try {
        return await attempt(signal);
      } catch (error) {
        if (callerSignal?.aborted || n >= maxAttempts || !isRetryable(error)) throw error;
        const delay = Math.min(maxDelay, retry?.exponentialBackoff === false ? baseDelay : baseDelay * 2 ** (n - 1));
        logger.warn('[LiteLLM] Request failed, retrying', {
          attempt: n,
          maxAttempts,
          delayMs: delay,
          error: error instanceof Error ? error.message : String(error),
        });
        await sleep(delay, callerSignal);
      } finally {
        clearTimeout(timer);
      }
    }
  }
}
