/**
 * The pipeline's LlmClient (HTTP client).
 *
 * The completion itself runs on xyne-claw, where LITELLM_API_KEY lives —
 * claw-auth holds no LLM credentials (same arrangement as sessionCurator.ts).
 * This side keeps everything that isn't the credential: prompt assembly, JSON
 * parsing, schema validation and the repair loop.
 *
 * The schema goes in the prompt and is validated here with retry rather than
 * relying on response_format, because glm-latest does not enforce it reliably —
 * a json_schema response format actively corrupts its output.
 */

import { CONFIG } from "../../config.js";
import { createLogger, createTraceId } from "../../logger.js";
import {
  formatErrors,
  validate,
  type JsonCompletionRequest,
  type LlmClient,
} from "./pipeline/index.js";

const logger = createLogger("entity-llm-client", createTraceId());

/** Matches the claw-side ENTITY_EXTRACTION_TIMEOUT_MS plus slack for retries. */
const CLAW_TIMEOUT_MS = Number(process.env["ENTITY_EXTRACTION_TIMEOUT_MS"] ?? 300_000) + 60_000;

/** Repair attempts after the first response, i.e. 4 calls total. */
const MAX_REPAIR_ATTEMPTS = 3;

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** One raw completion via claw's S2S endpoint. */
async function completeViaClaw(messages: ChatMessage[], purpose?: string): Promise<string> {
  if (!CONFIG.xyneClawS2sKey) {
    throw new Error("XYNE_CLAW_S2S_KEY not set — entity extraction cannot reach claw");
  }

  const url = `${CONFIG.xyneClawUrl.replace(/\/$/, "")}/internal/entity-llm/complete`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-s2s-key": CONFIG.xyneClawS2sKey },
    body: JSON.stringify({ messages, ...(purpose ? { purpose } : {}) }),
    signal: AbortSignal.timeout(CLAW_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`claw entity-llm ${res.status}: ${body.slice(0, 500)}`);
  }

  const data = (await res.json()) as { success?: boolean; content?: unknown; error?: unknown };
  if (!data.success || typeof data.content !== "string") {
    throw new Error(`claw entity-llm returned no content: ${String(data.error ?? "unknown")}`);
  }
  return data.content;
}

export const entityLlm: LlmClient = {
  async completeJson<T>(req: JsonCompletionRequest<T>): Promise<T> {
    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          `${req.system}\n\nRespond with JSON only — no prose, no code fences — ` +
          `matching this JSON Schema:\n${JSON.stringify(req.schema)}`,
      },
      { role: "user", content: req.user },
    ];
    let lastError = "";

    for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
      const raw = await completeViaClaw(messages, req.purpose);
      const parsed = tryParseJson(raw);

      if (!parsed.ok) {
        lastError = `Response was not valid JSON: ${parsed.error}`;
      } else {
        const errors = validate(parsed.value, req.schema);
        if (errors.length === 0) return parsed.value as T;
        lastError = formatErrors(errors);
      }

      logger.warn("[entity-llm] response rejected, retrying", {
        purpose: req.purpose,
        attempt: attempt + 1,
        error: lastError.slice(0, 300),
      });
      messages.push({ role: "assistant", content: raw.slice(0, 4000) });
      messages.push({
        role: "user",
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
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const attempt = (candidate: string) => {
    try {
      return { ok: true as const, value: JSON.parse(candidate) };
    } catch {
      return null;
    }
  };
  const direct = attempt(cleaned);
  if (direct) return direct;
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const sliced = attempt(cleaned.slice(start, end + 1));
    if (sliced) return sliced;
  }
  return { ok: false, error: cleaned.slice(0, 200) || "(empty response)" };
}
