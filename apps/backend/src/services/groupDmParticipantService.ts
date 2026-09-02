import {
  ChannelRole,
  ChannelScopeType,
  ChannelVisibility,
  MAX_DM_PARTICIPANTS,
  historyScopeToCutoff,
  type HistoryPreviewEntry,
  type HistoryScope,
} from '@xyne/shared';
import { ChannelRepository, CreateChannelInput } from '@/database/repositories/channelRepository';
import { ChannelParticipantRepository } from '@/database/repositories/channelParticipantRepository';
import { ConversationRepository } from '@/database/repositories/conversationRepository';
import { UserRepository } from '@/database/repositories/users';
import type { User } from '@prisma/client';
import { ProjectRepository } from '@/database/repositories/projectRepository';
import { AppError } from '@/middleware/errorHandler';
import { logger } from '@/utils/logger';

export interface AddGroupDmParticipantsParams {
  channelId: string;
  currentUserId: string;
  workspaceId: string;
  userIds: string[];
  historyScope: HistoryScope;
}

export interface AddedParticipant {
  userId: string;
  userName: string;
  participantId: string;
}

export interface AddGroupDmParticipantsResult {
  channelId: string;
  sourceChannelId: string;
  isExisting: boolean;
  participantsAdded: number;
  addedParticipants: AddedParticipant[];
  conversationsMoved: number;
  movedEverything: boolean;
  destinationMembers: Array<{ userId: string; userName: string }>;
  message: string;
}

export class GroupDmParticipantService {
  private channelRepository: ChannelRepository;
  private channelParticipantRepository: ChannelParticipantRepository;
  private conversationRepository: ConversationRepository;
  private userRepository: UserRepository;
  private projectRepository: ProjectRepository;

  constructor() {
    this.channelRepository = new ChannelRepository();
    this.channelParticipantRepository = new ChannelParticipantRepository();
    this.conversationRepository = new ConversationRepository();
    this.userRepository = new UserRepository();
    this.projectRepository = new ProjectRepository();
  }

  async addParticipants(
    params: AddGroupDmParticipantsParams,
  ): Promise<AddGroupDmParticipantsResult> {
    const { channelId, currentUserId, workspaceId, userIds, historyScope } = params;
    const dmProjectId = await this.projectRepository.getDMProjectId(workspaceId);
    if (!dmProjectId) {
      throw new AppError('DM project not found for workspace', 500);
    }

    const requestedUserIds = [...new Set(userIds)].filter(id => id !== currentUserId);
    if (requestedUserIds.length === 0) {
      throw new AppError('No valid participants provided', 400);
    }

    const channel = await this.channelRepository.findById(channelId);
    if (!channel) {
      throw new AppError('Channel not found', 404);
    }

    if (
      channel.scopeType !== ChannelScopeType.GROUP_DM &&
      channel.scopeType !== ChannelScopeType.DM
    ) {
      throw new AppError('This endpoint is only for DM and GROUP_DM channels', 400);
    }

    const currentParticipants =
      await this.channelParticipantRepository.getChannelParticipants(channelId);

    if (!currentParticipants.some(p => p.userId === currentUserId)) {
      throw new AppError('You must be a participant to add others to this conversation', 403);
    }

    const currentUserIds = currentParticipants.map(p => p.userId);
    const newUserIds = requestedUserIds.filter(id => !currentUserIds.includes(id));

    if (newUserIds.length === 0) {
      return {
        channelId,
        sourceChannelId: channelId,
        isExisting: true,
        participantsAdded: 0,
        addedParticipants: [],
        conversationsMoved: 0,
        movedEverything: false,
        destinationMembers: [],
        message: 'Everyone selected is already in this conversation',
      };
    }

    const newUsers = await this.loadActiveUsers(newUserIds);
    const allParticipantIds = [...new Set([...currentUserIds, ...newUserIds])].sort();

    if (allParticipantIds.length > MAX_DM_PARTICIPANTS) {
      throw new AppError(
        `Maximum ${MAX_DM_PARTICIPANTS} participants allowed in a group DM`,
        400,
      );
    }

    const cutoff = historyScopeToCutoff(historyScope);
    const carriesHistory = historyScope.mode !== 'none';

    if (historyScope.mode === 'custom' && (!cutoff || Number.isNaN(cutoff.getTime()))) {
      throw new AppError('Invalid custom history cutoff date', 400);
    }

    const existingGroupDM =
      await this.channelRepository.getGroupChannelByMembers(allParticipantIds);

    const destination =
      existingGroupDM ??
      (await this.channelRepository.create({
        scopeType: ChannelScopeType.GROUP_DM,
        name: allParticipantIds.join(','),
        visibility: ChannelVisibility.PRIVATE,
        createdBy: currentUserId,
        projectId: dmProjectId,
        workspaceId,
      } satisfies CreateChannelInput));

    if (!existingGroupDM) {
      for (const participantId of allParticipantIds) {
        const role = participantId === currentUserId ? ChannelRole.ADMIN : ChannelRole.MEMBER;
        await this.channelParticipantRepository.addParticipant(destination.id, participantId, role);
      }
    }

    const { moved, remaining } = carriesHistory
      ? await this.moveHistory(channelId, destination.id, cutoff)
      : { moved: 0, remaining: 0 };

    return {
      channelId: destination.id,
      sourceChannelId: channelId,
      isExisting: Boolean(existingGroupDM),
      participantsAdded: existingGroupDM ? 0 : newUsers.length,
      addedParticipants: existingGroupDM
        ? []
        : await this.describeAddedParticipants(destination.id, newUsers),
      conversationsMoved: moved,
      movedEverything: moved > 0 && remaining === 0,
      destinationMembers:
        moved > 0 ? await this.membersExcept(allParticipantIds, currentUserId) : [],
      message:
        moved > 0
          ? `${moved} conversation(s) moved to this conversation`
          : existingGroupDM
            ? 'Opened the existing group conversation'
            : 'New group DM created',
    };
  }

