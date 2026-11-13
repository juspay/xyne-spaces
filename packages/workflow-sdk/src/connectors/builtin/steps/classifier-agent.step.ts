/**
 * CLASSIFIER_AGENT — put something in one of the classes you name, with a
 * measure of how sure the model was.
 *
 * ## What it is not
 *
 * Despite the name it has nothing in common with `RUN_AGENT`: no session, no
 * tools, no streaming, no turns, nothing kept between runs. It is one HTTP call
 * that sends the thing to classify and the classes, and returns one of them.
 * The step does not act on the answer — a CONDITIONAL, SWITCH or GO_TO after it
 * does.
 *
 * ## The model behind it
 *
 * A "System One" model: one that answers typed questions rather than writing
 * prose. TypeSafe's Jev is one; any endpoint speaking the same contract is
 * another, which is why the endpoint is configuration and no vendor is named in
 * the code.
 *
 *     POST <endpoint>                       Authorization: Bearer <key>
 *     { "model": "<model>", "state": <what to classify>,
 *       "questions": { "class": { "type": "choice",
 *                                 "instructions": "<the question>",
 *                                 "criteria": { "<class>": "<what it means>" } } } }
 *
 *     → { "answers": { "class": { "choice": "…", "probabilities": { … },
 *                                 "confidence": 0.74 } }, "usage": { … } }
 *
 * ## Confidence
 *
 * `confidence` is how concentrated the probabilities are: one clear peak is
 * high, a flat spread is low. Set `minConfidence` with a `fallbackClass` and a
 * shaky answer becomes that class instead — so a flow can ask again rather than
 * act on a guess. `belowConfidence` says it happened; `probabilities` always
 * carries what the model actually thought.
 */

import { z } from 'zod';
import { BaseActionStep } from '../../../steps/base-step.js';
import type { StepExecutionContext } from '../../../steps/base-step.js';
import { BuiltinStepType } from '../../../types/known-types.js';
import type { StepCategory } from '../../../types/categories.js';
import { BUILTIN_ENDPOINT_KEY } from '../credentials.js';
import { markCredentialField } from '../../../util/credential-slot-schema.js';
import { applyResolvedCredentialAuth, CredentialNameSchema } from '../../../common/credentials.js';
import { variableRef } from '../../../types/workflow-config.js';
import { publicFetch } from './ssrf-guard.js';
import { DEFAULT_CLASSIFIER_ENDPOINT } from '../../../conversational-flow/types.js';

export { DEFAULT_CLASSIFIER_ENDPOINT } from '../../../conversational-flow/types.js';

/** The one question this step asks, and the field its answer comes back under. */
const QUESTION = 'class';

/** Answers worth trying again: rate limited, and overloaded. */
const RETRY_STATUS = new Set([429, 529]);

// ─── Config ───

export const ClassifierAgentStepConfigSchema = z.object({
  input: z
    .union([z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown())])
    .describe('What to classify — the message, or an object of everything the model should weigh. Supports {{variable}} refs'),
  instructions: z
    .string()
    .min(1)
    .describe('The question put to the model, e.g. "Which screen answers this message?"'),
  classes: z
    .record(z.string().min(1), z.string().min(1))
    .describe('The classes to choose between: each key is what the step answers, each value describes when it applies. The description is what the model reads, so write it for a reader who has never seen this flow'),
  model: z.string().min(1).default('jev-latest').describe('Model id at that endpoint'),
  credentialName: variableRef(
    CredentialNameSchema.describe(
      'The service to ask: an “Endpoint & API key” credential holding where it lives and the key it takes. Without one, the default endpoint is called unauthenticated',
    ),
  ).optional(),
  minConfidence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Below this, answer `fallbackClass` instead of the model\'s pick — so the flow can ask again rather than act on a guess'),
  fallbackClass: z
    .string()
    .min(1)
    .optional()
    .describe('What to answer when the model is less sure than `minConfidence`. Needs `minConfidence`'),
  timeoutMs: z.number().int().positive().default(15_000).describe('How long to wait for the answer'),
  maxAttempts: z.number().int().min(1).max(5).default(3).describe('Attempts when the service is rate limited or overloaded'),
});

export type ClassifierAgentStepConfig = z.infer<typeof ClassifierAgentStepConfigSchema>;

// ─── Output ───

const ClassifierAgentStepOutputSchema = z.object({
  class: z.string(),
  confidence: z.number(),
  probabilities: z.record(z.string(), z.number()),
  belowConfidence: z.boolean(),
  model: z.string(),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }),
});

