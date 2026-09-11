import { z } from 'zod';
import { SDLC_AGENT_SLUG, SDLC_REPO_KNOWLEDGE_FOLDER } from '@xyne/shared';
import { BaseAgentProvider } from '@xyne/workflow-sdk/agents/host';
import type {
  AgentDispatchRecord,
  AgentRunInput,
  AgentRunResult,
  AsyncAgentCapability,
} from '@xyne/workflow-sdk/agents/host';
import type { ResumePayload, StepExecutionContext } from '@xyne/workflow-sdk';
import { config } from '@/config/env';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { runS2SClawAgent } from '@/services/clawAgentService';
import { sdlcAgentContext } from '@/sdlc/SdlcAgentContextService';
import { buildCallbackUrl, buildTask, collectClawResult } from './claw-provider';
import type { XyneResourceAttrs } from '../types';

/**
 * Runs one SDLC artifact through the SDLC agent — {@link ClawAgentProvider}'s
 * transport, plus the `executionProfile: 'sdlc'` + agent slug + s2s key trio claw
 * requires before it grants the SDLC tool palette.
 *
 * The agent is pinned in code: `HostAgentStep` surfaces every provider config field
 * in the builder, so an editable `agentSlug` would silently drop that grant.
 */

/** Not `attributes.createdByUserId` — the router consumes that at create and never persists it. */
export const SDLC_AUTHOR_METADATA_KEY = 'sdlcAuthorUserId';

/**
 * Claw rejects ids outside `[A-Za-z0-9_-]` (`apps/xyne-claw/src/safe-id.ts`): they
 * become directory names and URL segments. Step ids reach here as the admin typed them.
 */
function safeClawId(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 128);
}

function readAuthorUserId(metadata: Record<string, unknown>): string | undefined {
  const value = metadata[SDLC_AUTHOR_METADATA_KEY];
  return typeof value === 'string' && value ? value : undefined;
}

const SectionSchema = z.object({
  title: z.string().min(1),
  instructions: z.string().min(1),
});

/**
 * Artifact types this step can write, each mapped to the canvas folder it lands in.
 * One for now. Adding a type is an entry here — the folder is resolved per hub at
 * dispatch, so nothing else has to know about it.
 */
const ARTIFACT_TYPE_FOLDERS = {
  'Repo Knowledge': SDLC_REPO_KNOWLEDGE_FOLDER,
} as const;

export type SdlcArtifactType = keyof typeof ARTIFACT_TYPE_FOLDERS;

/** Tuple, not Object.keys: z.enum needs the literals to type the field. */
const ARTIFACT_TYPES = ['Repo Knowledge'] as const satisfies readonly SdlcArtifactType[];

