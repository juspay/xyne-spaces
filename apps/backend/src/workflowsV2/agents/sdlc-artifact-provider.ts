import { z } from 'zod';
import { SDLC_AGENT_SLUG, SDLC_HUB_KNOWLEDGE_FOLDER } from '@xyne/shared';
import { withOptions } from '@xyne/workflow-sdk';
import { BaseAgentProvider, HostAgentStep } from '@xyne/workflow-sdk/agents/host';
import type {
  AgentDescriptor,
  AgentDispatchRecord,
  AgentRunInput,
  AgentRunResult,
  AsyncAgentCapability,
} from '@xyne/workflow-sdk/agents/host';
import type { FieldOptionsContext, FieldOptionsPage, ResumePayload, StepExecutionContext } from '@xyne/workflow-sdk';
import { db } from '@/database/client';
import { hubOptions } from '@/sdlc/workflowOptions';
import type { XyneCtx } from '../types';
import { collectClawResult, listClawAgents } from './claw-provider';
import { dispatchSdlcAgent } from './sdlc-dispatch';

const SectionSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
});

const ARTIFACT_TYPE_FOLDERS = {
  'Hub Knowledge': SDLC_HUB_KNOWLEDGE_FOLDER,
} as const;

type SdlcArtifactType = keyof typeof ARTIFACT_TYPE_FOLDERS;

/** Key order is form order: the builder renders properties as they are declared. */
export const SdlcArtifactConfigSchema = z.object({
  channelId: withOptions(z.string().min(1))
    .describe('SDLC hub this artifact belongs to'),
  agentSlug: withOptions(z.string().min(1)).default(SDLC_AGENT_SLUG)
    .describe("Agent that writes the document. It gets the hub's SDLC tools."),
  artifactType: z.enum(['Hub Knowledge']).default('Hub Knowledge')
    .describe('What kind of document this step writes'),
  artifactTitle: z.string().min(1).max(255)
    .describe('Document title. It is also the key used to find and update it on a re-run.'),
  sections: z.array(SectionSchema).optional()
    .describe('Section outline the document should follow'),
});

export type SdlcArtifactConfig = z.infer<typeof SdlcArtifactConfigSchema>;

export class SdlcArtifactAgentProvider
  extends BaseAgentProvider<typeof SdlcArtifactConfigSchema, unknown>
  implements AsyncAgentCapability<typeof SdlcArtifactConfigSchema>
{
  readonly name = 'SDLC Agent';
  readonly configSchema = SdlcArtifactConfigSchema;

  override async listAgents(): Promise<AgentDescriptor[]> {
    return listClawAgents();
  }

  async dispatch(
    stepConfig: SdlcArtifactConfig,
    input: AgentRunInput,
    ctx: StepExecutionContext,
  ): Promise<{ externalRef: string }> {
    const folderId = await resolveArtifactFolderId(stepConfig.channelId, stepConfig.artifactType);
    return dispatchSdlcAgent({
      ctx,
      run: input,
      agentSlug: stepConfig.agentSlug,
      channelId: stepConfig.channelId,
      task: buildArtifactTask(stepConfig, folderId, input.task),
    });
  }

  async collect(
    payload: ResumePayload,
    record: AgentDispatchRecord,
    stepConfig: SdlcArtifactConfig,
    ctx: StepExecutionContext,
  ): Promise<AgentRunResult> {
    return collectClawResult(payload, record, stepConfig, ctx);
  }
}

async function resolveArtifactFolderId(
  channelId: string,
  artifactType: SdlcArtifactType,
): Promise<string> {
  const name = ARTIFACT_TYPE_FOLDERS[artifactType];
  const folder = await db.canvasFolder.findFirst({
    where: { channelId, name },
    select: { id: true },
  });
  if (!folder) {
    throw new Error(
      `[workflows] SDLC hub ${channelId} has no "${name}" folder to write ${artifactType} into`,
    );
  }
  return folder.id;
}

function buildArtifactTask(
  cfg: SdlcArtifactConfig,
  folderId: string,
  task: string,
): string {
  const parts = [
    task,
    '',
    '---',
    '',
    `Write the ${cfg.artifactType} document titled "${cfg.artifactTitle}".`,
    `Hub (channelId): ${cfg.channelId}`,
    `Artifact type (artifactTypeId): ${folderId}`,
    'It describes the hub itself: pass no trackId and no repoIds, and do not call '
    + 'spaces-sdlc-list-tracks or spaces-sdlc-create-track.',
  ];

  if (cfg.sections?.length) {
    parts.push('', 'Use exactly these sections, in this order:');
    for (const section of cfg.sections) {
      parts.push(`- ${section.title}${section.description ? `: ${section.description}` : ''}`);
    }
  }

  parts.push(
    '',
    'Before writing, call spaces-sdlc-list-artifacts for this hub and look for an existing '
    + `artifact titled "${cfg.artifactTitle}" in this artifact type. If one exists, update it `
    + 'with spaces-sdlc-write-artifact action "update" using its canvasId. Only if none '
    + 'exists, create it with action "create". Never create a second copy.',
  );

  return parts.join('\n');
}

export const sdlcArtifactAgentProvider = new SdlcArtifactAgentProvider();

/** HostAgentStep answers every picker with agents, whatever the field; the hub picker is answered here. */
export class SdlcArtifactStep extends HostAgentStep<typeof SdlcArtifactConfigSchema> {
  override async getOptions(ctx: FieldOptionsContext<Record<string, unknown>>): Promise<FieldOptionsPage> {
    if (ctx.field === 'channelId') return hubOptions(ctx.caller as XyneCtx, ctx);
    return super.getOptions(ctx);
  }
}
