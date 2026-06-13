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
  projectId: string;
}

export interface ProjectBoard {
  id: string;
  name: string;
  projectId: string;
}

export interface IncomingWebhook {
  id: string;
  name: string;
  channelId: string;
  channelName: string;
  channelVisibility: string;
  boardId?: string | null;
  boardName?: string | null;
  type: 'SLACK' | 'SENTINELONE';
  action: 'MESSAGE' | 'TICKET';
  isActive: boolean;
  createdAt: string;
  webhookUrl: string;
}

export interface CreateIncomingWebhookRequest {
  installedAppId: string;
  channelId: string;
  boardId?: string;
  name: string;
  type: 'SLACK' | 'SENTINELONE';
  action?: 'MESSAGE' | 'TICKET';
}

export type CommandType = 'COMMAND' | 'SHORTCUT';
export type CommandAccessibility = 'CHAT' | 'THREAD' | 'BOTH' | 'MESSAGE' | 'GLOBAL';

export interface AppCommand {
  id: string;
  appId: string;
  commandName: string;
  description: string;
  commandType: CommandType;
  commandAccessibility: CommandAccessibility;
  /** @deprecated use commandAccessibility */
  isForThread: boolean;
  /** @deprecated use commandAccessibility */
  isForChat: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AppCommandWithApp extends AppCommand {
  appName: string;
}

export interface UpsertCommandRequest {
  commandName: string;
  description: string;
  commandType: CommandType;
  commandAccessibility: CommandAccessibility;
}

// Shortcut aliases — kept so UI components require no changes
export type ShortcutType = 'GLOBAL' | 'MESSAGE';
export type AppShortcut = AppCommand;
export type AppShortcutWithApp = AppCommandWithApp;
export interface UpsertShortcutRequest {
  commandName: string; // callbackId stored as commandName
  description: string;
  shortcutType?: ShortcutType; // mapped to commandAccessibility on send
}

export interface AppPermission {
  id: string;
  name: string;
  type: string;
  description: string | null;
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

