import type {
  AiBuilderMessage,
  AiBuilderChatRequest,
  BuilderChatResponse,
  ApprovalChatResponse,
  ChatStreamHandlers,
  WorkflowConfig,
} from './types.js';

export interface AiBuilderClientOptions {
  /**
   * Workflow API base URL — the same value passed to `createWorkflowClient`
   * (e.g. `http://localhost:3457/api/workflows` or `https://host/api/workflows`).
   */
  baseUrl: string;
  /** Returns extra headers (auth, tenant, etc.) per request. */
  getHeaders?: () => Record<string, string>;
}

/**
 * HTTP client for the AI builder chat endpoint.
 * Stateless — caller manages the message history array.
 */
export class AiBuilderClient {
  readonly baseUrl: string;

  constructor(private readonly options: AiBuilderClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
  }

  async chat(
    messages: AiBuilderMessage[],
    currentConfig: WorkflowConfig,
  ): Promise<BuilderChatResponse> {
    const body: AiBuilderChatRequest = { messages, currentConfig };
    return this._post(body) as Promise<BuilderChatResponse>;
  }

  async approvalChat(
    messages: AiBuilderMessage[],
    executionId: string,
    currentFormValues?: Record<string, unknown>,
  ): Promise<ApprovalChatResponse> {
    const body: AiBuilderChatRequest = { messages, mode: 'approval', executionId, ...(currentFormValues ? { currentFormValues } : {}) };
    return this._post(body) as Promise<ApprovalChatResponse>;
  }

  /** Streaming builder chat — text snapshots + tool chips + final patch. */
  async chatStream(
    messages: AiBuilderMessage[],
    currentConfig: WorkflowConfig,
    handlers: ChatStreamHandlers,
    signal?: AbortSignal,
  ): Promise<void> {
    return this._postStream({ messages, currentConfig }, handlers, signal);
  }

  /** Streaming approval chat — text snapshots + tool chips + final form-fill. */
  async approvalChatStream(
    messages: AiBuilderMessage[],
    executionId: string,
    handlers: ChatStreamHandlers,
    currentFormValues?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<void> {
    return this._postStream(
      { messages, mode: 'approval', executionId, ...(currentFormValues ? { currentFormValues } : {}) },
      handlers,
      signal,
    );
  }

  /** POST + consume an SSE response, dispatching frames to `handlers`. */
  private async _postStream(
    body: AiBuilderChatRequest,
    handlers: ChatStreamHandlers,
    signal?: AbortSignal,
  ): Promise<void> {
    const res = await fetch(`${this.baseUrl}/ai-builder/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...this.options.getHeaders?.(),
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`AI builder request failed (${res.status}): ${text}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let terminated = false;

    const dispatch = (eventName: string, data: string): void => {
      let payload: Record<string, unknown> = {};
      try { payload = data ? (JSON.parse(data) as Record<string, unknown>) : {}; } catch { return; }
      switch (eventName) {
        case 'text': handlers.onText?.(String(payload['text'] ?? '')); break;
        case 'tool': handlers.onTool?.(payload as unknown as { id: string; name: string; status: 'start' | 'end'; isError?: boolean }); break;
        case 'formfill': handlers.onFormFill?.(payload['formFill'] as Record<string, unknown>); break;
        case 'patch': handlers.onPatch?.(payload['workflowPatch'] as WorkflowConfig); break;
        case 'done': terminated = true; handlers.onDone?.(String(payload['message'] ?? '')); break;
        case 'error': terminated = true; handlers.onError?.(String(payload['error'] ?? 'Unknown error')); break;
        default: break;
      }
    };

    // SSE frames are separated by a blank line; each frame has `event:`/`data:` lines.
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        let eventName = 'message';
        let data = '';
        for (const line of raw.split('\n')) {
          if (line.startsWith('event:')) eventName = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        dispatch(eventName, data);
      }
    }

    // Reader finished without a `done`/`error` frame — connection lost mid-stream.
    if (!terminated && !signal?.aborted) {
      throw new Error('Connection lost before the response finished. Check your internet and try again.');
    }
  }

  private async _post(body: AiBuilderChatRequest): Promise<BuilderChatResponse | ApprovalChatResponse> {
    const res = await fetch(`${this.baseUrl}/ai-builder/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.options.getHeaders?.(),
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`AI builder request failed (${res.status}): ${text}`);
    }

    return res.json() as Promise<BuilderChatResponse | ApprovalChatResponse>;
  }
}
