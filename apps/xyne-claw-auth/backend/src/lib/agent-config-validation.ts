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
// Provider fast mode (Anthropic `speed: "fast"`). Mirrors xyne-claw/src/model-speed.ts.
const MODEL_SPEEDS = ["standard", "fast"] as const;
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

  const allowed = new Set(["model", "temperature", "maxTokens", "thinkingLevel", "speed"]);
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

  if (raw["speed"] !== undefined) {
    if (!(MODEL_SPEEDS as readonly string[]).includes(raw["speed"] as string)) {
      return fail(`modelSettings.speed must be one of: ${MODEL_SPEEDS.join(", ")}`);
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
// Mirrors KNOWN_PROVIDERS in agent-provider-config.ts (kept local so this
// module stays dependency-free).
const PROFILE_PROVIDERS = new Set(["codex", "claude", "copilot", "openrouter", "litellm", "spaces"]);

/** config.fastModeProfile — which providers fast mode runs on (see
 *  agent-provider-config.ts → parseFastModeProfile for the shape). */
function validateFastModeProfile(raw: unknown): ConfigValidationResult {
  if (raw === undefined || raw === null) return { ok: true };
  if (!isPlainObject(raw)) return fail("fastModeProfile must be an object");
  const allowed = new Set(["providers", "providerOrder", "models", "modelSettings"]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) return fail(`fastModeProfile.${key} is not a recognized setting`);
  }
  if (raw["providers"] !== undefined && raw["providers"] !== "inherit" && raw["providers"] !== "custom") {
    return fail('fastModeProfile.providers must be "inherit" or "custom"');
  }
  if (raw["providerOrder"] !== undefined) {
    const order = raw["providerOrder"];
    if (!Array.isArray(order) || order.some((p) => typeof p !== "string" || !PROFILE_PROVIDERS.has(p))) {
      return fail(`fastModeProfile.providerOrder must list providers from: ${[...PROFILE_PROVIDERS].join(", ")}`);
    }
  }
  if (raw["modelSettings"] !== undefined) {
    // Fast-mode run-setting overrides — same fields/clamps as the top-level
    // modelSettings, minus `speed` (the profile IS the fast side; a nested
    // speed would be circular). Set fields override standard field-by-field.
    if (isPlainObject(raw["modelSettings"]) && (raw["modelSettings"] as Record<string, unknown>)["speed"] !== undefined) {
      return fail("fastModeProfile.modelSettings.speed is not allowed (the profile only applies in fast mode)");
    }
    const ms = validateModelSettings(raw["modelSettings"]);
    if (!ms.ok) return fail(`fastModeProfile.${ms.error ?? "modelSettings invalid"}`);
  }

  if (raw["models"] !== undefined) {
    const models = raw["models"];
    if (!isPlainObject(models)) return fail("fastModeProfile.models must be an object of provider → model id");
    for (const [k, v] of Object.entries(models)) {
      if (!PROFILE_PROVIDERS.has(k)) return fail(`fastModeProfile.models.${k} is not a known provider`);
      if (typeof v !== "string" || !v.trim() || v.length > 200) return fail(`fastModeProfile.models.${k} must be a non-empty model id`);
    }
  }
  return { ok: true };
}

export function validateAgentModelConfig(config: Record<string, unknown> | undefined): ConfigValidationResult {
  if (!config) return { ok: true };
  const ms = validateModelSettings(config["modelSettings"]);
  if (!ms.ok) return ms;
  const fp = validateFastModeProfile(config["fastModeProfile"]);
  if (!fp.ok) return fp;
  return validateOutputFormat(config["outputFormat"]);
}

/**
 * config.awakening — the settings that let an agent wake and act without a
 * human trigger (see awakening/config.ts for the runtime shape and clamps).
 *
 * Validated here rather than only clamped at read time because these knobs are
 * dangerous in a way modelSettings are not: a bad period or an unbounded regex
 * governs a background loop that spends money and posts publicly. An admin
 * gets a 400 with a reason instead of a silently-degraded agent.
 */
const AWAKENING_KIND_VALUES = ["heartbeat", "reflex", "both"];
const AWAKENING_WRITE_POLICIES = ["observe", "reply", "act"];
const AWAKENING_MIN_PERIOD_MS = 5 * 60_000;
// Mirrors AWAKENING_BOUNDS.instructionsLength.max — resolveAwakeningConfig
// truncates silently, so the API rejects loudly instead of saving something
// the runtime would quietly cut in half.
const AWAKENING_MAX_INSTRUCTIONS = 10_000;
const AWAKENING_MAX_PERIOD_MS = 24 * 60 * 60_000;
const AWAKENING_MAX_PATTERNS = 10;
const AWAKENING_MAX_PATTERN_LEN = 200;
/** Nested quantifiers are the classic catastrophic-backtracking shape. */
const REDOS_SHAPE = /\([^)]*[+*][^)]*\)[+*]/;

function validateStringArray(raw: unknown, label: string): ConfigValidationResult {
  if (raw === undefined) return { ok: true };
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string")) {
    return fail(`${label} must be an array of strings`);
  }
  return { ok: true };
}