  async getHistoryPreview(params: {
    channelId: string;
    currentUserId: string;
    since: Date | null;
    limit: number;
  }): Promise<{ conversations: HistoryPreviewEntry[]; total: number }> {
    const { channelId, currentUserId, since, limit } = params;

    const participants =
      await this.channelParticipantRepository.getChannelParticipants(channelId);
    if (!participants.some(p => p.userId === currentUserId)) {
      throw new AppError('You must be a participant to preview this conversation', 403);
    }

    const [rows, total] = await Promise.all([
      this.conversationRepository.getHistoryPreview(channelId, since, limit),
      this.conversationRepository.countHistoryPreview(channelId, since),
    ]);
    const senderIds = [
      ...new Set(rows.map(r => r.initialMessage?.senderId).filter((id): id is string => !!id)),
    ];
    const senders = senderIds.length
      ? await this.userRepository.findMany({ where: { id: { in: senderIds } } })
      : [];
    const senderById = new Map(senders.map(user => [user.id, user]));

    const conversations = rows.map(row => {
      const sender = row.initialMessage ? senderById.get(row.initialMessage.senderId) : undefined;
      return {
        conversationId: row.conversationId,
        createdAt: row.createdAt.getTime(),
        initialMessage: row.initialMessage
          ? {
              senderId: row.initialMessage.senderId,
              content: row.initialMessage.content,
              senderName: sender?.displayName || sender?.name || 'Unknown',
            }
          : null,
        attachments: row.attachments,
      };
    });

    return { conversations, total };
  }

  private async loadActiveUsers(userIds: string[]): Promise<User[]> {
    const { users, missingUserId } = await this.userRepository.findActiveByIds(userIds);

    if (missingUserId) {
      throw new AppError('One or more participants not found or inactive', 404);
    }

    return users;
  }

  private async describeAddedParticipants(
    channelId: string,
    users: User[],
  ): Promise<AddedParticipant[]> {
    const described = await Promise.all(
      users.map(async user => {
        const participant = await this.channelParticipantRepository.findParticipant(
          channelId,
          user.id,
        );
        return participant
          ? {
              userId: user.id,
              userName: user.displayName || user.name,
              participantId: participant.id,
            }
          : null;
      }),
    );

    return described.filter((entry): entry is AddedParticipant => entry !== null);
  }

  private async membersExcept(
    userIds: string[],
    excludeUserId: string,
  ): Promise<Array<{ userId: string; userName: string }>> {
    const ids = userIds.filter(id => id !== excludeUserId);
    if (ids.length === 0) {
      return [];
    }

    const users = await this.userRepository.findMany({ where: { id: { in: ids } } });
    return users.map(user => ({ userId: user.id, userName: user.displayName || user.name }));
  }

  private async moveHistory(
    sourceChannelId: string,
    targetChannelId: string,
    cutoff: Date | null,
  ): Promise<{ moved: number; remaining: number }> {
    const result = await this.conversationRepository.moveConversationsToChannel(
      sourceChannelId,
      targetChannelId,
      cutoff,
    );

    logger.info('group_dm_history_moved', {
      sourceChannelId,
      targetChannelId,
      cutoff: cutoff?.toISOString() ?? null,
      ...result,
    });

    return result;
  }
}

export const groupDmParticipantService = new GroupDmParticipantService();
