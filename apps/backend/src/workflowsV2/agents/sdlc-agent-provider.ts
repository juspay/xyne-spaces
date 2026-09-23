import { z } from 'zod';
import { BaseAgentProvider } from '@xyne/workflow-sdk/agents/host';
import type {
  AgentDispatchRecord,
  AgentRunInput,
  AgentRunResult,
  AsyncAgentCapability,
} from '@xyne/workflow-sdk/agents/host';
import type { ResumePayload, StepExecutionContext } from '@xyne/workflow-sdk';
import { collectClawResult } from './claw-provider';
import { dispatchSdlcAgent } from './sdlc-dispatch';

export const SDLC_AGENT_STEP_TYPE = 'SDLC_AGENT';

/** Key order is form order: the builder renders properties as they are declared. */
export const SdlcAgentConfigSchema = z.object({
  channelId: z.string().min(1).describe('SDLC hub the agent works in'),
  repoId: z
    .string()
    .min(1)
    .optional()
    .describe('Repository the run is pinned to. Leave empty for hub-wide work such as the Hub Wiki.'),
  generationCommit: z.string().optional().describe('Commit the pages this run writes describe'),
});

export type SdlcAgentConfig = z.infer<typeof SdlcAgentConfigSchema>;

export class SdlcAgentProvider
  extends BaseAgentProvider<typeof SdlcAgentConfigSchema, unknown>
  implements AsyncAgentCapability<typeof SdlcAgentConfigSchema>
{
  readonly name = 'SDLC Agent';
  readonly configSchema = SdlcAgentConfigSchema;

  async dispatch(
    stepConfig: SdlcAgentConfig,
    input: AgentRunInput,
    ctx: StepExecutionContext,
  ): Promise<{ externalRef: string }> {
    return dispatchSdlcAgent({
      ctx,
      run: input,
      channelId: stepConfig.channelId,
      task: input.task,
      ...(stepConfig.repoId ? { repoId: stepConfig.repoId } : {}),
      ...(stepConfig.generationCommit ? { generationCommit: stepConfig.generationCommit } : {}),
    });
  }

  async collect(
    payload: ResumePayload,
    record: AgentDispatchRecord,
    stepConfig: SdlcAgentConfig,
    ctx: StepExecutionContext,
  ): Promise<AgentRunResult> {
    return collectClawResult(payload, record, stepConfig, ctx);
  }
}