function validatePatternArray(raw: unknown, label: string): ConfigValidationResult {
  const base = validateStringArray(raw, label);
  if (!base.ok) return base;
  if (raw === undefined) return { ok: true };

  const patterns = raw as string[];
  if (patterns.length > AWAKENING_MAX_PATTERNS) {
    return fail(`${label} has too many patterns (max ${AWAKENING_MAX_PATTERNS})`);
  }
  for (const src of patterns) {
    if (src.length > AWAKENING_MAX_PATTERN_LEN) {
      return fail(`${label} entry is too long (max ${AWAKENING_MAX_PATTERN_LEN} chars)`);
    }
    if (REDOS_SHAPE.test(src)) {
      return fail(`${label} entry "${src.slice(0, 40)}" has a nested quantifier and could hang matching`);
    }
    try {
      new RegExp(src, "i");
    } catch {
      return fail(`${label} entry "${src.slice(0, 40)}" is not a valid regular expression`);
    }
  }
  return { ok: true };
}

function validateIntRange(raw: unknown, label: string, min: number, max: number): ConfigValidationResult {
  if (raw === undefined) return { ok: true };
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < min || raw > max) {
    return fail(`${label} must be an integer between ${min} and ${max}`);
  }
  return { ok: true };
}

export function validateAwakeningConfig(config: Record<string, unknown> | undefined): ConfigValidationResult {
  if (!config) return { ok: true };
  const raw = config["awakening"];
  if (raw === undefined || raw === null) return { ok: true };
  if (!isPlainObject(raw)) return fail("awakening must be an object");

  if (raw["enabled"] !== undefined && typeof raw["enabled"] !== "boolean") {
    return fail("awakening.enabled must be a boolean");
  }
  if (raw["shadow"] !== undefined && typeof raw["shadow"] !== "boolean") {
    return fail("awakening.shadow must be a boolean");
  }
  if (raw["kind"] !== undefined && !AWAKENING_KIND_VALUES.includes(raw["kind"] as string)) {
    return fail(`awakening.kind must be one of: ${AWAKENING_KIND_VALUES.join(", ")}`);
  }
  if (raw["writePolicy"] !== undefined && !AWAKENING_WRITE_POLICIES.includes(raw["writePolicy"] as string)) {
    return fail(`awakening.writePolicy must be one of: ${AWAKENING_WRITE_POLICIES.join(", ")}`);
  }

  if (raw["instructions"] !== undefined) {
    if (typeof raw["instructions"] !== "string") return fail("awakening.instructions must be a string");
    if ((raw["instructions"] as string).length > AWAKENING_MAX_INSTRUCTIONS) {
      return fail(`awakening.instructions must be at most ${AWAKENING_MAX_INSTRUCTIONS} characters`);
    }
  }

  const period = validateIntRange(raw["periodMs"], "awakening.periodMs", AWAKENING_MIN_PERIOD_MS, AWAKENING_MAX_PERIOD_MS);
  if (!period.ok) return period;

  if (raw["channels"] !== undefined) {
    const ch = raw["channels"];
    if (!isPlainObject(ch)) return fail("awakening.channels must be an object");
    for (const [key, label] of [
      ["include", "awakening.channels.include"],
      ["exclude", "awakening.channels.exclude"],
    ] as const) {
      const r = validateStringArray(ch[key], label);
      if (!r.ok) return r;
    }
    for (const [key, label] of [
      ["includePattern", "awakening.channels.includePattern"],
      ["excludePattern", "awakening.channels.excludePattern"],
    ] as const) {
      const r = validatePatternArray(ch[key], label);
      if (!r.ok) return r;
    }
    const max = validateIntRange(ch["maxChannels"], "awakening.channels.maxChannels", 1, 100);
    if (!max.ok) return max;
  }

  if (raw["limits"] !== undefined) {
    const lim = raw["limits"];
    if (!isPlainObject(lim)) return fail("awakening.limits must be an object");
    for (const [key, min, max] of [
      ["maxEvents", 10, 5000],
      ["maxActiveThreads", 5, 1000],
      ["maxRunsPerHour", 1, 60],
    ] as const) {
      const r = validateIntRange(lim[key], `awakening.limits.${key}`, min, max);
      if (!r.ok) return r;
    }
  }

  if (raw["gate"] !== undefined) {
    const gate = raw["gate"];
    if (!isPlainObject(gate)) return fail("awakening.gate must be an object");
    for (const [key, min, max] of [
      ["minHumanEvents", 0, 1000],
      ["forceRunEveryNSkips", 0, 100],
    ] as const) {
      const r = validateIntRange(gate[key], `awakening.gate.${key}`, min, max);
      if (!r.ok) return r;
    }
  }

  if (raw["cursor"] !== undefined) {
    const cursor = raw["cursor"];
    if (!isPlainObject(cursor)) return fail("awakening.cursor must be an object");
    for (const [key, min, max] of [
      ["replicaSafetyMs", 0, 300_000],
      ["overlapMs", 0, 900_000],
      ["maxCatchupWindows", 1, 50],
    ] as const) {
      const r = validateIntRange(cursor[key], `awakening.cursor.${key}`, min, max);
      if (!r.ok) return r;
    }
  }

  if (raw["workspaceId"] !== undefined && typeof raw["workspaceId"] !== "string") {
    return fail("awakening.workspaceId must be a string");
  }

  return { ok: true };
}
