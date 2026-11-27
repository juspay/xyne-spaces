import { config } from '@/config/env';

/**
 * Call AI without the transit proxy (TRANSIT_PROXY_ENABLED off, e.g. open source without
 * encryption): the backend calls LiteLLM's chat completions itself, with LITELLM_BASE_URL and
 * CALL_LITELLM_API_KEY, and gets the reply in plaintext.
 */

const LLM_TIMEOUT_MS = 15 * 60_000;

export interface DirectLlmTask {
  userPrompt: string;
  systemPrompt?: string;
  model: string;
  abortSignal?: AbortSignal;
}

export function isDirectLlmConfigured(): boolean {
  return Boolean(config.llm.litellmBaseUrl && config.llm.callLitellmApiKey);
}

/** The reply text. Throws on any failure; nothing it throws holds prompt or reply text. */
export async function runLlmDirect(task: DirectLlmTask): Promise<string> {
  if (!isDirectLlmConfigured()) {
    throw new Error('LITELLM_BASE_URL or CALL_LITELLM_API_KEY is not set');
  }
  const messages = [
    ...(task.systemPrompt ? [{ role: 'system', content: task.systemPrompt }] : []),
    { role: 'user', content: task.userPrompt },
  ];
  const timeout = AbortSignal.timeout(LLM_TIMEOUT_MS);
  const response = await fetch(`${config.llm.litellmBaseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.llm.callLitellmApiKey}` },
    body: JSON.stringify({ model: task.model, stream: false, messages }),
    signal: task.abortSignal ? AbortSignal.any([task.abortSignal, timeout]) : timeout,
  });
  if (!response.ok) {
    throw new Error(`LiteLLM answered ${response.status}`);
  }
  let content: unknown;
  try {
    const body = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
    content = body.choices?.[0]?.message?.content;
  } catch (error) {
    // A JSON parse error can quote the body.
    throw new Error(error instanceof SyntaxError ? 'LiteLLM answer is not JSON' : String(error));
  }
  if (typeof content !== 'string' || content.trim() === '') {
    throw new Error('LiteLLM returned no content');
  }
  return content;
}
