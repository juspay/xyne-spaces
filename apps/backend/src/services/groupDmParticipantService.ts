import {
  ChannelRole,
  ChannelScopeType,
  ChannelVisibility,
  MAX_DM_PARTICIPANTS,
  historyScopeToCutoff,
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
  includeAttachments: boolean;
}

export interface AddedParticipant {
  userId: string;
  userName: string;
  participantId: string;
}

export interface AddGroupDmParticipantsResult {
  channelId: string;
  isExisting: boolean;
  isInPlace: boolean;
  participantsAdded: number;
  addedParticipants: AddedParticipant[];
  conversationsCopied: number;
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
    const { channelId, currentUserId, workspaceId, userIds, historyScope, includeAttachments } =
      params;
    const dmProjectId = await this.projectRepository.getDMProjectId(workspaceId);
    if (!dmProjectId) {
      throw new AppError('DM project not found for workspace', 500);
    }

    const uniqueUserIds = [...new Set(userIds)].filter(id => id !== currentUserId);
    if (uniqueUserIds.length === 0) {
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

    const newUsers = await this.loadActiveUsers(uniqueUserIds);

    const currentUserIds = currentParticipants.map(p => p.userId);
    const allParticipantIds = [...currentUserIds, ...uniqueUserIds].sort();

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

    if (existingGroupDM) {
      const conversationsCopied = carriesHistory
        ? await this.copyHistory(
            channelId,
            existingGroupDM.id,
            workspaceId,
            cutoff,
            includeAttachments,
          )
        : 0;

      return {
        channelId: existingGroupDM.id,
        isExisting: true,
        isInPlace: false,
        participantsAdded: 0,
        addedParticipants: [],
        conversationsCopied,
        message:
          conversationsCopied > 0
            ? `${conversationsCopied} conversation(s) shared with the existing group DM`
            : 'Navigated to existing group DM',
      };
    }

    if (historyScope.mode === 'beginning' && channel.scopeType === ChannelScopeType.GROUP_DM) {
      return this.addParticipantsInPlace(channelId, currentParticipants, newUsers);
    }

    const newChannel = await this.channelRepository.create({
      scopeType: ChannelScopeType.GROUP_DM,
      name: allParticipantIds.join(','),
      visibility: ChannelVisibility.PRIVATE,
      createdBy: currentUserId,
      projectId: dmProjectId,
      workspaceId,
    } satisfies CreateChannelInput);

    for (const participantId of allParticipantIds) {
      const role = participantId === currentUserId ? ChannelRole.ADMIN : ChannelRole.MEMBER;
      await this.channelParticipantRepository.addParticipant(newChannel.id, participantId, role);
    }

    const conversationsCopied = carriesHistory
      ? await this.copyHistory(channelId, newChannel.id, workspaceId, cutoff, includeAttachments)
      : 0;

    return {
      channelId: newChannel.id,
      isExisting: false,
      isInPlace: false,
      participantsAdded: allParticipantIds.length,
      addedParticipants: await this.describeAddedParticipants(newChannel.id, newUsers),
      conversationsCopied,
      message:
        conversationsCopied > 0
          ? `New group DM created with ${conversationsCopied} conversation(s) carried over`
          : 'New group DM created',
    };
  }

  private async loadActiveUsers(userIds: string[]): Promise<User[]> {
    const users = await this.userRepository.findMany({
      where: { id: { in: userIds }, status: 'ACTIVE' },
    });

    if (users.length !== userIds.length) {
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

  private async copyHistory(
    sourceChannelId: string,
    targetChannelId: string,
    workspaceId: string,
    cutoff: Date | null,
    includeAttachments: boolean,
  ): Promise<number> {
    const copied = await this.conversationRepository.copyConversationsToChannel(
      sourceChannelId,
      targetChannelId,
      workspaceId,
      cutoff,
      { includeAttachments },
    );

    logger.info('group_dm_history_copied', {
      sourceChannelId,
      targetChannelId,
      cutoff: cutoff?.toISOString() ?? null,
      includeAttachments,
      copied,
    });

    return copied;
  }

  private async addParticipantsInPlace(
    channelId: string,
    currentParticipants: Array<{ userId: string }>,
    newUsers: User[],
  ): Promise<AddGroupDmParticipantsResult> {
    const addedUsers: User[] = [];

    for (const user of newUsers) {
      if (currentParticipants.some(p => p.userId === user.id)) {
        continue;
      }
      await this.channelParticipantRepository.addParticipant(channelId, user.id, ChannelRole.MEMBER);
      addedUsers.push(user);
    }

    const allParticipantIds = [
      ...currentParticipants.map(p => p.userId),
      ...addedUsers.map(u => u.id),
    ].sort();
    await this.channelRepository.update(channelId, { name: allParticipantIds.join(',') });

    const addedParticipants = await this.describeAddedParticipants(channelId, addedUsers);

    return {
      channelId,
      isExisting: false,
      isInPlace: true,
      participantsAdded: addedParticipants.length,
      addedParticipants,
      conversationsCopied: 0,
      message: `${addedParticipants.length} participant(s) added to current group DM`,
    };
  }
}

export const groupDmParticipantService = new GroupDmParticipantService();