export interface ClassifierAgentStepOutput extends Record<string, unknown> {
  /** The class chosen — or `fallbackClass`, when the model was less sure than asked. */
  class: string;
  /** 0–1: how concentrated the model's probabilities were. */
  confidence: number;
  /** What the model thought of every class, whatever was answered. */
  probabilities: Record<string, number>;
  belowConfidence: boolean;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

// ─── Step ───

export class ClassifierAgentStep extends BaseActionStep<
  typeof ClassifierAgentStepConfigSchema,
  ClassifierAgentStepOutput
> {
  override readonly type = BuiltinStepType.CLASSIFIER_AGENT;
  override readonly name = 'Classifier';
  override readonly description =
    'Put something in one of the classes you name — which screen answers a message, which team a ticket belongs to — and say how sure the model was';
  override readonly configSchema = ClassifierAgentStepConfigSchema;
  override readonly outputSchema = ClassifierAgentStepOutputSchema;
  override readonly category: StepCategory = 'integration';
  override readonly icon = 'list-tree';

  override readonly credentialSlots = [{ name: 'credentialName', required: false }] as const;

  /** Where the model lives and the key it takes — both from the credential. */
  override readonly credential = [BUILTIN_ENDPOINT_KEY];

  override decorateConfigSchema(jsonSchema: Record<string, unknown>): Record<string, unknown> {
    const props = jsonSchema['properties'] as Record<string, Record<string, unknown>> | undefined;
    if (props?.['credentialName']) {
      props['credentialName'] = markCredentialField(props['credentialName'], this.credential);
    }
    return jsonSchema;
  }

  /** `class` is one of the configured classes, so downstream pickers offer them. */
  override resolveOutputJsonSchema(config: Record<string, unknown>): Record<string, unknown> {
    const classes = config['classes'];
    const names = classes && typeof classes === 'object' && !Array.isArray(classes) ? Object.keys(classes) : [];
    const fallback = typeof config['fallbackClass'] === 'string' ? config['fallbackClass'] : undefined;
    const values = [...new Set([...names, ...(fallback ? [fallback] : [])])];
    return {
      type: 'object',
      properties: {
        class: values.length > 0 ? { type: 'string', enum: values } : { type: 'string' },
        confidence: { type: 'number' },
        probabilities: { type: 'object', additionalProperties: { type: 'number' } },
        belowConfidence: { type: 'boolean' },
        model: { type: 'string' },
        usage: {
          type: 'object',
          properties: { inputTokens: { type: 'number' }, outputTokens: { type: 'number' } },
        },
      },
    };
  }

  override async execute(
    config: ClassifierAgentStepConfig,
    ctx: StepExecutionContext,
  ): Promise<ClassifierAgentStepOutput> {
    const names = Object.keys(config.classes);
    if (names.length < 2) {
      throw new Error('CLASSIFIER_AGENT needs at least two classes to choose between.');
    }
    if (config.fallbackClass !== undefined && config.minConfidence === undefined) {
      throw new Error('CLASSIFIER_AGENT: `fallbackClass` needs `minConfidence` to say when to use it.');
    }
    // Where to ask and the key to ask with both come from the credential, so a
    // workflow moves between services without being edited.
    const credential = ctx.credentials['credentialName'];
    const endpoint =
      credential?.authType === 'endpoint_key' ? credential.values.endpoint : DEFAULT_CLASSIFIER_ENDPOINT;

    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (credential) applyResolvedCredentialAuth(headers, credential);

    const body = JSON.stringify({
      model: config.model,
      state: config.input,
      questions: {
        [QUESTION]: { type: 'choice', instructions: config.instructions, criteria: config.classes },
      },
    });

    const answer = await this.ask(config, endpoint, headers, body);
    const chosen = str(answer['choice']);
    if (!chosen) throw new Error('CLASSIFIER_AGENT: the service answered without a choice.');
    const confidence = num(answer['confidence']) ?? 0;
    const below = config.minConfidence !== undefined && confidence < config.minConfidence;

    return {
      class: below && config.fallbackClass ? config.fallbackClass : chosen,
      confidence,
      probabilities: numbers(answer['probabilities']),
      belowConfidence: below,
      model: str(answer['__model']) ?? config.model,
      usage: { inputTokens: num(answer['__inputTokens']) ?? 0, outputTokens: num(answer['__outputTokens']) ?? 0 },
    };
  }

  /** One call, retried while the service says it is busy. */
  private async ask(
    config: ClassifierAgentStepConfig,
    endpoint: string,
    headers: Headers,
    body: string,
  ): Promise<Record<string, unknown>> {
    let lastBusy = '';
    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      let response: Response;
      try {
        response = await publicFetch(endpoint, { method: 'POST', headers, body, signal: controller.signal });
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw new Error(`CLASSIFIER_AGENT timed out after ${String(config.timeoutMs)}ms`);
        }
        throw err;
      }
      clearTimeout(timer);

      const text = await response.text();
      if (response.ok) return flatten(text);

      // The service's own message, which says what it disliked.
      const message = detail(text) ?? `${String(response.status)} ${response.statusText}`;
      if (!RETRY_STATUS.has(response.status) || attempt === config.maxAttempts) {
        throw new Error(`CLASSIFIER_AGENT: ${message}`);
      }
      lastBusy = message;
      await sleep(200 * 2 ** (attempt - 1));
    }
    throw new Error(`CLASSIFIER_AGENT: ${lastBusy}`);
  }
}

// ─── Reading the answer ───

/** The answer to our one question, with the response's own model and usage alongside. */
function flatten(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('CLASSIFIER_AGENT: the service answered with something that is not JSON.');
  }
  const body = rec(parsed);
  const answer = rec(rec(body['answers'])[QUESTION]);
  const usage = rec(body['usage']);
  return {
    ...answer,
    __model: body['model'],
    __inputTokens: usage['input_tokens'],
    __outputTokens: usage['output_tokens'],
  };
}

function detail(text: string): string | undefined {
  try {
    const body = rec(JSON.parse(text));
    return str(body['message']) ?? str(body['error']) ?? str(body['detail']);
  } catch {
    return text.trim() ? text.trim().slice(0, 300) : undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function numbers(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, value] of Object.entries(rec(v))) {
    const n = num(value);
    if (n !== undefined) out[k] = n;
  }
  return out;
}
