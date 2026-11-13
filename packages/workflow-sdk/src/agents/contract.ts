/**
 * Agent contract — the half of an agent step that holds regardless of who
 * actually runs the agent.
 *
 * An agent step has two halves:
 *
 *  - The **provider half** is specific to the agent platform behind the step:
 *    prompts, tools and turn limits for an SDK-driven LLM ({@link AgentStep});
 *    an agent id for a host that owns its own agent lifecycle
 *    ({@link HostAgentStep}).
 *  - The **contract half** is the workflow's agreement with the step: what
 *    shape the output takes, whether it must be JSON, whether it carries
 *    citations, and how many times an unusable response is re-prompted before
 *    the step gives up. That is what lives here.
 *
 * Both steps compose the same {@link agentContractFields} and produce the same
 * {@link AgentResult}, so a workflow can move between them without rewriting
 * downstream `{{steps.x.output.response}}` refs.
 *
 * Deliberately free of pi-mono imports: a host-backed agent step must be able
 * to use this without pulling the LLM runtime into the bundle.
 */

import { z } from 'zod';
import { AttachmentSchema, ATTACHMENT_ARRAY_JSON_SCHEMA } from '../common/attachment.js';
import type { Attachment } from '../common/attachment.js';
import { variableRef } from '../types/workflow-config.js';
import { splitCitedResponse } from './citation-resolve.js';

// ─── Contract Config Fields ───

/**
 * The contract fields whose wording is identical for every agent step.
 *
 * Exposed as a field map rather than a `z.object` so each step can interleave
 * them with its own fields in whatever order reads best in the form — the
 * generic renderer follows declaration order, so composing with `.merge()`
 * would force all contract fields to the bottom.
 */
export const agentContractFields = {
  outputType: z.enum(['string', 'json']).default('string')
    .describe('Shape of the agent response: free text, or a JSON object matching outputSchema'),
  outputSchema: variableRef(z.record(z.unknown())).optional()
    .describe('When outputType is "json", the JSON Schema the response object should match'),
  cite: z.boolean().default(false)
    .describe('Require the agent to cite the source of every data point it produces'),
  timeoutMs: z.number().int().positive().default(1_200_000)
    .describe('Max wall-clock time for the agent run in milliseconds. Default: 1200000 (20 minutes).'),
} as const;

/**
 * Input documents field. The type is shared; the copy is not — how an agent
 * receives its documents differs by provider (the SDK's LLM step mounts them
 * into a sandbox; a host agent is handed refs), and the field's help text is
 * the only place an author learns which.
 */
export function attachmentsField(description: string) {
  return variableRef(
    z.array(AttachmentSchema).describe(description),
  ).optional();
}

/**
 * Repair budget field. Same reasoning as {@link attachmentsField}: the bound
 * and default are the contract, the description names the mechanism, which
 * differs (re-prompting one conversation vs. re-running an agent).
 */
export function jsonRepairRetriesField(description: string) {
  return z.number().int().min(0).default(3).describe(description);
}

// ─── Result ───

/** Record of a completed tool call with timing — written to workflow context. */
export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  durationMs: number;
}

/** Final output written to workflow context after agent execution. */
export interface AgentResult extends Record<string, unknown> {
  /** Free text (outputType 'string') or a parsed JSON object (outputType 'json'). */
  response: string | Record<string, unknown>;
  toolCalls: ToolCallRecord[];
  turnCount: number;
  usage: { inputTokens: number; outputTokens: number };
  /** Files the agent generated, persisted as artifacts. */
  attachments: Attachment[];
}

/**
 * The output shape both agent steps declare. Downstream refs bind against
 * this, so it must not diverge between them.
 */
export const AgentResultSchema = z.object({
  response: z.union([z.string(), z.record(z.unknown())]),
  toolCalls: z.array(
    z.object({
      name: z.string(),
      args: z.record(z.unknown()),
      result: z.unknown(),
      durationMs: z.number(),
    }),
  ),
  turnCount: z.number(),
  usage: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
  }),
  attachments: z.array(AttachmentSchema),
});

// ─── Utility ───

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Reject `promise` if it has not settled within `timeoutMs`.
 *
 * `label` names what timed out — tool execution for the LLM step, the whole
 * agent run for a host-backed one — so the error text stays accurate wherever
 * this is applied.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label = 'Tool execution'): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(
        () => { reject(new Error(`${label} timed out after ${timeoutMs}ms`)); },
        timeoutMs,
      );
      // Don't block Node from exiting
      if (typeof timer === 'object' && 'unref' in timer) {
        (timer as NodeJS.Timeout).unref();
      }
    }),
  ]);
}

// ─── Response Classification (repair loop) ───

/** Why a response could not be used, in the form fed back to the agent. */
export type ResponseDefect = { reason: 'empty' | 'unparseable' | 'mismatch'; error?: string };

/**
 * Classify a response for the repair loop: `ok`, or not-ok with the reason —
 * `empty` (nothing to parse), `unparseable` (JSON.parse threw), or `mismatch`
 * (valid JSON that breaks `outputSchema`) — with the error text so it can be
 * fed back to the model.
 *
 * The schema was only ever pasted into the prompt; checking it here is what
 * makes it a contract. An `enum` of screen ids, say, now rejects an id the
 * model invented instead of passing it downstream.
 */
