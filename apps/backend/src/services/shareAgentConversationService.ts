import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { MessageType, ChannelRole, ChannelAddUserPolicy, ChannelScopeType } from '@xyne/shared';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import {
  agentSlugFromWebhookUrl,
  getConversationTranscript,
  listS2SClawAgents,
} from './clawAgentService';
import { messageMetadataService } from './messageMetadataService';
import { ChannelParticipantRepository } from '@/database/repositories/channelParticipantRepository';
import { websocketService } from '@/services/websocketService';
import { redisService } from '@/services/redisService';
import { handleUnreadCount } from '@/zero/utils/unreadCountUtlis';
import { CacConfigService } from '@/services/cacConfigService';
import { vespaQueue } from '@/queues/vespaQueue';
import { messageSchema } from '@/vespa/src/types';
import { NAMESPACE } from '@/vespa/vespaConfig';

const channelParticipantRepository = new ChannelParticipantRepository();

export const MAX_SHARED_TRANSCRIPT_CHARS = 60_000;

async function isAgentConversationSharingEnabled(workspaceId: string): Promise<boolean> {
  const enabled = await CacConfigService.fetch('share_agent_conversation_enabled', { workspaceId });
  return enabled !== false;
}

async function assertSharingEnabled(workspaceId: string): Promise<void> {
  if (await isAgentConversationSharingEnabled(workspaceId)) return;
  throw new ShareAgentConversationError(
    'SHARING_DISABLED',
    'Sharing agent conversations is turned off for this workspace'
  );
}

export type ShareErrorCode =
  | 'CHANNEL_NOT_FOUND'
  | 'NOT_A_CHANNEL_MEMBER'
  | 'INVALID_TARGET_CHANNEL'
  | 'CHANNEL_ARCHIVED'
  | 'RESHARE_CONFIRMATION_REQUIRED'
  | 'EMPTY_TRANSCRIPT'
  | 'TRANSCRIPT_TOO_LARGE'
  | 'NO_NEW_MESSAGES'
  | 'ADD_AGENT_FORBIDDEN'
  | 'AGENT_NOT_INSTALLED'
  | 'SHARING_DISABLED';

export class ShareAgentConversationError extends Error {
  constructor(
    public code: ShareErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ShareAgentConversationError';
  }
}

interface ClawChatMessageLike {
  id: string;
  role: string;
  content?: string | null;
  reasoning?: string | null;
}

type SharedCitationInvocation = Prisma.InputJsonObject & {
  toolCallId: string;
  citations: Prisma.InputJsonObject[];
};

const MAX_SHARED_TRANSCRIPT_CITATIONS = 200;

