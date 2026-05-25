import { z } from 'zod';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import { variableRef } from '../engine/variable-ref';
import type { AutomationContext } from '../types/context';
import { PauseStep } from '../engine/pause-step';
import { automationContextStorage } from '../engine/automation-context-storage';
import { clawClient } from '../services/claw-client';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

const OutputFieldTypeSchema = z.enum(['string', 'number', 'boolean', 'object', 'array']);
export type OutputFieldType = z.infer<typeof OutputFieldTypeSchema>;

const OutputSchemaNodeSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([OutputFieldTypeSchema, z.record(z.string().min(1), OutputSchemaNodeSchema)]),
);
const OutputSchemaSchema = z.record(z.string().min(1), OutputSchemaNodeSchema);
export type RunAgentOutputSchema = z.infer<typeof OutputSchemaSchema>;

const RunAgentConfigSchema = z.object({
  agentSlug: variableRef(z.string().min(1).describe('Claw agent slug')),
  prompt: variableRef(z.string().min(1).describe('Prompt for the agent')),
  outputSchema: OutputSchemaSchema.describe(
    'Expected output shape: keys must be present in the agent response; extra fields are kept but not validated.',
  ),
});

export type RunAgentConfig = z.infer<typeof RunAgentConfigSchema>;

const RunAgentOutputSchemaPermissive = z.record(z.string(), z.unknown());
type RunAgentOutput = z.infer<typeof RunAgentOutputSchemaPermissive> & Record<string, unknown>;

export class RunAgentStep extends BaseActionStep<typeof RunAgentConfigSchema, RunAgentOutput> {
  readonly type = 'RUN_AGENT';
  readonly configSchema = RunAgentConfigSchema;
  readonly outputSchema = RunAgentOutputSchemaPermissive;
  readonly name = 'Run an agent';
  readonly description =
    'Send a prompt to an xyne-claw agent and wait for its JSON response. Downstream steps can use the fields you declare in the output schema.';
  readonly category = StepCategory.AI;
  readonly icon = 'Sparkles';

  async execute(
    cfg: z.infer<typeof RunAgentConfigSchema>,
    context: AutomationContext,
  ): Promise<RunAgentOutput> {
    const store = automationContextStorage.getStore();
    if (!store) {
      throw new Error(
        '[RUN_AGENT] step executed outside an automation context — automationContextStorage was empty',
      );
    }

    const stepCount = Object.keys(context.steps).length;
    const currentIndex = Math.max(0, stepCount - 1);

    const sessionId = `${store.runId}:step_${currentIndex}`;
   const callbackUrl = `${config.backendUrl.replace(/\/$/, '')}/api/internal/automations/claw-callback/${encodeURIComponent(store.runId)}/${encodeURIComponent(`step_${currentIndex}`)}`;

    const agentSlug = cfg.agentSlug as string;
    const prompt = cfg.prompt as string;

    let runUserId = context.automation.createdById;
    let resolvedFrom: 'agent.spacesAppUserId' | 'automation.createdById' = 'automation.createdById';
    try {
      const agent = await clawClient.getAgentBySlug(agentSlug);
      if (agent?.spacesAppUserId) {
        runUserId = agent.spacesAppUserId;
        resolvedFrom = 'agent.spacesAppUserId';
      } else {
        logger.info(
          `[RUN_AGENT] agent "${agentSlug}" has no spacesAppUserId — attributing to automation creator ${runUserId}`,
        );
      }
    } catch (err) {
      logger.warn(
        `[RUN_AGENT] failed to fetch agent "${agentSlug}" for userId resolution; falling back to creator:`,
        err,
      );
    }

    logger.info(
      `[RUN_AGENT] firing — executionId=${store.runId} stepIndex=${currentIndex} agentSlug=${agentSlug} sessionId=${sessionId} userId=${runUserId} (from ${resolvedFrom})`,
    );

    try {
      await clawClient.runAgent({
        sessionId,
        agentSlug,
        task: prompt,
        userId: runUserId,
        callbackUrl,
      });
    } catch (err) {
      logger.error(
        `[RUN_AGENT] claw rejected the run — executionId=${store.runId} stepIndex=${currentIndex}:`,
        err,
      );
      throw err;
    }
    throw new PauseStep(`waiting on claw agent ${agentSlug}`, { externalRef: sessionId });
  }
}

export const runAgentStep = new RunAgentStep();
