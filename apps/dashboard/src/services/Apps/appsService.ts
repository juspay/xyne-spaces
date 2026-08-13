import { apiInstance } from '../clients/apiClient';
import { AppIncomingWebhookAction, CommandType, CommandAccessibility } from '@xyne/shared';

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
  type: 'SLACK' | 'SENTINELONE' | 'AMAZON_SNS' | 'PINGDOM' | 'GCP';
  action: AppIncomingWebhookAction;
  isActive: boolean;
  createdAt: string;
  webhookUrl: string;
}

export interface CreateIncomingWebhookRequest {
  installedAppId: string;
  channelId: string;
  boardId?: string;
  name: string;
  type: 'SLACK' | 'SENTINELONE' | 'AMAZON_SNS' | 'PINGDOM' | 'GCP';
  action?: AppIncomingWebhookAction;
}

export type { CommandType, CommandAccessibility };

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

export interface AppSearchHit {
  docId: string;
  name: string;
  description: string;
  createdBy: string;
  orgId: string;
  orgName: string;
  scope: string;
  version: number;
  createdAt: number;
  relevance: number;
  // Install state, scoped to the caller's workspace (resolved from the DB server-side).
  installed: boolean;
  installedAppId: string | null;
  installedVersion: number | null;
  webhookUrl: string | null;
  botUserId: string | null;
}

export type AppsView = 'installed' | 'org' | 'marketplace';
interface GrantedPermissionsResponse {
  permissions: string[];
  permissionsPending: boolean;
  statuses: { scope: string; status: string }[];
}
function extractGrantedFrom403(err: unknown): GrantedPermissionsResponse | null {
  const e = err as {
    status?: number;
    responseData?: Partial<GrantedPermissionsResponse>;
    response?: { status?: number; data?: Partial<GrantedPermissionsResponse> };
  };
  const status = e?.status ?? e?.response?.status;
  const data = e?.responseData ?? e?.response?.data;
  if (status === 403 && data) {
    return {
      permissions: data.permissions ?? [],
      permissionsPending: data.permissionsPending ?? false,
      statuses: data.statuses ?? [],
    };
  }
  return null;
}

export class AppsService {
  async createApp(data: CreateAppRequest): Promise<App> {
    const response = await apiInstance.post<App>('/apps/create', data);
    return response.data;
  }

  /**
   * App search via Vespa (`app` schema), scoped to one of the three Apps views
   * (Installed / Org / Marketplace). Returns ranked hits (with workspace-scoped
   * install state + owning-org attribution) and the total match count.
   */
  async search(
    query: string,
    view: AppsView,
    limit = 50,
    offset = 0,
  ): Promise<{ results: AppSearchHit[]; total: number }> {
    const response = await apiInstance.get<{
      success: boolean;
      results: AppSearchHit[];
      total: number;
    }>('/vespaSearch', { params: { q: query, apps: 'xyneapp', view, limit, offset } });
    return { results: response.data?.results ?? [], total: response.data?.total ?? 0 };
  }

  async installApp(appId: string): Promise<InstallAppResponse> {
    const response = await apiInstance.post<InstallAppResponse>(`/apps/install/${appId}`);
    return response.data;
  }

  // Update = re-install into the current workspace (pulls the latest app snapshot + version).
  async updateApp(appId: string): Promise<InstallAppResponse> {
    const response = await apiInstance.post<InstallAppResponse>(`/apps/install/${appId}`);
    return response.data;
  }

