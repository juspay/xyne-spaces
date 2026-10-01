/**
 * Fast-model calls for agent authoring (classify, judge, instructions).
 *
 * All three go to the suggest model (`LITELLM_SUGGEST_*`, a fast proxy model
 * such as gemini-2.5-flash) with thinking turned off: these are short
 * structured jobs, and a reasoning model spends most of its budget thinking.
 *
 * When that endpoint can't be reached (a local proxy that isn't running is the
 * usual case) the call goes to the main LiteLLM endpoint and fast model instead,
 * and the suggest endpoint is skipped for a minute, so a draft never quietly
 * degrades to templates just because one proxy is down.
 */
import { LITELLM } from "../config.js";
import { createLogger } from "../logger.js";

const log = createLogger("authoring-llm");

interface Endpoint {
  url: string;
  apiKey: string;
  model: string;
}

const SUGGEST_ENDPOINT: Endpoint = {
  url: LITELLM.suggestUrl,
  apiKey: LITELLM.suggestApiKey,
  model: LITELLM.suggestModel,
};
const MAIN_ENDPOINT: Endpoint = { url: LITELLM.url, apiKey: LITELLM.apiKey, model: LITELLM.fastModel };
/** The Build chat's conversational answers. No fallback here: the caller retries on the fast one. */
const TALK_ENDPOINT: Endpoint = { url: LITELLM.url, apiKey: LITELLM.apiKey, model: LITELLM.talkModel };
const SUGGEST_DOWN_MS = 60_000;
/**
 * Answers worth one more try: rate limited, or the proxy briefly unable to reach
 * the model. Under load the fast endpoint returns these, or drops the
 * connection, for a share of calls that succeed when sent again a moment later.
 */
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const RETRY_DELAY_MS = { min: 350, max: 900 };

/** Waits a short random beat (so parallel retries don't land together); false if cancelled meanwhile. */
function retryPause(signal: AbortSignal): Promise<boolean> {
  const ms = RETRY_DELAY_MS.min + Math.random() * (RETRY_DELAY_MS.max - RETRY_DELAY_MS.min);
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false);
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(false);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
let suggestDownUntil = 0;

/** Endpoints to try, in order: the suggest proxy (unless it just failed to connect), then the main one. */
function endpoints(): Endpoint[] {
  const distinct = MAIN_ENDPOINT.url !== SUGGEST_ENDPOINT.url && Boolean(MAIN_ENDPOINT.url);
  if (!distinct) return [SUGGEST_ENDPOINT];
  return Date.now() < suggestDownUntil ? [MAIN_ENDPOINT] : [SUGGEST_ENDPOINT, MAIN_ENDPOINT];
}

export type AuthoringLlmErrorKind = "timeout" | "aborted" | "http" | "parse";

export class AuthoringLlmError extends Error {
  constructor(
    readonly kind: AuthoringLlmErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AuthoringLlmError";
  }
}

export interface AuthoringMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AuthoringLlmOptions {
  maxTokens: number;
  timeoutMs: number;
  temperature?: number;
  /** Caller cancellation (client closed the stream, the turn timed out). */
  signal?: AbortSignal;
  /** `talk` sends the call to the main model for a conversational answer. */
  endpoint?: "suggest" | "talk";
}

/** Fast models wrap JSON in ```json fences or add prose despite response_format. */
export function parseLooseJson<T>(raw: string): T | null {
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  }
  if (!text.startsWith("{") && !text.startsWith("[")) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) text = text.slice(start, end + 1);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function linkSignals(options: AuthoringLlmOptions): { signal: AbortSignal; timedOut: () => boolean } {
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  return { signal, timedOut: () => timeout.aborted && !options.signal?.aborted };
}

function requestBody(
  model: string,
  messages: AuthoringMessage[],
  options: AuthoringLlmOptions,
  extras: { json?: boolean; stream?: boolean; thinkingOff: boolean },
): string {
  return JSON.stringify({
    model,
    messages,
    max_tokens: options.maxTokens,
    temperature: options.temperature ?? 0.3,
    ...(extras.json ? { response_format: { type: "json_object" } } : {}),
    ...(extras.stream ? { stream: true } : {}),
    // A reasoning model otherwise spends the budget on hidden thinking.
    ...(extras.thinkingOff ? { reasoning_effort: "none", thinking: { type: "disabled" } } : {}),
  });
}