  async getProjectBoards(projectId: string): Promise<ProjectBoard[]> {
    const response = await apiInstance.get<{ boards: ProjectBoard[] }>(
      `/apps/project-boards/${projectId}`,
    );
    return response.data.boards;
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

  async getSigningSecret(appId: string): Promise<{ signingSecret: string }> {
    const response = await apiInstance.post<{ signingSecret: string }>(
      `/apps/signing-secret/${appId}`,
    );
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

  async getCommands(appId: string): Promise<AppCommand[]> {
    const response = await apiInstance.get<AppCommand[]>(`/apps/${appId}/commands`, {
      params: { commandType: 'COMMAND' },
    });
    return response.data;
  }

  /** Create a new command. POST → 409 if the name is already taken. */
  async createCommand(appId: string, data: UpsertCommandRequest): Promise<AppCommand> {
    const response = await apiInstance.post<AppCommand>(`/apps/${appId}/commands`, data);
    return response.data;
  }

  /** Update an existing command. PUT → 404 if it doesn't exist. */
  async updateCommand(appId: string, data: UpsertCommandRequest): Promise<AppCommand> {
    const response = await apiInstance.put<AppCommand>(`/apps/${appId}/commands`, data);
    return response.data;
  }

  async deleteCommand(appId: string, commandName: string): Promise<void> {
    await apiInstance.delete(`/apps/${appId}/commands/${commandName}`, {
      params: { commandType: 'COMMAND' },
    });
  }

  async getChannelCommands(
    channelId: string,
    filter?: { commandAccessibility?: CommandAccessibility },
  ): Promise<AppCommand[]> {
    const params: Record<string, string> = { commandType: 'COMMAND' };
    if (filter?.commandAccessibility) params['commandAccessibility'] = filter.commandAccessibility;
    const response = await apiInstance.get<AppCommand[]>(`/apps/channel/${channelId}/commands`, {
      params,
    });
    return response.data;
  }

  async executeCommandAction(
    channelId: string,
    commandName: string,
    conversationId?: string | null,
    text?: string,
  ): Promise<void> {
    await apiInstance.post(`/apps/channel/${channelId}/command`, {
      commandName,
      commandType: 'COMMAND',
      conversationId: conversationId ?? null,
      text: text ?? null,
    });
  }

  // ─── Shortcuts ─────────────────────────────────────────────────────────────
  // All shortcut operations use the same /commands routes with commandType=SHORTCUT.
  // Method signatures are kept identical so UI components require no changes.

  async getShortcuts(appId: string): Promise<AppShortcut[]> {
    const response = await apiInstance.get<AppShortcut[]>(`/apps/${appId}/commands`, {
      params: { commandType: 'SHORTCUT' },
    });
    return response.data;
  }

  // Map a shortcut request → the command payload the API expects (commandType=SHORTCUT,
  // shortcutType → commandAccessibility).
  private toShortcutPayload(data: UpsertShortcutRequest): UpsertCommandRequest {
    const accessibilityMap: Record<string, CommandAccessibility> = {
      GLOBAL: 'GLOBAL',
      MESSAGE: 'MESSAGE',
    };
    return {
      commandName: data.commandName,
      description: data.description,
      commandType: 'SHORTCUT',
      commandAccessibility: accessibilityMap[data.shortcutType ?? 'GLOBAL'] ?? 'GLOBAL',
    };
  }

  /** Create a new shortcut. POST → 409 if the name is already taken. */
  async createShortcut(appId: string, data: UpsertShortcutRequest): Promise<AppShortcut> {
    const response = await apiInstance.post<AppShortcut>(
      `/apps/${appId}/commands`,
      this.toShortcutPayload(data),
    );
    return response.data;
  }

  /** Update an existing shortcut. PUT → 404 if it doesn't exist. */
  async updateShortcut(appId: string, data: UpsertShortcutRequest): Promise<AppShortcut> {
    const response = await apiInstance.put<AppShortcut>(
      `/apps/${appId}/commands`,
      this.toShortcutPayload(data),
    );
    return response.data;
  }

  async deleteShortcut(appId: string, callbackId: string): Promise<void> {
    await apiInstance.delete(`/apps/${appId}/commands/${callbackId}`, {
      params: { commandType: 'SHORTCUT' },
    });
  }

  async getChannelShortcuts(
    channelId: string,
    filter?: { type?: ShortcutType },
  ): Promise<AppShortcutWithApp[]> {
    const params: Record<string, string> = { commandType: 'SHORTCUT' };
    if (filter?.type) params['commandAccessibility'] = filter.type; // GLOBAL | MESSAGE maps 1:1
    const response = await apiInstance.get<AppShortcutWithApp[]>(
      `/apps/channel/${channelId}/commands`,
      { params },
    );
    return response.data;
  }

  async executeShortcutAction(
    channelId: string,
    callbackId: string,
    conversationId?: string | null,
    messageText?: string,
    messageId?: string,
  ): Promise<void> {
    await apiInstance.post(`/apps/channel/${channelId}/command`, {
      commandName: callbackId,
      commandType: 'SHORTCUT',
      conversationId: conversationId ?? null,
      messageText: messageText ?? '',
      messageId,
    });
  }

  // ─── Permission management ──────────────────────────────────────────────────

  /** List every permission in the registry (for the selection UI). */
  async getAvailablePermissions(): Promise<AppPermission[]> {
    const response = await apiInstance.get<{ permissions: AppPermission[] }>('/apps/permissions');
    return response.data.permissions;
  }

  /** Get the permission names currently granted to an app, along with per-permission statuses. */
  async getGrantedPermissions(appId: string): Promise<{
    permissions: string[];
    permissionsPending: boolean;
    statuses: { scope: string; status: string }[];
  }> {
    try {
      const response = await apiInstance.get<{
        permissions: string[];
        permissionsPending: boolean;
        statuses: { scope: string; status: string }[];
      }>(`/apps/permissions/${appId}`);
      return response.data;
    } catch (err: unknown) {
      // Backend returns 403 with full body (permissions + statuses) when no
      // permissions are active yet. Extract it so the UI still shows badges.
      const axiosErr = err as {
        response?: {
          status?: number;
          data?: {
            permissions?: string[];
            permissionsPending?: boolean;
            statuses?: { scope: string; status: string }[];
          };
        };
      };
      if (axiosErr?.response?.status === 403 && axiosErr.response.data) {
        return {
          permissions: axiosErr.response.data.permissions ?? [],
          permissionsPending: axiosErr.response.data.permissionsPending ?? false,
          statuses: axiosErr.response.data.statuses ?? [],
        };
      }
      throw err;
    }
  }

  /** Replace the full set of permissions for an app. */
  async setPermissions(appId: string, permissions: string[]): Promise<void> {
    await apiInstance.post(`/apps/permissions/${appId}`, { permissions });
  }
}

export const appsService = new AppsService();
