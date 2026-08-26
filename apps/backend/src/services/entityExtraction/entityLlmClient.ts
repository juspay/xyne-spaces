import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import {
  formatErrors,
  validate,
  type JsonCompletionRequest,
  type LlmClient,
} from '@/services/entityExtraction/pipeline';

/**
 * The mention-extraction LlmClient: a direct LiteLLM /chat/completions caller
 * plus the JSON-parse / schema-validate / repair loop.
 *
 * The schema goes in the prompt and is validated here with retry rather than
 * relying on response_format, because glm-latest does not enforce it reliably —
 * a json_schema response format actively corrupts its output.
 */

const RATE_LIMIT_MAX_RETRIES = 6;
/** Repair attempts after the first response, i.e. 4 calls total. */
const MAX_REPAIR_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Raw LiteLLM call. The endpoint enforces a per-key max_parallel_requests limit
 * shared with other services, so 429s are expected under load — a 429 is
 * transient (concurrency, resets in seconds), so we back off and retry rather
 * than discarding the batch.
 */
async function callLiteLLM(messages: Array<{ role: string; content: string }>): Promise<string> {
  const url = `${config.litellm.baseUrl.replace(/\/$/, '')}/chat/completions`;

  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // The same dedicated key thread-type classification runs on: one service account
        // for the classification workers, so their limits are not the gateway's shared ones.
        Authorization: `Bearer ${config.litellm.threadTypeClassificationApiKey || config.litellm.apiKey}`,
      },
      body: JSON.stringify({
        model: config.entityExtraction.model,
        messages,
        temperature: 0,
        // glm-latest is a reasoning model; disabling the trace took a batch of 8
        // documents from 45s to 7.7s with no quality loss.
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: AbortSignal.timeout(300000),
    });

    if (response.status === 429 && attempt < RATE_LIMIT_MAX_RETRIES) {
      // Exponential backoff with jitter: 1.5s, 3s, 6s, ... capped at 30s.
      const waitMs = Math.min(30_000, 1500 * 2 ** attempt) + Math.floor(Math.random() * 500);
      logger.warn('[ENTITY_LLM] rate limited, backing off', { attempt: attempt + 1, waitMs });
      await response.body?.cancel();
      await sleep(waitMs);
      continue;
    }

    if (!response.ok) {
      throw new Error(`LiteLLM error: ${response.status} ${(await response.text()).slice(0, 500)}`);
    }
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? '';
  }
}

export const entityLlm: LlmClient = {
  async completeJson<T>(req: JsonCompletionRequest<T>): Promise<T> {
    const messages = [
      {
        role: 'system',
        content:
          `${req.system}\n\nRespond with JSON only — no prose, no code fences — ` +
          `matching this JSON Schema:\n${JSON.stringify(req.schema)}`,
      },
      { role: 'user', content: req.user },
    ];
    let lastError = '';

    for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
      const raw = await callLiteLLM(messages);
      const parsed = tryParseJson(raw);

      if (!parsed.ok) {
        lastError = `Response was not valid JSON: ${parsed.error}`;
      } else {
        const errors = validate(parsed.value, req.schema);
        if (errors.length === 0) return parsed.value as T;
        lastError = formatErrors(errors);
      }

      logger.warn('[ENTITY_LLM] response rejected, retrying', {
        purpose: req.purpose,
        attempt: attempt + 1,
        error: lastError.slice(0, 300),
      });
      messages.push({ role: 'assistant', content: raw.slice(0, 4000) });
      messages.push({
        role: 'user',
        content:
          `That response did not match the required schema:\n${lastError}\n\n` +
          `Return only valid JSON matching the schema. No prose, no code fences.`,
      });
    }

    throw new Error(
      `LLM failed to produce schema-valid output for "${req.schemaName}" ` +
        `after ${MAX_REPAIR_ATTEMPTS + 1} attempts. Last error: ${lastError}`,
    );
  },
};

/** Tolerates code fences and surrounding prose around the JSON. */
function tryParseJson(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const attempt = (candidate: string) => {
    try {
      return { ok: true as const, value: JSON.parse(candidate) };
    } catch {
      return null;
    }
  };
  const direct = attempt(cleaned);
  if (direct) return direct;
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const sliced = attempt(cleaned.slice(start, end + 1));
    if (sliced) return sliced;
  }
  return { ok: false, error: cleaned.slice(0, 200) || '(empty response)' };
}