async function post(
  messages: AuthoringMessage[],
  options: AuthoringLlmOptions,
  extras: { json?: boolean; stream?: boolean },
): Promise<{ res: Response; timedOut: () => boolean }> {
  const [first, ...rest] = options.endpoint === "talk" ? [TALK_ENDPOINT] : endpoints();
  let endpoint = first!;
  const { signal, timedOut } = linkSignals(options);
  const send = async (thinkingOff: boolean): Promise<Response> => {
    const request = (target: Endpoint): Promise<Response> =>
      fetch(`${target.url}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${target.apiKey}` },
        body: requestBody(target.model, messages, options, { ...extras, thinkingOff }),
        signal,
      });
    try {
      return await request(endpoint);
    } catch (err) {
      // Could not connect at all (not a timeout or a cancel): try the next endpoint.
      const next = rest.shift();
      if (!next || signal.aborted) throw err;
      suggestDownUntil = Date.now() + SUGGEST_DOWN_MS;
      log.warn(
        `[authoring] ${endpoint.url} unreachable (${err instanceof Error ? err.message : String(err)}); using ${next.url} (${next.model}) for ${SUGGEST_DOWN_MS / 1000}s`,
      );
      endpoint = next;
      return request(endpoint);
    }
  };
  // One more try, within the same time budget, for a dropped connection or a
  // retryable status.
  const sendWithRetry = async (thinkingOff: boolean): Promise<Response> => {
    let res: Response;
    try {
      res = await send(thinkingOff);
    } catch (err) {
      if (signal.aborted || !(await retryPause(signal))) throw err;
      log.warn(`[authoring] ${endpoint.url} connection failed; retrying once`);
      return send(thinkingOff);
    }
    if (!RETRYABLE_STATUS.has(res.status) || signal.aborted) return res;
    await res.body?.cancel().catch(() => undefined);
    if (!(await retryPause(signal))) return res;
    log.warn(`[authoring] ${endpoint.url} returned ${res.status}; retrying once`);
    return send(thinkingOff);
  };
  try {
    let res = await sendWithRetry(true);
    if (res.status === 400) {
      // A proxy that does not know the thinking params rejects them; retry without.
      const text = await res.text().catch(() => "");
      if (/reasoning|thinking/i.test(text)) res = await sendWithRetry(false);
      else throw new AuthoringLlmError("http", `LLM returned 400: ${text.slice(0, 160)}`, 400);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new AuthoringLlmError("http", `LLM returned ${res.status}: ${text.slice(0, 160)}`, res.status);
    }
    return { res, timedOut };
  } catch (err) {
    if (err instanceof AuthoringLlmError) throw err;
    if (timedOut()) throw new AuthoringLlmError("timeout", `LLM timed out after ${options.timeoutMs}ms`);
    if (options.signal?.aborted) throw new AuthoringLlmError("aborted", "cancelled");
    throw new AuthoringLlmError("http", err instanceof Error ? err.message : String(err));
  }
}

/** One JSON object back. Throws AuthoringLlmError (parse) when the model returns none. */
export async function chatJson<T>(
  messages: AuthoringMessage[],
  options: AuthoringLlmOptions,
): Promise<T> {
  const { res } = await post(messages, options, { json: true });
  const data = (await res.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content ?? "";
  const parsed = parseLooseJson<T>(raw);
  if (parsed === null) {
    throw new AuthoringLlmError("parse", `LLM returned non-JSON: ${raw.slice(0, 120)}`);
  }
  return parsed;
}

/** Text deltas as they arrive. */
export async function* chatStream(
  messages: AuthoringMessage[],
  options: AuthoringLlmOptions,
): AsyncGenerator<string> {
  const { res, timedOut } = await post(messages, options, { stream: true });
  if (!res.body) throw new AuthoringLlmError("http", "LLM stream had no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return;
        try {
          const chunk = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string | null } }>;
          };
          const text = chunk.choices?.[0]?.delta?.content;
          if (text) yield text;
        } catch {
          // A partial or non-JSON line: the next read completes it or it is noise.
        }
      }
    }
  } catch (err) {
    if (err instanceof AuthoringLlmError) throw err;
    if (timedOut()) throw new AuthoringLlmError("timeout", `LLM timed out after ${options.timeoutMs}ms`);
    if (options.signal?.aborted) throw new AuthoringLlmError("aborted", "cancelled");
    throw new AuthoringLlmError("http", err instanceof Error ? err.message : String(err));
  } finally {
    reader.cancel().catch(() => {});
  }
}
