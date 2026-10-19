import { z } from 'zod';
import { BaseActionStep, variableRef } from '@xyne/workflow-sdk';
import type { StepExecutionContext } from '@xyne/workflow-sdk';
import { deepResearch } from '@/services/research/deepResearchService';

const DeepResearchConfigSchema = z.object({
  query: variableRef(
    z
      .string()
      .min(1)
      .describe('Research question. Bind to a ref (e.g. {{trigger.topic}}) or type a literal.')
  ),
  maxIterations: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Optional: override the research-round budget (default set by the service).'),
});

/** Referenced downstream as `steps.<id>.output.report`. */
const DeepResearchOutputSchema = z.object({
  report: z.string(),
  threadId: z.string(),
});

interface DeepResearchOutput extends Record<string, unknown> {
  report: string;
  threadId: string;
}

export class DeepResearchStep extends BaseActionStep<
  typeof DeepResearchConfigSchema,
  DeepResearchOutput
> {
  readonly type = 'DEEP_RESEARCH';
  readonly configSchema = DeepResearchConfigSchema;
  readonly outputSchema = DeepResearchOutputSchema;
  readonly name = 'Deep Research';
  readonly description =
    'Runs an in-depth, multi-source research investigation and returns a comprehensive markdown ' +
    'report. Blocks until the report is ready — use it for a deterministic research stage.';
  readonly category = 'ai';
  readonly icon = 'Telescope';

  async execute(
    config: z.infer<typeof DeepResearchConfigSchema>,
    ctx: StepExecutionContext
  ): Promise<DeepResearchOutput> {
    const query = String(config.query ?? '').trim();
    if (!query) {
      throw new Error(
        "DEEP_RESEARCH: 'query' is empty — bind it to a ref like {{trigger.topic}} or set a literal."
      );
    }

    ctx.log.info(`DEEP_RESEARCH: starting research for "${query.slice(0, 80)}"`);
    const signal = ctx.runtime.metadata['signal'] as AbortSignal | undefined;
    const { report, threadId } = await deepResearch(query, {
      ...(signal ? { signal } : {}),
      ...(config.maxIterations !== undefined ? { maxIterations: config.maxIterations } : {}),
    });
    ctx.log.info(
      `DEEP_RESEARCH: report ready (${String(report.length)} chars, thread ${threadId})`
    );

    return { report, threadId };
  }
}
