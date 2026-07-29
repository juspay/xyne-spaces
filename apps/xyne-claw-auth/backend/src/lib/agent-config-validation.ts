/**
 * Validation for the model-related blocks of `Agent.config`:
 *
 *   config.modelSettings — per-agent LLM overrides applied by the xyne-claw
 *     runtime (see xyne-claw/src/agent-model-settings.ts, which mirrors these
 *     clamps as a runtime backstop).
 *   config.outputFormat — structured JSON final answer: the schema becomes the
 *     input schema of the runtime's `submit-result` tool.
 *
 * The rest of `config` stays free-form (providerOrder, tools, skillTriggers, …
 * are validated where they're consumed); only these two keys are checked here
 * because a bad value breaks every run of the agent at the API-call layer.
 */

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high"] as const;
const MAX_TOKENS_MIN = 1024;
const MAX_TOKENS_MAX = 64000;
const MAX_SCHEMA_BYTES = 32 * 1024;

export interface ConfigValidationResult {
  ok: boolean;
  error?: string;
}

function fail(error: string): ConfigValidationResult {
  return { ok: false, error };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function validateModelSettings(raw: unknown): ConfigValidationResult {
  if (raw === undefined || raw === null) return { ok: true };
  if (!isPlainObject(raw)) return fail("modelSettings must be an object");

  const allowed = new Set(["model", "temperature", "maxTokens", "thinkingLevel"]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) return fail(`modelSettings.${key} is not a recognized setting`);
  }

  if (raw["model"] !== undefined) {
    if (typeof raw["model"] !== "string" || !raw["model"].trim()) {
      return fail("modelSettings.model must be a non-empty string");
    }
    if (raw["model"].length > 200) return fail("modelSettings.model is too long");
  }

  if (raw["temperature"] !== undefined) {
    const t = raw["temperature"];
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0 || t > 1) {
      return fail("modelSettings.temperature must be a number between 0 and 1");
    }
  }

  if (raw["maxTokens"] !== undefined) {
    const m = raw["maxTokens"];
    if (typeof m !== "number" || !Number.isInteger(m) || m < MAX_TOKENS_MIN || m > MAX_TOKENS_MAX) {
      return fail(`modelSettings.maxTokens must be an integer between ${MAX_TOKENS_MIN} and ${MAX_TOKENS_MAX}`);
    }
  }

  if (raw["thinkingLevel"] !== undefined) {
    if (!(THINKING_LEVELS as readonly string[]).includes(raw["thinkingLevel"] as string)) {
      return fail(`modelSettings.thinkingLevel must be one of: ${THINKING_LEVELS.join(", ")}`);
    }
  }

  // Anthropic rejects temperature != 1 when extended thinking is on, so a
  // fixed temperature only makes sense with thinking disabled. Force the
  // choice to be explicit here instead of silently degrading at run time.
  if (raw["temperature"] !== undefined && raw["thinkingLevel"] !== undefined && raw["thinkingLevel"] !== "off") {
    return fail('modelSettings.temperature requires thinkingLevel "off" (thinking models ignore temperature)');
  }

  return { ok: true };
}

const MAX_TEMPLATE_BYTES = 16 * 1024;

function validateOutputFormat(raw: unknown): ConfigValidationResult {
  if (raw === undefined || raw === null) return { ok: true };
  if (!isPlainObject(raw)) return fail("outputFormat must be an object");

  const type = raw["type"];
  if (type !== "json" && type !== "markdown") return fail('outputFormat.type must be "json" or "markdown"');

  // template — optional for both types ("json": markdown render template;
  // "markdown": structural outline shown to the agent).
  if (raw["template"] !== undefined) {
    if (typeof raw["template"] !== "string") return fail("outputFormat.template must be a string");
    if (raw["template"].length > MAX_TEMPLATE_BYTES) {
      return fail(`outputFormat.template is too large (max ${MAX_TEMPLATE_BYTES / 1024}KB)`);
    }
  }

  // requireToolsBeforeSubmit — optional process guard (both types): tool-name
  // substrings that must run before submit-result is accepted. Blocks an agent
  // from short-circuiting a multi-step pipeline with an empty/placeholder result.
  if (raw["requireToolsBeforeSubmit"] !== undefined) {
    const req = raw["requireToolsBeforeSubmit"];
    if (!Array.isArray(req) || !req.every((t) => typeof t === "string" && t.trim().length > 0)) {
      return fail("outputFormat.requireToolsBeforeSubmit must be an array of non-empty strings");
    }
    if (req.length > 50) return fail("outputFormat.requireToolsBeforeSubmit has too many entries (max 50)");
  }

  if (type === "markdown") {
    // No schema for markdown; a stray schema is harmless but flag obvious misuse.
    return { ok: true };
  }

  // type "json" — schema required.
  const schema = raw["schema"];
  if (!isPlainObject(schema)) return fail("outputFormat.schema must be a JSON Schema object");

  let serialized: string;
  try {
    serialized = JSON.stringify(schema);
  } catch {
    return fail("outputFormat.schema is not serializable JSON");
  }
  if (serialized.length > MAX_SCHEMA_BYTES) {
    return fail(`outputFormat.schema is too large (max ${MAX_SCHEMA_BYTES / 1024}KB)`);
  }

  const schemaType = schema["type"];
  if (typeof schemaType !== "string" || !["object", "array", "string", "number", "integer", "boolean"].includes(schemaType)) {
    return fail('outputFormat.schema.type must be a JSON Schema type (e.g. "object")');
  }
  if (schemaType === "object" && schema["properties"] !== undefined && !isPlainObject(schema["properties"])) {
    return fail("outputFormat.schema.properties must be an object");
  }
  if (schema["required"] !== undefined && !Array.isArray(schema["required"])) {
    return fail("outputFormat.schema.required must be an array");
  }

  return { ok: true };
}

/** Validate the model-related keys of an agent `config` payload. */
export function validateAgentModelConfig(config: Record<string, unknown> | undefined): ConfigValidationResult {
  if (!config) return { ok: true };
  const ms = validateModelSettings(config["modelSettings"]);
  if (!ms.ok) return ms;
  return validateOutputFormat(config["outputFormat"]);
}
