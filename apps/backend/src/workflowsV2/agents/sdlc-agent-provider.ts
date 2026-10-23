import { z } from 'zod';
import { SDLC_AGENT_SLUG } from '@xyne/shared';
import { withOptions } from '@xyne/workflow-sdk';
import { BaseAgentProvider } from '@xyne/workflow-sdk/agents/host';
import type {
  AgentDescriptor,
  AgentDispatchRecord,
  AgentRunInput,
  AgentRunResult,
  AsyncAgentCapability,
} from '@xyne/workflow-sdk/agents/host';
import type { ResumePayload, StepExecutionContext } from '@xyne/workflow-sdk';
import { collectClawResult, listClawAgents } from './claw-provider';
import { dispatchSdlcAgent, workflowHubId } from './sdlc-dispatch';

export const SDLC_AGENT_STEP_TYPE = 'SDLC_AGENT';

/** Key order is form order: the builder renders properties as they are declared. */
export const SdlcAgentConfigSchema = z.object({
  agentSlug: withOptions(z.string().min(1)).default(SDLC_AGENT_SLUG)
    .describe("Agent to run. It gets the SDLC tools of this workflow's hub."),
  generationCommit: z.string().optional()
    .describe('Commit the Wiki pages this run writes describe. Leave empty when it writes none.'),
});

export type SdlcAgentConfig = z.infer<typeof SdlcAgentConfigSchema>;

export class SdlcAgentProvider
  extends BaseAgentProvider<typeof SdlcAgentConfigSchema, unknown>
  implements AsyncAgentCapability<typeof SdlcAgentConfigSchema>
{
  readonly name = 'SDLC Agent';
  readonly configSchema = SdlcAgentConfigSchema;

  override async listAgents(): Promise<AgentDescriptor[]> {
    return listClawAgents();
  }

  async dispatch(
    stepConfig: SdlcAgentConfig,
    input: AgentRunInput,
    ctx: StepExecutionContext,
  ): Promise<{ externalRef: string }> {
    return dispatchSdlcAgent({
      ctx,
      run: input,
      agentSlug: stepConfig.agentSlug,
      channelId: await workflowHubId(ctx),
      task: input.task,
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
