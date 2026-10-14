import { apiGet, apiPost } from './apiClient';

interface VespaParticipantsResponse {
  success: boolean;
  data?: { userIds: string[] };
}

export async function getVespaParticipants(channelId: string): Promise<string[]> {
  const response = await apiGet<VespaParticipantsResponse>(
    `/channels/${channelId}/vespa-participants`,
  );
  return response.data?.userIds ?? [];
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface CreateChannelRequest {
  name: string;
  description?: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  projectId: string;
  topicTags?: string[];
  participants?: string[];
}

export interface CreateChannelResponse {
  success: boolean;
  id: string;
  name: string;
  scopeType: string;
  description?: string | null;
  visibility?: string | null;
  projectId: string;
  ownerId: string;
  createdAt: string;
}

export interface CheckDuplicateChannelResponse {
  isDuplicate: boolean;
  name: string;
  projectId: string;
}

export interface CreateDmRequest {
  participantIds: string[];
  message?: string;
  forwardedMessage?: {
    originalMessageId: string;
    optionalMessage?: string;
  };
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
  unreadCount: number;
  createdAt: string;
  isExisting: boolean;
  // Stats are now in a separate object (from channel_stats table)
  channelStats?: {
    participantCount: number;
    lastActivityAt?: string;
    addUserPolicy?: 'EVERYONE' | 'ADMINS_ONLY';
  };
  // For backward compatibility - these fields are now in channelStats
  participantCount?: number;
  lastActivityAt?: string;
}

export class ChannelService {
  private token: string | null;

  constructor(token?: string | null) {
    this.token = token ?? null;
  }

  setToken(token: string | null): void {
    this.token = token;
  }

  async checkDuplicateChannel(
    name: string,
    projectId: string,
  ): Promise<CheckDuplicateChannelResponse> {
    const body: { [key: string]: JsonValue } = { name, projectId };
    const options = this.token ? { token: this.token } : undefined;
    return apiPost<CheckDuplicateChannelResponse>('/channels/check-duplicate', body, options);
  }

  async createChannel(data: CreateChannelRequest): Promise<CreateChannelResponse> {
    const body: { [key: string]: JsonValue } = {
      name: data.name,
      scopeType: 'DEFAULT',
      description: data.description || '',
      visibility: data.visibility,
      projectId: data.projectId,
      topicTags: data.topicTags || [],
    };

    if (data.participants && data.participants.length > 0) {
      body['participants'] = data.participants;
    }

    const options = this.token ? { token: this.token } : undefined;
    return apiPost<CreateChannelResponse>('/channels', body, options);
  }

  async createDm(data: CreateDmRequest): Promise<CreateDmResponse> {
    const body: { [key: string]: JsonValue } = {
      participantIds: data.participantIds,
    };
    if (data.message) {
      body['message'] = data.message;
    }
    if (data.forwardedMessage) {
      body['forwardedMessage'] = data.forwardedMessage as JsonValue;
    }
    const options = this.token ? { token: this.token } : undefined;
    return apiPost<CreateDmResponse>('/users/me/dms', body, options);
  }
}
