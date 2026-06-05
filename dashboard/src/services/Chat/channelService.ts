import { apiInstance } from '../clients/apiClient';

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
  scopeType: 'DEFAULT';
  scopeId?: string;
  description?: string;
  topicTags?: string[];
  visibility?: 'PUBLIC' | 'PRIVATE';
  projectId: string;
  participants?: string[];
  type?: 'DEFAULT' | 'EMAIL' | 'SUPPORT' | 'SLACK';
  assigneeUserGroupId?: string;
  deskType?: 'EMAIL' | 'DL' | 'SLACK';
  dlEmail?: string;
  slackChannelId?: string;
  boardId?: string;
}

export type EmailDeskOpts =
  | { deskType: 'EMAIL' }
  | { deskType: 'DL'; dlEmail: string }
  | { deskType: 'SLACK'; slackChannelId: string };

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

export interface AddGroupDmParticipantsRequest {
  userIds: string[];
  includeHistory: boolean;
}

export interface AddGroupDmParticipantsResponse {
  channelId: string;
  isExisting: boolean;
  participantsAdded: number;
  conversationsMigrated?: number;
  message: string;
}

export interface PromoteGroupDmRequest {
  name: string;
  description?: string;
  visibility: 'public' | 'private';
  projectId: string;
  topicTags: string[];
}

export class ChannelService {
  async checkDuplicateChannel(
    title: string,
    orgName: string,
  ): Promise<CheckDuplicateChannelResponse> {
    const response = await apiInstance.post<CheckDuplicateChannelResponse>(
      '/channels/check-duplicate',
      { name: title, projectId: orgName || 'default' },
    );
    return response.data;
  }

  async createChannel(
    formData: CreateChannelFormData,
    channelType: 'DEFAULT' | 'EMAIL' | 'SUPPORT' | 'SLACK' = 'DEFAULT',
    emailDeskOpts?: EmailDeskOpts,
  ): Promise<CreateChannelResponse> {
    const requestData: CreateChannelRequest = {
      name: formData.name,
      scopeType: 'DEFAULT',
      description: formData.description || '',
      visibility: formData.visibility === 'public' ? 'PUBLIC' : 'PRIVATE',
      projectId: formData.projectId,
      type: channelType,
      ...(formData.assigneeUserGroupId && { assigneeUserGroupId: formData.assigneeUserGroupId }),
      ...(formData.boardId && { boardId: formData.boardId }),
      ...(channelType === 'EMAIL' &&
        emailDeskOpts && {
          deskType: emailDeskOpts.deskType,
          ...(emailDeskOpts.deskType === 'DL' && { dlEmail: emailDeskOpts.dlEmail }),
        }),
      ...(channelType === 'SLACK' &&
        emailDeskOpts &&
        emailDeskOpts.deskType === 'SLACK' && {
          slackChannelId: emailDeskOpts.slackChannelId,
        }),
    };

    const response = await apiInstance.post<CreateChannelResponse>('/channels', requestData);
    return response.data;
  }

  async createDm(data: CreateDmRequest): Promise<CreateDmResponse> {
    const response = await apiInstance.post<CreateDmResponse>('/users/me/dms', data);
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
}

export const channelService = new ChannelService();