function buildSharedTranscriptCitationMetadata(
  messages: ClawChatMessageLike[],
  invocationsByMsgId: Record<string, unknown[]> | undefined,
  icons: Record<string, string> | undefined
): {
  clawCitations: SharedCitationInvocation[];
  clawCitationIcons?: Record<string, string>;
} | null {
  if (!invocationsByMsgId) return null;
  const byToolCallId = new Map<string, SharedCitationInvocation>();
  let totalCitations = 0;
  for (const message of messages) {
    if (typeof message.content !== 'string' || !message.content.includes('clf-')) continue;
    const citedIds = new Set<string>();
    const tokenPattern = /\[clf-([^\][#]+)#\d+\]/g;
    let match: RegExpExecArray | null;
    while ((match = tokenPattern.exec(message.content)) !== null) {
      if (match[1]) citedIds.add(match[1]);
    }
    for (const invocation of invocationsByMsgId[message.id] ?? []) {
      if (!invocation || typeof invocation !== 'object') continue;
      const record = invocation as Record<string, unknown>;
      const toolCallId = typeof record['toolCallId'] === 'string' ? record['toolCallId'] : null;
      const citations = Array.isArray(record['citations']) ? record['citations'] : [];
      if (!toolCallId || !citedIds.has(toolCallId) || citations.length === 0) continue;
      if (byToolCallId.has(toolCallId)) continue;
      if (totalCitations > 0 && totalCitations + citations.length > MAX_SHARED_TRANSCRIPT_CITATIONS)
        continue;
      const jsonCitations = citations.filter(
        (citation): citation is Prisma.InputJsonObject =>
          citation !== null && typeof citation === 'object' && !Array.isArray(citation)
      );
      if (jsonCitations.length === 0) continue;
      byToolCallId.set(toolCallId, { toolCallId, citations: jsonCitations });
      totalCitations += jsonCitations.length;
    }
  }
  const clawCitations = [...byToolCallId.values()];
  if (clawCitations.length === 0) return null;
  const usedIconKeys = new Set<string>();
  for (const invocation of clawCitations) {
    for (const citation of invocation.citations) {
      const iconKey = citation['iconKey'];
      if (typeof iconKey === 'string') usedIconKeys.add(iconKey);
    }
  }
  const clawCitationIcons = Object.fromEntries(
    [...usedIconKeys]
      .filter((key) => typeof icons?.[key] === 'string')
      .map((key) => [key, icons![key]!])
  );
  return { clawCitations, ...(Object.keys(clawCitationIcons).length ? { clawCitationIcons } : {}) };
}

function destinationNoun(scopeType: string): string {
  return scopeType === ChannelScopeType.GROUP_DM ? 'group DM' : 'channel';
}

function assertShareableTarget(channel: { scopeType: string; isArchived: boolean }): void {
  if (channel.scopeType === ChannelScopeType.DM) {
    throw new ShareAgentConversationError(
      'INVALID_TARGET_CHANNEL',
      'Agent conversations cannot be shared to a direct message'
    );
  }
  if (
    channel.scopeType !== ChannelScopeType.DEFAULT &&
    channel.scopeType !== ChannelScopeType.GROUP_DM
  ) {
    throw new ShareAgentConversationError(
      'INVALID_TARGET_CHANNEL',
      'Agent conversations can only be shared to channels or group DMs'
    );
  }
  if (channel.isArchived) {
    throw new ShareAgentConversationError(
      'CHANNEL_ARCHIVED',
      `Agent conversations cannot be shared to an archived ${destinationNoun(channel.scopeType)}`
    );
  }
}

function mayAddAgent(
  scopeType: string,
  policy: ChannelAddUserPolicy,
  actorRole: string | null
): boolean {
  if (scopeType === ChannelScopeType.GROUP_DM) return true;
  return policy === ChannelAddUserPolicy.EVERYONE || actorRole === ChannelRole.ADMIN;
}

function sharerLabel(
  user: { name?: string | null; displayName?: string | null; email?: string | null } | null
): string {
  return user?.displayName || user?.name || user?.email || 'User';
}

function convertTranscriptToMarkdown(
  data: ClawChatMessageLike[],
  agentName: string,
  userName = 'User'
): { markdown: string; tipMessageId: string | null; visibleCount: number } {
  const visible = data.filter((m) => typeof m.content === 'string' && m.content.trim().length > 0);

  const parts = visible.map((m) => {
    const label = m.role === 'user' ? userName : m.role === 'assistant' ? agentName : m.role;
    return `**${label}**\n\n${(m.content as string).trim()}`;
  });

  const markdown = parts.join('\n\n---\n\n');
  const tipMessageId = visible.length ? visible[visible.length - 1]!.id : null;
  return { markdown, tipMessageId, visibleCount: visible.length };
}


async function resolveClawAgentAppUser(
  agentSlug: string,
  workspaceId: string
): Promise<{ userId: string; name: string } | null> {
  const registeredAgent = (await listS2SClawAgents()).find((agent) => agent.slug === agentSlug);
  if (registeredAgent?.spacesAppUserId) {
    const installation = await db.installedApps.findFirst({
      where: { workspaceId, userId: registeredAgent.spacesAppUserId },
      select: { userId: true },
    });
    if (installation) {
      const user = await db.user.findUnique({
        where: { id: installation.userId },
        select: { id: true, name: true },
      });
      if (user) return { userId: user.id, name: user.name };
    }
  }
  const apps = await db.installedApps.findMany({
    where: { workspaceId, webhookUrl: { contains: '/webhook/' } },
    select: { userId: true, webhookUrl: true },
  });
  const match = apps.find((app) => agentSlugFromWebhookUrl(app.webhookUrl) === agentSlug);
  if (!match) return null;
  const user = await db.user.findUnique({
    where: { id: match.userId },
    select: { id: true, name: true },
  });
  return user ? { userId: user.id, name: user.name } : null;
}

interface StoredShareResult {
  targetConversationId: string;
  targetMessageId: string;
  sharedMessageCount: number;
  agentAdded: boolean;
  sourceTipMessageId: string;
  createdAt: Date;
}

function toShareResult(row: StoredShareResult, reusedExisting: boolean): ShareResult {
  return {
    conversationId: row.targetConversationId,
    messageId: row.targetMessageId,
    sharedMessageCount: row.sharedMessageCount,
    agentAdded: row.agentAdded,
    reusedExisting,
  };
}

export interface PreShareStatusInput {
  agentSlug: string;
  sourceConversationId: string;
  targetChannelId: string;
  activePathTipMessageId: string | null;
  userId: string;
  workspaceId: string;
}

export interface PreShareStatus {
  previouslyShared: boolean;
  lastSharedAt: string | null;
  hasNewSinceLastShare: boolean;
  agentInChannel: boolean;
  canAddAgent: boolean;
  agentInstalled: boolean;
  channelVisibility: string;

  channelScopeType: string;
}

export interface AgentConversationPreviewTurn {
  role: string;

  name: string;

  userId: string | null;
  content: string;
}

export interface AgentConversationPreview {
  messageCount: number;
  turns: AgentConversationPreviewTurn[];
  previewTruncated: boolean;

  tipMessageId: string | null;
}

const MAX_SHARE_PREVIEW_TURNS = 8;

const MAX_SHARE_PREVIEW_CHARS = 1_200;

const MAX_SHARE_NOTE_CHARS = 2_000;

export async function getPreShareStatus(input: PreShareStatusInput): Promise<PreShareStatus> {
  const {
    agentSlug,
    sourceConversationId,
    targetChannelId,
    activePathTipMessageId,
    userId,
    workspaceId,
  } = input;

  await assertSharingEnabled(workspaceId);

  const channel = await db.channel.findUnique({
    where: { id: targetChannelId },
    select: {
      id: true,
      workspaceId: true,
      visibility: true,
      addUserPolicy: true,
      scopeType: true,
      isArchived: true,
    },
  });
  if (!channel || channel.workspaceId !== workspaceId) {
    throw new ShareAgentConversationError(
      'CHANNEL_NOT_FOUND',
      'Channel not found in this workspace'
    );
  }

  const actor = await db.channelParticipant.findFirst({
    where: { channelId: targetChannelId, userId },
    select: { role: true },
  });
  if (!actor) {
    throw new ShareAgentConversationError(
      'NOT_A_CHANNEL_MEMBER',
      `You must be a member of the target ${destinationNoun(channel.scopeType)} to view share status`
    );
  }

  assertShareableTarget(channel);

  const agentAppUser = await resolveClawAgentAppUser(agentSlug, workspaceId);
  const agentInstalled = !!agentAppUser;

  let agentInChannel = false;
  if (agentAppUser) {
    const agentParticipant = await db.channelParticipant.findFirst({
      where: { channelId: targetChannelId, userId: agentAppUser.userId },
      select: { userId: true },
    });
    agentInChannel = !!agentParticipant;
  }

  const policy = (channel.addUserPolicy as ChannelAddUserPolicy) ?? ChannelAddUserPolicy.EVERYONE;
  const actorMayAdd = !!actor && mayAddAgent(channel.scopeType, policy, actor.role);
  const canAddAgent = actorMayAdd && agentInstalled && !agentInChannel;

  const last = await db.agentConversationShare.findFirst({
    where: { workspaceId, sourceConversationId, targetChannelId },
    orderBy: { createdAt: 'desc' },
    select: { sourceTipMessageId: true, createdAt: true },
  });
  const previouslyShared = !!last;

  let authoritativeTipMessageId = activePathTipMessageId;
  if (last && !authoritativeTipMessageId) {
    authoritativeTipMessageId = (
      await renderSourceTranscript({ agentSlug, sourceConversationId, userId, workspaceId })
    ).tipMessageId;
  }
  const hasNewSinceLastShare = last ? last.sourceTipMessageId !== authoritativeTipMessageId : true;

  return {
    previouslyShared,
    lastSharedAt: last?.createdAt.toISOString() ?? null,
    hasNewSinceLastShare,
    agentInChannel,
    canAddAgent,
    agentInstalled,
    channelVisibility: channel.visibility,
    channelScopeType: channel.scopeType,
  };
}

interface RenderSourceInput {
  agentSlug: string;
  sourceConversationId: string;
  userId: string;
  workspaceId: string;
}

async function renderSourceTranscript(input: RenderSourceInput): Promise<{
  markdown: string;
  tipMessageId: string | null;
  visibleCount: number;
  turns: AgentConversationPreviewTurn[];
}> {
  const { agentSlug, sourceConversationId, userId, workspaceId } = input;
  const payload = await getConversationTranscript({
    agentSlug,
    conversationId: sourceConversationId,
    userId,
    spacesWorkspaceId: workspaceId,
  });
  const data = (Array.isArray(payload.data) ? payload.data : []) as ClawChatMessageLike[];
  const [agentAppUser, sharer] = await Promise.all([
    resolveClawAgentAppUser(agentSlug, workspaceId),
    db.user.findUnique({
      where: { id: userId },
      select: { name: true, displayName: true, email: true },
    }),
  ]);
  const agentName = agentAppUser?.name ?? agentSlug;
  const userName = sharerLabel(sharer);
  const turns = data
    .filter((m) => typeof m.content === 'string' && m.content.trim().length > 0)
    .map((m) => ({
      role: m.role,
      name: m.role === 'user' ? userName : m.role === 'assistant' ? agentName : m.role,
      userId:
        m.role === 'user' ? userId : m.role === 'assistant' ? (agentAppUser?.userId ?? null) : null,
      content: (m.content as string).trim(),
    }));
  return { ...convertTranscriptToMarkdown(data, agentName, userName), turns };
}

export async function getAgentConversationPreview(
  input: RenderSourceInput
): Promise<AgentConversationPreview> {
  await assertSharingEnabled(input.workspaceId);
  const { turns: allTurns, tipMessageId } = await renderSourceTranscript(input);

  let budget = MAX_SHARE_PREVIEW_CHARS;
  let bodyTruncated = false;
  const turns: AgentConversationPreviewTurn[] = [];
  for (const turn of allTurns.slice(0, MAX_SHARE_PREVIEW_TURNS)) {
    if (budget <= 0) break;
    if (turn.content.length > budget) bodyTruncated = true;
    turns.push({ ...turn, content: turn.content.slice(0, budget) });
    budget -= turn.content.length;
  }

  return {
    messageCount: allTurns.length,
    turns,
    previewTruncated: bodyTruncated || turns.length < allTurns.length,
    tipMessageId,
  };
}

export interface ShareInput {
  agentSlug: string;
  sourceConversationId: string;
  targetChannelId: string;
  userId: string;
  workspaceId: string;

  addAgentConfirmed?: boolean;

  reShareConfirmed?: boolean;

  shareOperationId?: string;

  note?: string;
}

export interface ShareResult {
  conversationId: string;
  messageId: string;
  sharedMessageCount: number;
  agentAdded: boolean;
  reusedExisting: boolean;
}

function sanitizeShareLogValue(value: string): string {
  return Array.from(value)
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f ||
        (codePoint >= 0x7f && codePoint <= 0x9f) ||
        codePoint === 0x2028 ||
        codePoint === 0x2029
        ? ' '
        : character;
    })
    .join('')
    .slice(0, 1_000);
}

export async function shareAgentConversationToChannel(input: ShareInput): Promise<ShareResult> {
  const {
    agentSlug,
    sourceConversationId,
    targetChannelId,
    userId,
    workspaceId,
    addAgentConfirmed = false,
    reShareConfirmed = false,
  } = input;
  const shareOperationId = input.shareOperationId ?? randomUUID();
  await assertSharingEnabled(workspaceId);
  const trimmedNote = (input.note ?? '').trim().slice(0, MAX_SHARE_NOTE_CHARS);

  const channel = await db.channel.findUnique({
    where: { id: targetChannelId },
    select: {
      id: true,
      workspaceId: true,
      addUserPolicy: true,
      scopeType: true,
      isArchived: true,
    },
  });
  if (!channel || channel.workspaceId !== workspaceId) {
    throw new ShareAgentConversationError(
      'CHANNEL_NOT_FOUND',
      'Channel not found in this workspace'
    );
  }
  const actor = await db.channelParticipant.findFirst({
    where: { channelId: targetChannelId, userId },
    select: { role: true },
  });
  if (!actor) {
    throw new ShareAgentConversationError(
      'NOT_A_CHANNEL_MEMBER',
      `You must be a member of the target ${destinationNoun(channel.scopeType)} to share into it`
    );
  }
  assertShareableTarget(channel);

  const priorOperation = await db.agentConversationShare.findUnique({
    where: {
      workspaceId_targetChannelId_sharedBy_shareOperationId: {
        workspaceId,
        targetChannelId,
        sharedBy: userId,
        shareOperationId,
      },
    },
  });
  if (priorOperation) return toShareResult(priorOperation, true);

  const payload = await getConversationTranscript({
    agentSlug,
    conversationId: sourceConversationId,
    userId,
    spacesWorkspaceId: workspaceId,
  });
  const data = (Array.isArray(payload.data) ? payload.data : []) as ClawChatMessageLike[];

  const agentAppUser = await resolveClawAgentAppUser(agentSlug, workspaceId);
  const agentName = agentAppUser?.name ?? agentSlug;
  const sharer = await db.user.findUnique({
    where: { id: userId },
    select: { name: true, displayName: true, email: true },
  });
  const { markdown, tipMessageId, visibleCount } = convertTranscriptToMarkdown(
    data,
    agentName,
    sharerLabel(sharer)
  );
  const citationMetadata = buildSharedTranscriptCitationMetadata(
    data,
    payload.invocationsByMsgId,
    payload.icons
  );
  if (visibleCount === 0 || !tipMessageId) {
    throw new ShareAgentConversationError(
      'EMPTY_TRANSCRIPT',
      'This conversation has no visible messages to share'
    );
  }
  if (markdown.length > MAX_SHARED_TRANSCRIPT_CHARS) {
    throw new ShareAgentConversationError(
      'TRANSCRIPT_TOO_LARGE',
      `This conversation is too large to share. The maximum is ${MAX_SHARED_TRANSCRIPT_CHARS.toLocaleString()} characters.`
    );
  }

  const policy = (channel.addUserPolicy as ChannelAddUserPolicy) ?? ChannelAddUserPolicy.EVERYONE;
  if (addAgentConfirmed && !agentAppUser) {
    throw new ShareAgentConversationError(
      'AGENT_NOT_INSTALLED',
      `This agent is not installed as a Spaces App and cannot be added to the ${destinationNoun(channel.scopeType)}`
    );
  }
  if (addAgentConfirmed && !mayAddAgent(channel.scopeType, policy, actor.role)) {
    throw new ShareAgentConversationError(
      'ADD_AGENT_FORBIDDEN',
      `You do not have permission to add members to this ${destinationNoun(channel.scopeType)}`
    );
  }

  // Resolved before the transaction: it is a per-channel scan that would otherwise
  // run inside the advisory-locked transaction and eat its budget.
  const agentSeenCutoffAt =
    addAgentConfirmed && agentAppUser
      ? await channelParticipantRepository.resolveSeenCutoff(targetChannelId)
      : null;

  const persisted = await db.$transaction(async (tx) => {
    const lockKey = `${workspaceId}:${sourceConversationId}:${targetChannelId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

    const operation = await tx.agentConversationShare.findUnique({
      where: {
        workspaceId_targetChannelId_sharedBy_shareOperationId: {
          workspaceId,
          targetChannelId,
          sharedBy: userId,
          shareOperationId,
        },
      },
    });
    if (operation)
      return { row: operation, reusedExisting: true, conversation: null, message: null };

    const latest = await tx.agentConversationShare.findFirst({
      where: { workspaceId, sourceConversationId, targetChannelId },
      orderBy: { createdAt: 'desc' },
      select: { sourceTipMessageId: true },
    });
    if (latest?.sourceTipMessageId === tipMessageId) {
      throw new ShareAgentConversationError(
        'NO_NEW_MESSAGES',
        'Nothing new has been added to this conversation since it was last shared'
      );
    }
    if (latest && !reShareConfirmed) {
      throw new ShareAgentConversationError(
        'RESHARE_CONFIRMATION_REQUIRED',
        `Confirm that sharing again creates a new, separate thread in the ${destinationNoun(channel.scopeType)}`
      );
    }

    let agentAdded = false;
    if (addAgentConfirmed && agentAppUser) {
      ({ added: agentAdded } = await channelParticipantRepository.addParticipantInTransaction(
        tx,
        targetChannelId,
        agentAppUser.userId,
        agentSeenCutoffAt,
        ChannelRole.MEMBER
      ));
    }

    const now = new Date();

    const displayMetadata: Prisma.InputJsonObject = {
      sharedAgentTranscript: true,
      contentFormat: 'markdown',
      agentSlug,
      agentName,
      messageCount: visibleCount,
      ...(trimmedNote ? { shareNote: trimmedNote } : {}),
      ...(citationMetadata ?? {}),
    };

    const conversation = await tx.conversation.create({
      data: {
        channelId: targetChannelId,
        createdBy: userId,
        initialMessageId: 'temp',
        workspaceId,
        lastActivityAt: now,
        replyCount: 0,
        pinned: false,
      },
    });
    const message = await tx.message.create({
      data: {
        conversationId: conversation.conversationId,
        senderId: userId,
        workspaceId,
        content: markdown,
        msgType: MessageType.USER,
        hasAttachment: false,
        metadata: displayMetadata,
      },
    });
    await tx.conversation.update({
      where: { conversationId: conversation.conversationId },
      data: { initialMessageId: message.messageId },
    });
    await tx.channelStats.upsert({
      where: { channelId: targetChannelId },
      update: { lastActivityAt: now },
      create: { channelId: targetChannelId, lastActivityAt: now, workspaceId },
    });

    const row = await tx.agentConversationShare.create({
      data: {
        workspaceId,
        sourceConversationId,
        sourceTipMessageId: tipMessageId,
        agentSlug,
        targetChannelId,
        targetConversationId: conversation.conversationId,
        targetMessageId: message.messageId,
        sharedBy: userId,
        shareOperationId,
        sharedMessageCount: visibleCount,
          agentAdded,
      },
    });
    return { row, reusedExisting: false, conversation, message };
  });

  if (persisted.reusedExisting || !persisted.conversation || !persisted.message) {
    return toShareResult(persisted.row, true);
  }

  await messageMetadataService.syncInitialMessageMd(persisted.conversation.conversationId);
  await deliverSharedConversation({
    channelId: targetChannelId,
    conversationId: persisted.conversation.conversationId,
    message: persisted.message,
    senderId: userId,
    workspaceId,
  });

  logger.info('[shareAgentConversation] shared conversation', {
    sourceConversationId: sanitizeShareLogValue(sourceConversationId),
    agentSlug: sanitizeShareLogValue(agentSlug),
    targetChannelId: sanitizeShareLogValue(targetChannelId),
    targetConversationId: sanitizeShareLogValue(persisted.conversation.conversationId),
    visibleCount,
    agentAdded: persisted.row.agentAdded,
  });

  return toShareResult(persisted.row, false);
}

async function deliverSharedConversation(args: {
  channelId: string;
  conversationId: string;
  message: {
    messageId: string;
    senderId: string;
    content: string;
    msgType: string;
    hasAttachment: boolean;
    createdAt: Date;
    metadata?: Prisma.JsonValue;
  };
  senderId: string;
  workspaceId: string;
}): Promise<void> {
  const { channelId, conversationId, message, senderId, workspaceId } = args;

  vespaQueue
    .addJob({
      schema: messageSchema,
      jobType: 'feed',
      docId: message.messageId,
      userId: senderId,
      ...(workspaceId ? { workspaceId } : {}),
    })
    .catch(async (error) => {
      logger.error('[shareAgentConversation] Error queuing Vespa job:', error);
      try {
        const vespaLogs = db.vespaInsertionLogs;
        if (vespaLogs) {
          await vespaLogs.create({
            data: {
              status: 'FAILED',
              type: 'INSERT',
              entityId: message.messageId,
              entityType: messageSchema,
              namespace: NAMESPACE,
              errorMessage: `Failed to enqueue Vespa job: ${
                error instanceof Error ? error.message : String(error)
              }`,
              errorDetails: JSON.stringify(error),
              userId: senderId,
              createdAt: new Date(),
              workspaceId,
            },
          });
        }
      } catch (dbError) {
        logger.error('[shareAgentConversation] Failed to log Vespa insertion error:', dbError);
      }
    });

  const sender = await db.user.findUnique({
    where: { id: senderId },
    select: { id: true, name: true, picture: true },
  });

  const conversationMessage = {
    conversationId,
    channelId,
    messageId: message.messageId,
    senderId: message.senderId,
    senderName: sender?.name ?? 'User',
    senderPicture: sender?.picture ?? undefined,
    content: message.content,
    msgType: message.msgType,
    hasAttachment: message.hasAttachment,
    attachments: [],
    createdAt: message.createdAt,
    metadata: message.metadata ?? undefined,
  };

  try {
    await websocketService.broadcastToSession(channelId, 'new_conversation', conversationMessage);
    await redisService.broadcastMessageToSession(
      channelId,
      conversationMessage as unknown as Parameters<typeof redisService.broadcastMessageToSession>[1]
    );
  } catch (error) {
    logger.error('[shareAgentConversation] Failed to broadcast shared conversation:', error);
  }

  try {
    const participants = await channelParticipantRepository.getChannelParticipants(channelId);
    await handleUnreadCount(
      channelId,
      false,
      participants.map((p) => ({ userId: p.userId })),
      senderId
    );
  } catch (error) {
    logger.error('[shareAgentConversation] Failed to update unread counts:', error);
  }
}
