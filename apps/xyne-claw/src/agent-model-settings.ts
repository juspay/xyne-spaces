/**
 * Per-agent model settings + structured (JSON) output.
 *
 * Both ride on the agent's free-form `config` JSON (dispatched to /run as
 * `agentConfig`), so no schema/dispatch changes were needed:
 *
 *   config.modelSettings = {
 *     model?: string            // Spaces/platform-default model override —
 *                               // applied ONLY when no provider credential
 *                               // serves the run (the LiteLLM branch);
 *                               // premium providers pick their model on the
 *                               // credential itself
 *     temperature?: number      // 0..1 — forces thinking OFF (Anthropic
 *                               // requires temperature=1 with extended thinking)
 *     maxTokens?: number        // max output tokens (default 16384)
 *     thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high"
 *     speed?: "standard" | "fast"
 *                               // provider fast mode (Anthropic `speed: "fast"`,
 *                               // Opus 5 / 4.8 on a direct Claude credential).
 *                               // Same credential + model, faster tier. NOT the
 *                               // top-level agentConfig.fastMode tool-catalog
 *                               // flag — see model-speed.ts
 *   }
 *
 *   config.outputFormat = {
 *     type: "json",
 *     schema: { ...JSON Schema for the final answer... }
 *   }
 *
 * Structured output works like verified-response delivery: a `submit-result`
 * tool whose input schema IS the user's schema is registered for the run, the
 * system context instructs the model to finish by calling it, and agent.ts
 * treats the captured args as the run's final text (JSON). Intermediate turns
 * (tool calls, thinking) are unaffected — only the terminal answer is
 * constrained.
 */

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { parseModelSpeed, type ModelSpeed } from "./model-speed.js";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high"] as const;
export type ModelSettingsThinkingLevel = (typeof THINKING_LEVELS)[number];

export interface AgentModelSettings {
  model?: string | undefined;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  thinkingLevel?: ModelSettingsThinkingLevel | undefined;
  speed?: ModelSpeed | undefined;
}

// Clamps mirror the control-plane validation (claw-auth routes/agents.ts) so a
// stale or hand-edited config row can't push absurd values into the API call.
export const MAX_TOKENS_MIN = 1024;
export const MAX_TOKENS_MAX = 64000;

/** Parse + clamp the shared model-settings fields out of one settings bag. */
function parseSettingsFields(raw: unknown): AgentModelSettings {
  const out: AgentModelSettings = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;

  if (typeof r["model"] === "string" && r["model"].trim()) out.model = r["model"].trim();

  if (typeof r["temperature"] === "number" && Number.isFinite(r["temperature"])) {
    out.temperature = Math.min(1, Math.max(0, r["temperature"]));
  }

  if (typeof r["maxTokens"] === "number" && Number.isFinite(r["maxTokens"])) {
    out.maxTokens = Math.min(MAX_TOKENS_MAX, Math.max(MAX_TOKENS_MIN, Math.round(r["maxTokens"])));
  }

  if (typeof r["thinkingLevel"] === "string" && (THINKING_LEVELS as readonly string[]).includes(r["thinkingLevel"])) {
    out.thinkingLevel = r["thinkingLevel"] as ModelSettingsThinkingLevel;
  }
  return out;
}

