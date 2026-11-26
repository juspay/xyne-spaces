import { z } from 'zod/v3';
import { BaseAgentProvider } from '@xyne/workflow-sdk/agents/host';
import type {
  AgentDispatchRecord,
  AgentRunInput,
  AgentRunResult,
  AsyncAgentCapability,
} from '@xyne/workflow-sdk/agents/host';
import { withOptions, type ResumePayload, type StepExecutionContext } from '@xyne/workflow-sdk';
import { collectClawResult, jsonAtEnd } from './claw-provider';
import { dispatchSdlcAgent } from './sdlc-dispatch';

export const SDLC_AGENT_STEP_TYPE = 'SDLC_AGENT';

/** Key order is form order: the builder renders properties as they are declared. */
export const SdlcAgentConfigSchema = z.object({
  channelId: withOptions(z.string().min(1)).describe('SDLC hub the agent works in'),
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
    const result = await collectClawResult(payload, record, stepConfig, ctx);
    const blocked = blockedReason(result.text);
    // A completed step counts its commit window as documented, so a blocked one must fail instead.
    if (blocked) throw new Error(`[workflows] SDLC agent could not finish: ${blocked}`);
    return result;
  }
}

function blockedReason(text: string): string | undefined {
  try {
    const parsed = JSON.parse(jsonAtEnd(text) ?? text) as { blocked?: unknown };
    return typeof parsed.blocked === 'string' && parsed.blocked.trim() ? parsed.blocked.trim() : undefined;
  } catch {
    return undefined;
  }
}
