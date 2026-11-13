/**
 * WAIT_FOR_HUMAN step — wait for a person to answer.
 *
 * Which person depends on the workflow: inside a conversational flow the screen
 * waits on the customer it is talking to, and everywhere else on somebody
 * inside the product. Only the second belongs in the approvals inbox, and the
 * difference comes from the workflow's own kind rather than from the author
 * marking each screen.
 *
 * The one gate that reaches the approvals inbox, which is why it is its own
 * step rather than a mode: what it needs (a reason, a prompt, read-only
 * sections, a form, choices) has nothing in common with waiting on a system or
 * on a clock.
 *
 * Answered through the resume API, which authorizes the person.
 */

import { z } from 'zod';
import { BaseActionStep } from '../../../steps/base-step.js';
import type { StepExecutionContext } from '../../../steps/base-step.js';
import { BuiltinStepType, CONVERSATIONAL_FLOW_KIND, GateCategory } from '../../../types/known-types.js';
import type { StepCategory } from '../../../types/categories.js';
import type { PauseForm, PauseFormField, PauseState } from '../../../types/pause-state.js';
import { ConditionSchema } from '../../../types/workflow-config.js';
import { ConditionEvaluator } from '../../../engine/condition-evaluator.js';
import { ATTACHMENT_ARRAY_JSON_SCHEMA } from '../../../common/attachment.js';
import { pauseFormToJsonSchema } from '../../../util/pause-form-schema.js';

// ─── Pause UI Schemas (shared with PauseState types) ───

const PauseDisplaySectionSchema = z.object({
  // Stable key for citation addressing (StepConfigBase.citations). Optional and
  // ignored by the executor; declared here so the builder can attach a citation
  // to a specific row without injecting an undeclared field that Zod would strip.
  id: z.string().optional(),
  label: z.string(),
  value: z.unknown(),
});

const PauseFormFieldOptionSchema = z.object({
  label: z.string(),
  value: z.string(),
  when: ConditionSchema.optional().describe(
    'Offer this choice only when the condition holds. Omit to always offer it.',
  ),
});

const PauseFormFieldSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    name: z.string(),
    label: z.string(),
    required: z.boolean().optional(),
    description: z.string().optional(),
    placeholder: z.string().optional(),
    defaultValue: z.string().optional(),
  }),
  z.object({
    type: z.literal('textarea'),
    name: z.string(),
    label: z.string(),
    required: z.boolean().optional(),
    description: z.string().optional(),
    placeholder: z.string().optional(),
    defaultValue: z.string().optional(),
    rows: z.number().optional(),
  }),
  z.object({
    type: z.literal('number'),
    name: z.string(),
    label: z.string(),
    required: z.boolean().optional(),
    description: z.string().optional(),
    placeholder: z.string().optional(),
    defaultValue: z.number().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  }),
  z.object({
    type: z.literal('select'),
    name: z.string(),
    label: z.string(),
    required: z.boolean().optional(),
    description: z.string().optional(),
    placeholder: z.string().optional(),
    defaultValue: z.string().optional(),
    // Accepts array of options or a {{variable}} ref string (resolved at runtime)
    options: z.union([z.array(PauseFormFieldOptionSchema), z.string()]),
    allowCustomValue: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('checkbox'),
    name: z.string(),
    label: z.string(),
    required: z.boolean().optional(),
    description: z.string().optional(),
    defaultValue: z.boolean().optional(),
  }),
  // NOTE: keep in sync with the `PauseFormField` union in types/pause-state.ts.
  z.object({
    type: z.literal('attachment'),
    name: z.string(),
    label: z.string(),
    required: z.boolean().optional(),
    description: z.string().optional(),
    multiple: z.boolean().optional().describe('Allow multiple files (value becomes an attachment array)'),
    accept: z.array(z.string()).optional().describe('Accepted MIME types, e.g. ["application/pdf","image/*"]'),
    maxSize: z.number().optional().describe('Max bytes per file'),
    maxItems: z.number().optional().describe('Max number of files (multiple only)'),
  }),
]);

const PauseFormSchema = z.object({
  fields: z.array(PauseFormFieldSchema),
  description: z.string().optional(),
});

const PauseActionSchema = z.object({
  key: z.string(),
  label: z.string(),
  style: z.enum(['primary', 'danger', 'default']).optional(),
  abort: z.boolean().optional(),
  submitsForm: z.boolean().optional(),
});

// ─── Config ───

export const WaitForHumanConfigSchema = z.object({
  reason: z.string().min(1).describe('Human-readable reason shown to the approver'),
  dueInMs: z.number().int().positive().optional().describe('How long the approver has, in milliseconds. Omit for no deadline'),
  prompt: z.array(z.string()).optional().describe('What to show above the interaction panel. Each one is shown in turn'),
  display: z.array(PauseDisplaySectionSchema).optional().describe('Read-only data sections to display. Values support {{variable}} refs'),
  form: PauseFormSchema.optional().describe('Editable form with typed fields for the approver'),
  purpose: z.string().optional()
    .describe('What the answers are for, in the author’s own word — e.g. "feedback". Carried to whoever reads the run, so one kind of answer can be told from another across workflows. Never read by the engine'),
  actions: z.array(PauseActionSchema).optional().describe('Action buttons. Defaults to Approve + Reject when omitted'),
  assignee: z.unknown().optional().describe('Who may act on this gate.'),
});