export function parseModelSettings(agentConfig: Record<string, unknown> | undefined): AgentModelSettings | undefined {
  const out = parseSettingsFields(agentConfig?.["modelSettings"]);
  const r = agentConfig?.["modelSettings"];
  const speed = r && typeof r === "object" && !Array.isArray(r)
    ? parseModelSpeed((r as Record<string, unknown>)["speed"])
    : undefined;
  if (speed) out.speed = speed;

  // Fast-mode run-setting overrides (config.fastModeProfile.modelSettings):
  // when THIS run is fast (agent default, or the per-message toggle merged in
  // by claw-auth), set fields override the standard values field-by-field —
  // unset fields inherit. So "Spaces on minimal thinking normally, high in
  // fast mode" is one thinkingLevel override; temperature/maxTokens/thinking
  // apply to whichever provider serves the run (a fast thinkingLevel also
  // outranks a codex credential's reasoningEffort, same as the standard one).
  if (out.speed === "fast") {
    const profile = agentConfig?.["fastModeProfile"];
    if (profile && typeof profile === "object" && !Array.isArray(profile)) {
      const overrides = parseSettingsFields((profile as Record<string, unknown>)["modelSettings"]);
      Object.assign(out, overrides);
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

// ── Structured output ────────────────────────────────────────────────────────

export const SUBMIT_RESULT_TOOL_NAME = "submit-result";

/**
 * Two output modes (agent.config.outputFormat):
 *
 *   { type: "json", schema, template? }
 *     The agent emits a JSON payload constrained to `schema`. Machine consumers
 *     (workflows/triggers) read the raw JSON; the Spaces chat reply is the JSON
 *     pretty-printed, OR — when `template` is set — the JSON rendered through
 *     that Markdown template (so the thread shows readable text, not raw JSON).
 *
 *   { type: "markdown", template? }
 *     The agent delivers its final answer as a Markdown string (Spaces renders
 *     it natively). `template` is an optional structural outline shown to the
 *     agent to shape that Markdown. No JSON payload is produced.
 */
export interface OutputFormatConfig {
  type: "json" | "markdown";
  /** JSON Schema for the final payload. Required for type "json". */
  schema?: Record<string, unknown> | undefined;
  /** type "json": Markdown render template ({{path}} / {{#each}}). type
   *  "markdown": structural outline shown to the agent. Optional for both. */
  template?: string | undefined;
  /** Process guard: tool-name substrings (case-insensitive) that MUST have been
   *  invoked this run before `submit-result` is accepted. Without this, a
   *  schema-constrained agent can short-circuit a multi-step pipeline by
   *  submitting a trivially-valid empty payload (e.g. a report with all zeros)
   *  WITHOUT fetching/computing anything. Set this to the data-gathering tools
   *  the agent must run first, e.g. ["user-tickets", "sandbox-run"]. The gate
   *  fails open after a few rejections so a stuck model can't hang the run. */
  requireToolsBeforeSubmit?: string[] | undefined;
}

export function parseOutputFormat(agentConfig: Record<string, unknown> | undefined): OutputFormatConfig | undefined {
  const raw = agentConfig?.["outputFormat"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const template = typeof r["template"] === "string" && r["template"].trim() ? r["template"] : undefined;
  const requireToolsBeforeSubmit = Array.isArray(r["requireToolsBeforeSubmit"])
    ? (r["requireToolsBeforeSubmit"] as unknown[]).filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    : undefined;
  const gate = requireToolsBeforeSubmit && requireToolsBeforeSubmit.length > 0
    ? { requireToolsBeforeSubmit }
    : {};
  if (r["type"] === "markdown") {
    return { type: "markdown", ...(template ? { template } : {}), ...gate };
  }
  if (r["type"] === "json") {
    const schema = r["schema"];
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) return undefined;
    return { type: "json", schema: schema as Record<string, unknown>, ...(template ? { template } : {}), ...gate };
  }
  return undefined;
}

/** Shared ref: the tool writes the accepted payload here; agent.ts reads it
 *  after the loop to decide the run's final text (and to nudge if missing).
 *  For type "json" the value is the JSON payload; for type "markdown" it is
 *  the markdown string. */
export interface StructuredOutputRef {
  value?: unknown;
  /** Live accessor for the tool names invoked so far this run. agent.ts wires
   *  this to its running `toolsUsed` array; the submit-result gate reads it to
   *  enforce `requireToolsBeforeSubmit`. Undefined when no gate is configured. */
  toolsUsed?: () => string[];
  /** How many times the gate has rejected a submit so far — used to fail open
   *  after a cap so a non-compliant model can't loop forever. */
  submitRejections?: number;
}

/** Max times the `requireToolsBeforeSubmit` gate rejects a submit before it
 *  fails open and accepts the payload (so a stuck model can't hang the run). */
const SUBMIT_GATE_MAX_REJECTIONS = 3;

/** Returns a rejection message if the configured required tools haven't run yet
 *  this run, else null (accept). Fails open after SUBMIT_GATE_MAX_REJECTIONS. */
function checkRequiredToolsGate(
  outputFormat: OutputFormatConfig,
  ref: StructuredOutputRef,
): string | null {
  const required = outputFormat.requireToolsBeforeSubmit;
  if (!required || required.length === 0) return null;
  const used = (ref.toolsUsed?.() ?? []).map((t) => t.toLowerCase());
  const missing = required.filter(
    (req) => !used.some((u) => u.includes(req.toLowerCase())),
  );
  if (missing.length === 0) return null;
  ref.submitRejections = (ref.submitRejections ?? 0) + 1;
  if (ref.submitRejections > SUBMIT_GATE_MAX_REJECTIONS) return null; // fail open
  return (
    `Rejected: do the work before delivering. These required tools have NOT been ` +
    `called yet this run: ${missing.join(", ")}. Use them to fetch/compute the ` +
    `real data first, then call submit-result. Do NOT submit empty, zero, or ` +
    `placeholder values — an empty result is treated as a failure.`
  );
}

/** System-context appendix telling the agent to finish via submit-result.
 *  Wording differs by output type (and surfaces the markdown outline). */
export function buildSubmitResultInstruction(outputFormat: OutputFormatConfig): string {
  if (outputFormat.type === "markdown") {
    return [
      "## Final Answer Format — REQUIRED",
      "",
      "When you have finished the task, deliver your FINAL answer by calling the",
      "`submit-result` tool with the `markdown` field containing your complete answer",
      "in GitHub-flavored Markdown. Do NOT write the final answer as a plain assistant",
      "message — only the `submit-result` payload is delivered.",
      ...(outputFormat.template ? [
        "",
        "Structure the Markdown to follow this outline:",
        "```",
        outputFormat.template,
        "```",
      ] : []),
      "",
      "Keep using your normal tools to do the work; call `submit-result` exactly once,",
      "at the end, with the complete answer.",
    ].join("\n");
  }
  return [
    "## Final Answer Format — REQUIRED",
    "",
    "This agent is configured with a structured JSON output format. When you have",
    "finished the task, deliver your FINAL answer by calling the `submit-result`",
    "tool with arguments matching its input schema exactly. Do NOT write the final",
    "answer as a plain assistant message — only the `submit-result` payload is",
    "delivered.",
    "",
    "Keep using your normal tools to do the work; call `submit-result` exactly once,",
    "at the end, with the complete result.",
  ].join("\n");
}

/** Nudge sent when the loop ends without a submit-result call. */
export const SUBMIT_RESULT_NUDGE =
  "You finished without calling the `submit-result` tool. The user can ONLY receive your answer through that tool. Call `submit-result` now with your final answer.";

/**
 * Minimal structural check of the submitted payload against the user's JSON
 * Schema: top-level type + required keys. The provider already constrains tool
 * arguments to the schema; this is a cheap backstop that turns the common
 * failure (missing required field) into a retryable tool error instead of a
 * malformed delivery.
 */
function validateAgainstSchema(value: unknown, schema: Record<string, unknown>): string | null {
  const type = schema["type"];
  if (type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "result must be a JSON object";
    const required = Array.isArray(schema["required"]) ? (schema["required"] as unknown[]) : [];
    const missing = required.filter((k) => typeof k === "string" && !(k in (value as Record<string, unknown>)));
    if (missing.length > 0) return `missing required field(s): ${missing.join(", ")}`;
  } else if (type === "array" && !Array.isArray(value)) {
    return "result must be a JSON array";
  }
  return null;
}

export function buildSubmitResultTool(outputFormat: OutputFormatConfig, ref: StructuredOutputRef): ToolDefinition {
  if (outputFormat.type === "markdown") {
    return {
      name: SUBMIT_RESULT_TOOL_NAME,
      label: "Submit Result",
      description: [
        "Deliver your FINAL answer as Markdown in the `markdown` argument.",
        "This is the ONLY delivery channel for your answer — plain assistant text is not shown to the user.",
        "Call it exactly once, when the task is complete.",
      ].join("\n"),
      parameters: {
        type: "object",
        properties: {
          markdown: { type: "string", description: "The complete final answer, in GitHub-flavored Markdown." },
        },
        required: ["markdown"],
      } as ToolDefinition["parameters"],
      async execute(_toolCallId: string, params: unknown) {
        const md = (params as Record<string, unknown> | undefined)?.["markdown"];
        if (typeof md !== "string" || !md.trim()) {
          return {
            content: [{ type: "text" as const, text: "Rejected: `markdown` must be a non-empty string. Call submit-result again." }],
            details: {},
          };
        }
        const gateErr = checkRequiredToolsGate(outputFormat, ref);
        if (gateErr) {
          return { content: [{ type: "text" as const, text: gateErr }], details: {} };
        }
        ref.value = md;
        return {
          content: [{ type: "text" as const, text: "Result accepted and delivered. The task is complete — do not produce further output." }],
          details: {},
        };
      },
    };
  }

  // type "json": the user's JSON Schema becomes the tool's input schema
  // verbatim — the provider constrains the tool-call arguments to it, which is
  // what makes "the model literally can't emit malformed JSON" hold. Non-object
  // root schemas are wrapped so the tool signature stays an object.
  const schema = outputFormat.schema ?? { type: "object" };
  const parameters = schema["type"] === "object"
    ? schema
    : { type: "object", properties: { result: schema }, required: ["result"] };

  return {
    name: SUBMIT_RESULT_TOOL_NAME,
    label: "Submit Result",
    description: [
      "Deliver your FINAL answer as structured JSON matching this tool's input schema.",
      "This is the ONLY delivery channel for your answer — plain assistant text is not shown to the user.",
      "Call it exactly once, when the task is complete.",
    ].join("\n"),
    parameters: parameters as ToolDefinition["parameters"],
    async execute(_toolCallId: string, params: unknown) {
      const payload = schema["type"] === "object"
        ? params
        : (params as Record<string, unknown> | undefined)?.["result"];
      const err = validateAgainstSchema(payload, schema);
      if (err) {
        return {
          content: [{ type: "text" as const, text: `Rejected: ${err}. Call submit-result again with a corrected payload.` }],
          details: {},
        };
      }
      const gateErr = checkRequiredToolsGate(outputFormat, ref);
      if (gateErr) {
        return { content: [{ type: "text" as const, text: gateErr }], details: {} };
      }
      ref.value = payload;
      return {
        content: [{ type: "text" as const, text: "Result accepted and delivered. The task is complete — do not produce further output." }],
        details: {},
      };
    },
  };
}

// ── Markdown template rendering (type "json" + template) ─────────────────────
//
// A deliberately small renderer — NOT a full template engine. Supports:
//   {{path.to.field}}            scalar / dot-path lookup
//   {{#each path}}…{{/each}}     iterate an array; inside, {{.}} is the item
//                                (scalar) and {{field}} resolves against the
//                                item, then the root as fallback
// Missing values render empty; arrays of scalars join with ", "; anything else
// falls back to JSON. One level of #each (no nesting) — enough for the common
// "object with a list of items" result without a dependency.

function lookup(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>(
    (acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined),
    obj,
  );
}

function formatValue(val: unknown): string {
  if (val === undefined || val === null) return "";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (Array.isArray(val) && val.every((x) => typeof x === "string" || typeof x === "number")) return val.join(", ");
  return JSON.stringify(val);
}

function substituteScalars(tpl: string, ctx: unknown, root: unknown): string {
  return tpl.replace(/\{\{\s*([\w.]+|\.)\s*\}\}/g, (_m, expr: string) => {
    if (expr === ".") return formatValue(ctx);
    let val = ctx && typeof ctx === "object" ? lookup(ctx, expr) : undefined;
    if (val === undefined) val = lookup(root, expr);
    return formatValue(val);
  });
}

export function renderTemplate(template: string, data: unknown): string {
  const withEach = template.replace(
    /\{\{#each\s+([\w.]+)\s*\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (_m, path: string, inner: string) => {
      const arr = lookup(data, path);
      if (!Array.isArray(arr)) return "";
      return arr.map((item) => substituteScalars(inner, item, data)).join("");
    },
  );
  return substituteScalars(withEach, data, data);
}