  // Promote an ORG app to GLOBAL (marketplace). XYNE-APPS admin only (enforced server-side).
  async promoteApp(appId: string): Promise<App> {
    const response = await apiInstance.post<App>(`/apps/promote/${appId}`);
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

  /**
   * Resolve org ids -> org names (for "Created by" attribution on cross-workspace/cross-org apps,
   * which can't be resolved client-side because org data is org-scoped). Returns {} on empty input.
   */
  async getOrgNames(orgIds: string[]): Promise<Record<string, string>> {
    if (orgIds.length === 0) return {};
    const response = await apiInstance.post<{ orgNames: Record<string, string> }>(
      '/apps/org-names',
      { orgIds },
    );
    return response.data.orgNames;
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
      params: { commandType: CommandType.COMMAND },
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
      params: { commandType: CommandType.COMMAND },
    });
  }

  async getChannelCommands(
    channelId: string,
    filter?: { commandAccessibility?: CommandAccessibility },
  ): Promise<AppCommand[]> {
    const params: Record<string, string> = { commandType: CommandType.COMMAND };
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
      commandType: CommandType.COMMAND,
      conversationId: conversationId ?? null,
      text: text ?? null,
    });
  }

  // ─── Shortcuts ─────────────────────────────────────────────────────────────
  // All shortcut operations use the same /commands routes with commandType=SHORTCUT.
  // Method signatures are kept identical so UI components require no changes.

  async getShortcuts(appId: string): Promise<AppShortcut[]> {
    const response = await apiInstance.get<AppShortcut[]>(`/apps/${appId}/commands`, {
      params: { commandType: CommandType.SHORTCUT },
    });
    return response.data;
  }

  // Map a shortcut request → the command payload the API expects (commandType=SHORTCUT,
  // shortcutType → commandAccessibility).
  private toShortcutPayload(data: UpsertShortcutRequest): UpsertCommandRequest {
    const accessibilityMap: Record<string, CommandAccessibility> = {
      GLOBAL: CommandAccessibility.GLOBAL,
      MESSAGE: CommandAccessibility.MESSAGE,
    };
    return {
      commandName: data.commandName,
      description: data.description,
      commandType: CommandType.SHORTCUT,
      commandAccessibility:
        accessibilityMap[data.shortcutType ?? 'GLOBAL'] ?? CommandAccessibility.GLOBAL,
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
      params: { commandType: CommandType.SHORTCUT },
    });
  }

  async getChannelShortcuts(
    channelId: string,
    filter?: { type?: ShortcutType },
  ): Promise<AppShortcutWithApp[]> {
    const params: Record<string, string> = { commandType: CommandType.SHORTCUT };
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
      commandType: CommandType.SHORTCUT,
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
  async getGrantedPermissions(appId: string): Promise<GrantedPermissionsResponse> {
    try {
      const response = await apiInstance.get<GrantedPermissionsResponse>(
        `/apps/permissions/${appId}`,
      );
      return response.data;
    } catch (err: unknown) {
      const body = extractGrantedFrom403(err);
      if (body) return body;
      throw err;
    }
  }

  /** Replace the TEMPLATE permissions for an app (Org/Marketplace edit, creator). */
  async setPermissions(appId: string, permissions: string[]): Promise<void> {
    await apiInstance.post(`/apps/permissions/${appId}`, { permissions });
  }

  // ─── Per-install edits (Installed screen, workspace admin) ───────────────────

  /** Update the caller's install (webhook URL only). Scoped server-side to the workspace. */
  async updateInstalledApp(
    installedAppId: string,
    data: { webhookUrl?: string },
  ): Promise<{ webhookUrl: string | null }> {
    const response = await apiInstance.patch<{ webhookUrl: string | null }>(
      `/apps/installed/${installedAppId}`,
      data,
    );
    return response.data;
  }

  /** Read the INSTALL's scoped permissions (installed_app_permissions) with statuses. */
  async getInstalledPermissions(installedAppId: string): Promise<GrantedPermissionsResponse> {
    try {
      const response = await apiInstance.get<GrantedPermissionsResponse>(
        `/apps/installed/${installedAppId}/permissions`,
      );
      return response.data;
    } catch (err: unknown) {
      const body = extractGrantedFrom403(err);
      if (body) return body;
      throw err;
    }
  }

  /** Replace the INSTALL's scoped permissions (installed_app_permissions). */
  async setInstalledPermissions(installedAppId: string, permissions: string[]): Promise<void> {
    await apiInstance.post(`/apps/installed/${installedAppId}/permissions`, { permissions });
  }

  /**
   * Activate the INSTALL's pending permission edits in place (UNAPPROVED → APPROVED, drop
   * PENDINGDELETE) without resetting to the app template. Backs "Apply & activate".
   */
  async activateInstalledPermissions(installedAppId: string): Promise<void> {
    await apiInstance.post(`/apps/installed/${installedAppId}/permissions/activate`);
  }

  /** Read-only snapshot of the install's commands/shortcuts. */
  async getInstalledCommands(
    installedAppId: string,
    commandType: CommandType = CommandType.COMMAND,
  ): Promise<AppCommand[]> {
    const response = await apiInstance.get<AppCommand[]>(
      `/apps/installed/${installedAppId}/commands`,
      { params: { commandType } },
    );
    return response.data;
  }
}

export const appsService = new AppsService();
