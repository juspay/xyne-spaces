import { apiInstance } from '../clients/apiClient';

export interface CreateAppRequest {
  name: string;
  description?: string;
  webhookUrl?: string;
}

export interface App {
  id: string;
  name: string;
  description: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface InstallAppResponse {
  jwtToken: string;
}

export interface UpdateAppRequest {
  name?: string;
  description?: string;
  webhookUrl?: string;
}

export interface BotChannel {
  id: string;
  name: string;
  visibility: string;
}

export interface IncomingWebhook {
  id: string;
  name: string;
  channelId: string;
  channelName: string;
  channelVisibility: string;
  isActive: boolean;
  createdAt: string;
  webhookUrl: string;
}

export interface CreateIncomingWebhookRequest {
  installedAppId: string;
  channelId: string;
  name: string;
}

export class AppsService {
  async createApp(data: CreateAppRequest): Promise<App> {
    const response = await apiInstance.post<App>('/apps/create', data);
    return response.data;
  }

  async installApp(appId: string): Promise<InstallAppResponse> {
    const response = await apiInstance.post<InstallAppResponse>(`/apps/install/${appId}`);
    return response.data;
  }

  async regenerateJwt(appId: string): Promise<InstallAppResponse> {
    const response = await apiInstance.post<InstallAppResponse>(`/apps/regenerate-jwt/${appId}`);
    return response.data;
  }

  async getBotChannels(appId: string): Promise<BotChannel[]> {
    const response = await apiInstance.get<{ channels: BotChannel[] }>(
      `/apps/bot-channels/${appId}`,
    );
    return response.data.channels;
  }

  async createIncomingWebhook(data: CreateIncomingWebhookRequest): Promise<IncomingWebhook> {
    const response = await apiInstance.post<IncomingWebhook>('/apps/incoming-webhooks', data);
    return response.data;
  }

  async getIncomingWebhooks(
    installedAppId: string,
    params?: { limit?: number; offset?: number; includeInactive?: boolean },
  ): Promise<{ webhooks: IncomingWebhook[]; total: number; limit: number; offset: number }> {
    const response = await apiInstance.get<{
      webhooks: IncomingWebhook[];
      total: number;
      limit: number;
      offset: number;
    }>(`/apps/incoming-webhooks/${installedAppId}`, { params });
    return response.data;
  }

  async updateIncomingWebhook(webhookId: string, data: { name: string }): Promise<void> {
    await apiInstance.patch(`/apps/incoming-webhooks/${webhookId}`, data);
  }

  async revokeIncomingWebhook(webhookId: string): Promise<void> {
    await apiInstance.post(`/apps/incoming-webhooks/${webhookId}/revoke`);
  }

  async uploadBotPicture(appId: string, file: File): Promise<{ picture: string }> {
    const formData = new FormData();
    formData.append('picture', file);
    const response = await apiInstance.post<{ picture: string }>(
      `/apps/upload-picture/${appId}`,
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      },
    );
    return response.data;
  }
}

export const appsService = new AppsService();
