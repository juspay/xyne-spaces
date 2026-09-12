import { apiInstance } from '../clients/apiClient';
import { DeskType, ChannelScopeType } from '@xyne/shared';
import type {
  AddGroupDmParticipantsRequest,
  AddGroupDmParticipantsResponse,
  HistoryPreviewResponse,
} from '@xyne/shared';

export interface CheckDuplicateChannelResponse {
  isDuplicate: boolean;
  name: string;
  projectId: string;
}

export interface CreateChannelFormData {
  name: string;
  description?: string;
  visibility: 'public' | 'private';
  topicTags: string[];
  projectId: string;
  assigneeUserGroupId?: string;
  boardId?: string;
}

export interface CreateChannelRequest {
  name: string;
  scopeType: ChannelScopeType.DEFAULT;
  scopeId?: string;
  description?: string;
  topicTags?: string[];
  visibility?: 'PUBLIC' | 'PRIVATE';
  projectId: string;
  participants?: string[];
  type?: 'DEFAULT' | 'EMAIL' | 'SUPPORT' | 'SLACK' | 'APP' | 'CALL';
  assigneeUserGroupId?: string;
  deskType?: 'EMAIL' | 'DL' | 'SLACK' | 'APP' | 'CALL';
  dlEmail?: string;
  slackChannelId?: string;
  installedAppId?: string;
  boardId?: string;
}

export type EmailDeskOpts =
  | { deskType: DeskType.EMAIL }
  | { deskType: DeskType.DL; dlEmail: string }
  | { deskType: DeskType.SLACK; slackChannelId: string }
  | { deskType: DeskType.APP; installedAppId: string }
  | { deskType: DeskType.CALL };

export interface CreateChannelResponse {
  success: boolean;
  id: string;
  name: string;
  scopeType: string;
  description?: string | null;
  visibility?: string | null;
  projectId: string;
  ownerId: string;
  createdAt: Date | string;
}

export interface ForwardedMessageData {
  originalMessageId: string;
  optionalMessage?: string | undefined;
}

export interface CreateDmRequest {
  participantIds: string[];
  message?: string | undefined;
  forwardedMessage?: ForwardedMessageData;
  /** To hide auto-created channels */
  silent?: boolean;
}

export interface CreateDmResponse {
  message: string;
  id: string;
  name: string;
  scopeType: string;
  description?: string;
  visibility: string;
  projectId: string;
  ownerId: string;
  participantCount: number;
  unreadCount: number;
  lastActivityAt?: string;
  createdAt: string;
  isExisting: boolean;
}

export type {
  AddGroupDmParticipantsRequest,
  AddGroupDmParticipantsResponse,
  HistoryPreviewEntry,
  HistoryPreviewResponse,
} from '@xyne/shared';

export interface PromoteGroupDmRequest {
  name: string;
  description?: string;
  visibility: 'public' | 'private';
  projectId: string;
  topicTags: string[];
}

export interface ChannelMember {
  id: string;
  name: string;
}

export class ChannelService {
  async checkDuplicateChannel(
    title: string,
    channelId?: string,
  ): Promise<CheckDuplicateChannelResponse> {
    const response = await apiInstance.post<CheckDuplicateChannelResponse>(
      '/channels/check-duplicate',
      { name: title, ...(channelId ? { channelId } : {}) },
    );
    return response.data;
  }

  async createChannel(
    formData: CreateChannelFormData,
    channelType: 'DEFAULT' | 'EMAIL' | 'SUPPORT' | 'SLACK' | 'APP' | 'CALL' = 'DEFAULT',
    emailDeskOpts?: EmailDeskOpts,
  ): Promise<CreateChannelResponse> {
    const requestData: CreateChannelRequest = {
      name: formData.name,
      scopeType: ChannelScopeType.DEFAULT,
      description: formData.description || '',
      visibility: formData.visibility === 'public' ? 'PUBLIC' : 'PRIVATE',
      projectId: formData.projectId,
      type: channelType,
      ...(formData.assigneeUserGroupId && { assigneeUserGroupId: formData.assigneeUserGroupId }),
      ...(formData.boardId && { boardId: formData.boardId }),
      ...(channelType === 'EMAIL' &&
        emailDeskOpts && {
          deskType: emailDeskOpts.deskType,
          ...(emailDeskOpts.deskType === DeskType.DL && { dlEmail: emailDeskOpts.dlEmail }),
        }),
      ...(channelType === 'SLACK' &&
        emailDeskOpts &&
        emailDeskOpts.deskType === DeskType.SLACK && {
          slackChannelId: emailDeskOpts.slackChannelId,
        }),
      ...(channelType === 'APP' &&
        emailDeskOpts &&
        emailDeskOpts.deskType === DeskType.APP && {
          installedAppId: emailDeskOpts.installedAppId,
        }),
      ...(channelType === 'CALL' &&
        emailDeskOpts &&
        emailDeskOpts.deskType === DeskType.CALL && {
          deskType: emailDeskOpts.deskType,
        }),
    };

    const response = await apiInstance.post<CreateChannelResponse>('/channels', requestData);
    return response.data;
  }

  async createDm(data: CreateDmRequest): Promise<CreateDmResponse> {
    const response = await apiInstance.post<CreateDmResponse>('/users/me/dms', data);
    return response.data;
  }

  async getDmHistoryPreview(
    channelId: string,
    params: { since: number | null; limit?: number },
  ): Promise<HistoryPreviewResponse> {
    const response = await apiInstance.get<HistoryPreviewResponse>(
      `/users/me/dms/${channelId}/history-preview`,
      { params: { ...(params.since !== null && { since: params.since }), limit: params.limit } },
    );
    return response.data;
  }

  async addGroupDmParticipants(
    channelId: string,
    data: AddGroupDmParticipantsRequest,
  ): Promise<AddGroupDmParticipantsResponse> {
    const response = await apiInstance.post<AddGroupDmParticipantsResponse>(
      `/users/me/dms/${channelId}/add`,
      data,
    );
    return response.data;
  }

  async getVespaParticipants(channelId: string): Promise<string[]> {
    const response = await apiInstance.get<{
      success: boolean;
      data?: { userIds: string[] };
    }>(`/channels/${channelId}/vespa-participants`);
    return response.data.data?.userIds ?? [];
  }

  async getChannelMembers(channelId: string): Promise<ChannelMember[]> {
    const response = await apiInstance.get<{
      success: boolean;
      data?: { members: ChannelMember[] };
    }>(`/channels/${channelId}/members`);
    return response.data.data?.members ?? [];
  }

  async getChannelMemberCounts(channelIds: string[]): Promise<Record<string, number>> {
    if (channelIds.length === 0) return {};
    const response = await apiInstance.post<{
      success: boolean;
      data?: { counts: Record<string, number> };
    }>('/channels/member-counts', { channelIds });
    return response.data.data?.counts ?? {};
  }
}

export const channelService = new ChannelService();
