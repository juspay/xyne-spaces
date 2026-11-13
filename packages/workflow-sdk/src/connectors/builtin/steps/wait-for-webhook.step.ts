/**
 * WAIT_FOR_WEBHOOK step — wait for an external system to post its result.
 *
 * The author declares what will arrive; everything else about the inbound
 * request belongs to the host, which authenticates the caller, owns the route,
 * and calls `runtime.deliver`. The declared schema does two jobs: it types
 * `output.body` for the steps downstream, and a body that does not satisfy it
 * is refused so the sender learns rather than the run carrying on with a field
 * that is not there.
 *
 * A deadline rides on the same `wakeAt` the delay step uses, so a callback that
 * never comes ends the wait instead of parking the run for ever.
 */

import { z } from 'zod';
import { BaseActionStep } from '../../../steps/base-step.js';
import type { StepExecutionContext } from '../../../steps/base-step.js';
import { BuiltinStepType, GateCategory } from '../../../types/known-types.js';
import type { StepCategory } from '../../../types/categories.js';
import type { PauseState } from '../../../types/pause-state.js';
import { variableRef } from '../../../types/workflow-config.js';

export const WaitForWebhookConfigSchema = z.object({
  payload: z
    .record(z.unknown())
    .optional()
    .describe(
      'JSON Schema of the body the caller will POST. Types the variable picker for later steps, and its required fields are enforced on arrival',
    ),
  deadlineMs: variableRef(
    z.number().int().positive().describe('How long to wait before giving up'),
  ).optional(),
  onTimeout: z
    .enum(['fail', 'continue'])
    .default('fail')
    .describe(
      'What a deadline that passes means: fail the run, or carry on with timedOut set so the flow can branch',
    ),
});

export type WaitForWebhookConfig = z.infer<typeof WaitForWebhookConfigSchema>;

export interface WaitForWebhookOutput extends Record<string, unknown> {
  /** What the caller sent, shaped by the declared schema. Null on a timeout. */
  body: unknown;
  /** When it arrived, ISO 8601. Empty on a timeout. */
  receivedAt: string;
  /** True when the deadline passed with nothing delivered. */
  timedOut: boolean;
}

const WaitForWebhookOutputSchema = z.object({
  body: z.unknown(),
  receivedAt: z.string(),
  timedOut: z.boolean(),
});

export class WaitForWebhookStep extends BaseActionStep<
  typeof WaitForWebhookConfigSchema,
  WaitForWebhookOutput
> {
  override readonly type = BuiltinStepType.WAIT_FOR_WEBHOOK;
  override readonly name = 'Wait for a webhook';
  override readonly description =
    'Pause until an external system posts its result back to this run';
  override readonly configSchema = WaitForWebhookConfigSchema;
  override readonly outputSchema = WaitForWebhookOutputSchema;
  override readonly category: StepCategory = 'flow';
  override readonly icon = 'webhook';

  /** The payload field holds a JSON Schema, which the editor edits as one. */
  override decorateConfigSchema(jsonSchema: Record<string, unknown>): Record<string, unknown> {
    const props = jsonSchema['properties'] as Record<string, Record<string, unknown>> | undefined;
    if (props?.['payload']) {
      props['payload'] = { ...props['payload'], format: 'json-schema' };
    }
    return jsonSchema;
  }

  /** `body` is whatever the author declared — the same trick the HTTP step does with its response. */
  override resolveOutputJsonSchema(config: Record<string, unknown>): Record<string, unknown> {
    const declared = config['payload'];
    const body =
      declared && typeof declared === 'object' && !Array.isArray(declared)
        ? (declared as Record<string, unknown>)
        : { type: 'object', additionalProperties: true };
    return {
      type: 'object',
      properties: {
        body,
        receivedAt: { type: 'string' },
        timedOut: { type: 'boolean' },
      },
    };
  }

  // Async so a signature promising a Promise never throws synchronously.
  override async execute(config: WaitForWebhookConfig, ctx: StepExecutionContext): Promise<WaitForWebhookOutput> {
    const deadlineMs = config.deadlineMs === undefined ? undefined : Number(config.deadlineMs);
    if (deadlineMs !== undefined && (!Number.isInteger(deadlineMs) || deadlineMs <= 0)) {
      throw new Error(`Deadline needs a whole number of milliseconds, got ${JSON.stringify(config.deadlineMs)}`);
    }

    const pauseState: PauseState = {
      reason: 'Waiting for a webhook',
      display: [{ label: 'Step', value: ctx.runtime.stepName }],
    };

    ctx.pause('Waiting for a webhook', {
      category: GateCategory.WaitingOnApiCall,
      statePatch: {
        pauseState,
        // The engine checks a delivery against this, so the contract travels
        // with the gate rather than being looked up in the config again.
        ...(config.payload !== undefined ? { contract: config.payload } : {}),
        ...(deadlineMs !== undefined
          ? { wakeAt: new Date(Date.now() + deadlineMs).toISOString() }
          : {}),
      },
    });
  }

  override async onResume(
    rowData: Record<string, unknown>,
    config: WaitForWebhookConfig,
  ): Promise<WaitForWebhookOutput> {
    const delivery = rowData['delivery'] as
      | { payload?: unknown; receivedAt?: string }
      | undefined;

    if (delivery === undefined) {
      // Nothing was delivered, so the only way back here is the deadline.
      if (config.onTimeout === 'fail') {
        throw new Error('No webhook arrived before the deadline');
      }
      return { body: null, receivedAt: '', timedOut: true };
    }

    return {
      body: delivery.payload ?? null,
      receivedAt: delivery.receivedAt ?? '',
      timedOut: false,
    };
  }
}