export function classifyResponse(
  raw: string,
  expectJson: boolean,
  outputSchema?: Record<string, unknown>,
): { ok: true } | ({ ok: false } & ResponseDefect) {
  const trimmed = raw.trim();
  // An empty response is always a failure — regardless of output type.
  if (trimmed.length === 0) return { ok: false, reason: 'empty' };
  // For non-JSON outputs, any non-empty text is acceptable.
  if (!expectJson) return { ok: true };
  const unfenced = stripCodeFence(trimmed);
  if (unfenced.length === 0) return { ok: false, reason: 'empty' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch (e) {
    return { ok: false, reason: 'unparseable', error: e instanceof Error ? e.message : String(e) };
  }
  const problem = outputSchema ? schemaProblem(parsed, outputSchema, '') : null;
  return problem ? { ok: false, reason: 'mismatch', error: problem } : { ok: true };
}

/**
 * The schema a JSON response is held to, from whatever the step declared: an
 * object, or JSON text (a resolved `{{ref}}`). None for text output, an empty
 * schema, or text that isn't a JSON object.
 */
export function declaredSchema(outputType: unknown, outputSchema: unknown): Record<string, unknown> | undefined {
  if (outputType !== 'json' || outputSchema === undefined || outputSchema === null) return undefined;
  let schema: unknown = outputSchema;
  if (typeof schema === 'string') {
    try {
      schema = JSON.parse(schema);
    } catch {
      return undefined;
    }
  }
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return undefined;
  return Object.keys(schema).length > 0 ? (schema as Record<string, unknown>) : undefined;
}

/**
 * The first way `value` breaks `schema`, phrased for the model; `null` when it
 * fits. Covers what agent output schemas actually use — `type`, `required`,
 * `properties`, `enum`, `items` — and treats anything else as permissive.
 */
export function schemaProblem(value: unknown, schema: Record<string, unknown>, path: string): string | null {
  const at = path || 'the response';
  const allowed = schema['enum'];
  if (Array.isArray(allowed) && !allowed.some((v) => JSON.stringify(v) === JSON.stringify(value))) {
    return `${at} must be one of: ${allowed.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(', ')} (got ${JSON.stringify(value)})`;
  }
  const type = schema['type'];
  if (typeof type === 'string' && !matchesType(value, type)) {
    return `${at} must be ${type === 'array' || type === 'object' || type === 'integer' ? `an ${type}` : `a ${type}`} (got ${describeValue(value)})`;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const required = Array.isArray(schema['required']) ? (schema['required'] as unknown[]) : [];
    for (const key of required) {
      if (typeof key === 'string' && !(key in obj)) return `${path ? `${path}.` : ''}${key} is required`;
    }
    const properties = schema['properties'];
    if (properties && typeof properties === 'object') {
      for (const [key, sub] of Object.entries(properties as Record<string, unknown>)) {
        if (!(key in obj) || !sub || typeof sub !== 'object') continue;
        const problem = schemaProblem(obj[key], sub as Record<string, unknown>, path ? `${path}.${key}` : key);
        if (problem) return problem;
      }
    }
  }
  const items = schema['items'];
  if (Array.isArray(value) && items && typeof items === 'object' && !Array.isArray(items)) {
    for (let i = 0; i < value.length; i++) {
      const problem = schemaProblem(value[i], items as Record<string, unknown>, `${path || 'the response'}[${i}]`);
      if (problem) return problem;
    }
  }
  return null;
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'object': return !!value && typeof value === 'object' && !Array.isArray(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: return true;
  }
}

function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value === 'object' ? 'an object' : `${typeof value} ${JSON.stringify(value)}`;
}

/**
 * Parse a JSON-mode agent response into an object. Strips Markdown code fences
 * the model may wrap around the JSON. Falls back to `{ text }` if the response
 * isn't valid JSON or isn't an object, so the output always matches the
 * declared object shape.
 */
export function parseJsonResponse(raw: string): Record<string, unknown> {
  const unfenced = stripCodeFence(raw.trim());
  try {
    const parsed = JSON.parse(unfenced) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { text: raw };
  }
}

function stripCodeFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

// ─── Output Shaping ───

/**
 * Shape a raw agent response per `outputType` — parse JSON when requested, and
 * split out citations when `cite` is on.
 */
export function shapeAgentResponse(
  raw: string | Record<string, unknown>,
  opts: { outputType: 'string' | 'json'; cite: boolean },
  log: { warn(msg: string): void },
): string | Record<string, unknown> {
  if (opts.outputType !== 'json' || typeof raw !== 'string') return raw;
  const parsed = parseJsonResponse(raw);
  return opts.cite ? splitCitedResponse(parsed, log) : parsed;
}

/**
 * Resolve the declared output JSON Schema for an agent step instance.
 *
 * With citations on the agent returns `{value, citation}`, so downstream refs
 * and layouts address `output.response.value.*`. Gating the schema on the same
 * flag as the runtime split keeps the declared and actual shapes in step —
 * they flip together, per step, or not at all.
 */
export function resolveAgentOutputJsonSchema(config: Record<string, unknown>): Record<string, unknown> {
  const outputType = config['outputType'] === 'json' ? 'json' : 'string';
  const rawSchema = config['outputSchema'];
  const userSchema = isRecord(rawSchema) ? rawSchema : undefined;
  let response: Record<string, unknown> =
    outputType === 'json'
      ? (userSchema && Object.keys(userSchema).length > 0 ? userSchema : { type: 'object' })
      : { type: 'string' };

  if (outputType === 'json' && config['cite'] === true) {
    response = {
      type: 'object',
      properties: { value: response, citation: { type: 'object' } },
    };
  }

  return {
    type: 'object',
    properties: {
      response,
      attachments: ATTACHMENT_ARRAY_JSON_SCHEMA,
      toolCalls: { type: 'array' },
      usage: { type: 'object' },
    },
  };
}
