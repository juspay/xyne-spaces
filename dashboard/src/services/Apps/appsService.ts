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