export type WaitForHumanConfig = z.infer<typeof WaitForHumanConfigSchema>;

// ─── Output ───

export interface WaitForHumanOutput extends Record<string, unknown> {
  /** What the person answered: the action they chose, their text, their form fields. */
  resumeData: Record<string, unknown>;
}

const WaitForHumanOutputSchema = z.object({ resumeData: z.record(z.unknown()) });

// ─── Step ───

export class WaitForHumanStep extends BaseActionStep<
  typeof WaitForHumanConfigSchema,
  WaitForHumanOutput
> {
  override readonly type = BuiltinStepType.WAIT_FOR_HUMAN;
  override readonly name = 'Wait for a person';
  override readonly description = 'Pause until someone approves, rejects, or fills in the form';
  override readonly configSchema = WaitForHumanConfigSchema;
  override readonly outputSchema = WaitForHumanOutputSchema;
  override readonly category: StepCategory = 'flow';
  override readonly icon = 'user-check';

  override decorateConfigSchema(jsonSchema: Record<string, unknown>): Record<string, unknown> {
    const props = jsonSchema['properties'] as Record<string, Record<string, unknown>> | undefined;
    if (props) {
      props['assignee'] = {
        ...(props['assignee'] ?? {}),
        format: 'assignee',
        type: 'array',
        items: { type: 'string' },
        title: 'Assignees',
        description:
          'Who may approve this step.',
      };
    }
    return jsonSchema;
  }

  /** The answer is shaped by the form the author declared. */
  override resolveOutputJsonSchema(config: Record<string, unknown>): Record<string, unknown> {
    const form = config['form'] as PauseForm | undefined;
    return {
      type: 'object',
      properties: {
        resumeData: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['approve', 'retry', 'abort'] },
            feedback: { type: 'string' },
            attachments: ATTACHMENT_ARRAY_JSON_SCHEMA,
            data: form?.fields?.length
              ? pauseFormToJsonSchema(form)
              : { type: 'object', additionalProperties: true },
          },
          additionalProperties: true,
        },
      },
    };
  }

  override async execute(
    config: WaitForHumanConfig,
    ctx: StepExecutionContext,
  ): Promise<WaitForHumanOutput> {
    const pauseState: PauseState = { reason: config.reason };
    if (config.prompt?.length) pauseState.prompt = config.prompt;
    if (config.display) pauseState.display = config.display as PauseState['display'];
    if (config.form) pauseState.form = await this.offered(config.form as PauseForm, ctx);
    if (config.actions) pauseState.actions = config.actions as PauseState['actions'];

    ctx.pause(config.reason, {
      category: audienceOf(ctx),
      statePatch: {
        reason: config.reason,
        pauseState,
        // Stamped when the gate OPENS, not when the run started: a run may work
        // for a while before it reaches this step, and the approver's clock
        // should start when the request actually reaches them.
        ...(config.dueInMs !== undefined
          ? { dueAt: new Date(Date.now() + config.dueInMs).toISOString() }
          : {}),
      },
    });
  }

  override onResume(rowData: Record<string, unknown>): Promise<WaitForHumanOutput> {
    const answer = (rowData['resumePayload'] as Record<string, unknown> | undefined) ?? {};
    return Promise.resolve({ resumeData: answer });
  }

  /**
   * The form as this person sees it: a choice carrying a `when` is kept only
   * when the condition holds against the run so far.
   *
   * What is filtered is the *offer*, not the answer — so nothing downstream has
   * to know a choice existed. A field left with no choices still renders; that
   * is the author's flow saying "under this data, there is nothing to pick here",
   * and hiding the question instead would be this step inventing a rule.
   */
  private async offered(form: PauseForm, ctx: StepExecutionContext): Promise<PauseForm> {
    const anyConditioned = form.fields.some(
      (field) => field.type === 'select' && Array.isArray(field.options) && field.options.some((o) => o.when !== undefined),
    );
    if (!anyConditioned) return form;

    const evaluator = new ConditionEvaluator();
    // Evaluating a condition is async now, so the keep/drop decision is made up
    // front and the filter reads the answers. Options are independent of each
    // other, so they resolve together.
    const fields = await Promise.all(
      form.fields.map(async (field): Promise<PauseFormField> => {
        if (field.type !== 'select' || !Array.isArray(field.options)) return field;
        const keep = await Promise.all(
          field.options.map((option) =>
            option.when === undefined
              ? Promise.resolve(true)
              : evaluator.evaluate(option.when, ctx.workflow),
          ),
        );
        const options = field.options.filter((_, i) => keep[i]);
        return options.length === field.options.length ? field : { ...field, options };
      }),
    );
    return { ...form, fields };
  }
}

/**
 * Who this gate is addressed to.
 *
 * A conversational flow is consumer-facing, so every screen of one waits on the
 * person in the conversation. A flow that ever needs a genuine internal
 * approval would need that step to say so; the builder only emits screens.
 */
function audienceOf(ctx: StepExecutionContext): GateCategory {
  return ctx.workflow.workflow.metadata['kind'] === CONVERSATIONAL_FLOW_KIND
    ? GateCategory.WaitingOnConsumer
    : GateCategory.WaitingOnApprover;
}