/** Key order is form order: the builder renders properties as they are declared. */
export const SdlcArtifactConfigSchema = z.object({
  channelId: z.string().min(1)
    .describe('SDLC hub this artifact belongs to'),
  repoIds: z.array(z.string().min(1)).max(50).default([])
    .describe('Repositories this document covers. Empty means every repository in the hub.'),
  artifactType: z.enum(ARTIFACT_TYPES).default('Repo Knowledge')
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

  async dispatch(
    stepConfig: SdlcArtifactConfig,
    input: AgentRunInput,
    ctx: StepExecutionContext,
  ): Promise<{ externalRef: string }> {
    const attrs = ctx.runtime.attributes as XyneResourceAttrs;
    const actorUserId = readAuthorUserId(ctx.runtime.metadata) ?? attrs.createdByUserId;
    if (!actorUserId) {
      throw new Error(
        '[workflows] SDLC artifact step needs the workflow author to act as, but the '
        + `workflow carries no "${SDLC_AUTHOR_METADATA_KEY}". Re-seed the hub or run the `
        + 'SDLC workflow reset endpoint.',
      );
    }
    const user = await db.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, name: true, email: true },
    });
    if (!user?.email) {
      throw new Error(`[workflows] workflow author ${actorUserId} is unavailable`);
    }

    const folderId = await resolveArtifactFolderId(
      stepConfig.channelId,
      stepConfig.artifactType,
    );

    // Per attempt, so a repair re-run is its own run in claw's history.
    const attempt = input.repair?.attempt ?? 0;
    const sessionId = safeClawId(
      `wf-${ctx.runtime.executionId}-${ctx.runtime.stepName}`
      + (attempt > 0 ? `-retry-${String(attempt)}` : ''),
    );

    const agentContext = await sdlcAgentContext.buildForHub(
      { userId: user.id, workspaceId: attrs.workspaceId },
      stepConfig.channelId,
      {
        operation: 'baseline',
        workflowExecutionId: ctx.runtime.executionId,
        sessionId,
        // Must equal sessionId: the grant is bound to it and the sandbox reads it back.
        conversationId: sessionId,
      },
    );

    logger.info(
      `[workflows] dispatching SDLC artifact — execution=${ctx.runtime.executionId} `
      + `node=${ctx.runtime.stepName} channel=${stepConfig.channelId} `
      + `type="${stepConfig.artifactType}" title="${stepConfig.artifactTitle}" `
      + `session=${sessionId}`,
    );

    const response = await runS2SClawAgent({
      sessionId,
      agentSlug: SDLC_AGENT_SLUG,
      task: buildTask({ ...input, task: buildArtifactTask(stepConfig, folderId, input.task) }),
      workspaceId: attrs.workspaceId,
      userId: user.id,
      userName: user.name || user.email,
      userEmail: user.email,
      channelId: stepConfig.channelId,
      conversationId: sessionId,
      callbackUrl: buildCallbackUrl(ctx.runtime.executionId, ctx.runtime.stepName, attempt),
      callbackSecret: config.xyneClaw.s2sKey,
      executionProfile: 'sdlc',
      sdlcOperation: 'baseline',
      sdlcContext: agentContext as unknown as Record<string, unknown>,
      allowWriteInReadOnlyJob: true,
    });

    if (!response.success) {
      throw new Error(
        `[workflows] claw rejected the SDLC artifact run: ${response.error ?? 'unknown error'}`,
      );
    }
    return { externalRef: sessionId };
  }

  async collect(
    payload: ResumePayload,
    record: AgentDispatchRecord,
    _stepConfig: SdlcArtifactConfig,
    ctx: StepExecutionContext,
  ): Promise<AgentRunResult> {
    return collectClawResult(payload, record, ctx);
  }
}

/**
 * An artifact type names a canvas folder; each hub has its own row for it. Resolved
 * here rather than stored in the step so a workflow survives the folder being
 * recreated, and so the builder never asks an admin for a raw id.
 */
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

/**
 * Idempotency is prompt-driven by design: the agent already has list/read/mutate, and
 * title-within-folder is the only thing telling two generic artifacts apart.
 */
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
    `Artifact type (folderId): ${folderId}`,
    cfg.repoIds.length > 0
      ? `Cover only these repositories: ${cfg.repoIds.join(', ')}`
      : 'Cover every repository in this hub. List them with spaces-sdlc-list-repositories first.',
    // spaces-sdlc-list-tracks tells the agent to create a track when none fits, and
    // mutate-artifact's exemption is a trailing parenthetical. Say it plainly here.
    'This artifact type belongs to no track: it describes the hub itself. Pass no '
    + 'trackId, and do not call spaces-sdlc-list-tracks or spaces-sdlc-create-track.',
  ];

  if (cfg.sections?.length) {
    parts.push('', 'Use exactly these sections, in this order:');
    for (const section of cfg.sections) {
      parts.push(`- ${section.title}: ${section.instructions}`);
    }
  }

  parts.push(
    '',
    'Before writing, call spaces-sdlc-list-artifacts for this hub and look for an existing '
    + `artifact titled "${cfg.artifactTitle}" in this artifact type. If one exists, update it `
    + 'with spaces-sdlc-mutate-artifact action "update" using its canvasId. Only if none '
    + 'exists, create it with action "create". Never create a second copy.',
  );

  return parts.join('\n');
}

export const sdlcArtifactAgentProvider = new SdlcArtifactAgentProvider();
