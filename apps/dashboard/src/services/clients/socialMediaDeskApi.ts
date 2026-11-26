import { apiInstance } from './apiClient';

export async function connectGooglePlayDesk(input: {
  serviceAccountKey: string;
  channelName: string;
  applications: Array<{
    packageName: string;
    displayName: string;
  }>;
  projectId: string;
  boardId: string;
  assigneeUserGroupId?: string;
  visibility: 'PUBLIC' | 'PRIVATE';
}): Promise<string> {
  const response = await apiInstance.post<{ channelId: string }>(
    '/integrations/social-media/google-play/connect',
    input,
  );
  return response.data.channelId;
}

export async function addGooglePlayApps(
  channelId: string,
  input: {
    applications: Array<{
      packageName: string;
      displayName: string;
    }>;
  },
): Promise<{ added: number }> {
  const response = await apiInstance.post<{ added: number }>(
    `/integrations/social-media/${channelId}/google-play/apps`,
    input,
  );
  return response.data;
}

export async function disconnectSocialMediaDesk(channelId: string): Promise<void> {
  await apiInstance.post(`/integrations/social-media/${channelId}/disconnect`);
}

export async function fetchSocialMediaReviews(
  channelId: string,
  range?: { startDate: string; endDate: string },
): Promise<
  { synced: number; sourceCount: number } | { success: true; queued: true; jobId: string }
> {
  const response = await apiInstance.post<
    { synced: number; sourceCount: number } | { success: true; queued: true; jobId: string }
  >(`/integrations/social-media/${channelId}/sync`, range);
  return response.data;
}

export async function disconnectGooglePlayApp(channelId: string, sourceId: string): Promise<void> {
  await apiInstance.post(
    `/integrations/social-media/${channelId}/google-play/apps/${sourceId}/disconnect`,
  );
}

export async function reconnectGooglePlayApp(channelId: string, sourceId: string): Promise<void> {
  await apiInstance.post(
    `/integrations/social-media/${channelId}/google-play/apps/${sourceId}/reconnect`,
  );
}

export async function rotateGooglePlayCredentials(
  channelId: string,
  serviceAccountKey: string,
): Promise<void> {
  await apiInstance.post(`/integrations/social-media/${channelId}/google-play/credentials`, {
    serviceAccountKey,
  });
}

export interface AppStoreCredentialsInput {
  keyId: string;
  privateKey: string;
}

/** App Store Connect authenticates with a signed JWT, so connecting is one POST — no OAuth. */
export async function connectAppStoreDesk(
  input: AppStoreCredentialsInput & {
    channelName: string;
    applications: Array<{ bundleId: string }>;
    projectId: string;
    boardId: string;
    assigneeUserGroupId?: string;
    visibility: 'PUBLIC' | 'PRIVATE';
  },
): Promise<string> {
  const response = await apiInstance.post<{ channelId: string }>(
    '/integrations/social-media/app-store/connect',
    input,
  );
  return response.data.channelId;
}

export async function addAppStoreApps(
  channelId: string,
  input: { applications: Array<{ bundleId: string }> },
): Promise<{ added: number }> {
  const response = await apiInstance.post<{ added: number }>(
    `/integrations/social-media/${channelId}/app-store/apps`,
    input,
  );
  return response.data;
}

export async function setAppStoreAppConnection(
  channelId: string,
  sourceId: string,
  connected: boolean,
): Promise<void> {
  await apiInstance.post(
    `/integrations/social-media/${channelId}/app-store/apps/${sourceId}/${
      connected ? 'reconnect' : 'disconnect'
    }`,
  );
}

/** Initiates Instagram Business OAuth — returns authorization URL for redirect. */
export async function startInstagramOAuth(input: {
  channelName: string;
  projectId: string;
  boardId?: string;
  assigneeUserGroupId?: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  platform: 'web' | 'electron';
}): Promise<string> {
  const response = await apiInstance.post<{ authorizationUrl: string }>(
    '/integrations/social-media/instagram/oauth/start',
    { name: input.channelName, ...input },
  );
  return response.data.authorizationUrl;
}

export async function disconnectInstagramDesk(channelId: string): Promise<void> {
  await apiInstance.post(`/integrations/social-media/${channelId}/instagram/disconnect`);
}

export async function disconnectInstagramAccount(
  channelId: string,
  sourceId: string,
): Promise<void> {
  await apiInstance.post(
    `/integrations/social-media/${channelId}/instagram/${sourceId}/disconnect`,
  );
}

export async function reconnectInstagramAccount(
  channelId: string,
  sourceId: string,
  platform: 'web' | 'electron',
): Promise<string> {
  const response = await apiInstance.post<{ authorizationUrl: string }>(
    `/integrations/social-media/${channelId}/instagram/${sourceId}/reconnect`,
    { platform },
  );
  return response.data.authorizationUrl;
}

export async function addInstagramAccount(
  channelId: string,
  platform: 'web' | 'electron',
): Promise<string> {
  const response = await apiInstance.post<{ authorizationUrl: string }>(
    `/integrations/social-media/${channelId}/instagram/add-account`,
    { platform },
  );
  return response.data.authorizationUrl;
}

export async function reconnectInstagramDesk(
  channelId: string,
  platform: 'web' | 'electron',
): Promise<string> {
  const response = await apiInstance.post<{ authorizationUrl: string }>(
    `/integrations/social-media/${channelId}/instagram/reconnect`,
    { platform },
  );
  return response.data.authorizationUrl;
}

/** Initiates Facebook Login for a Page desk — returns authorization URL for redirect. */
export async function startFacebookOAuth(input: {
  channelName: string;
  projectId: string;
  boardId?: string;
  assigneeUserGroupId?: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  platform: 'web' | 'electron';
}): Promise<string> {
  const response = await apiInstance.post<{ authorizationUrl: string }>(
    '/integrations/social-media/facebook/oauth/start',
    { name: input.channelName, ...input },
  );
  return response.data.authorizationUrl;
}

export async function disconnectFacebookPage(channelId: string, sourceId: string): Promise<void> {
  await apiInstance.post(`/integrations/social-media/${channelId}/facebook/${sourceId}/disconnect`);
}

export async function reconnectFacebookPage(
  channelId: string,
  sourceId: string,
  platform: 'web' | 'electron',
): Promise<string> {
  const response = await apiInstance.post<{ authorizationUrl: string }>(
    `/integrations/social-media/${channelId}/facebook/${sourceId}/reconnect`,
    { platform },
  );
  return response.data.authorizationUrl;
}

export async function addFacebookPage(
  channelId: string,
  platform: 'web' | 'electron',
): Promise<string> {
  const response = await apiInstance.post<{ authorizationUrl: string }>(
    `/integrations/social-media/${channelId}/facebook/add-page`,
    { platform },
  );
  return response.data.authorizationUrl;
}

/** Apple keys are rotated by pasting a new .p8, not by re-running a consent redirect. */
export async function rotateAppStoreCredentials(
  channelId: string,
  input: AppStoreCredentialsInput,
): Promise<void> {
  await apiInstance.post(`/integrations/social-media/${channelId}/app-store/credentials`, input);
}

// ── X ────────────────────────────────────────────────────────────────────────
// Each customer brings their own X developer app; its four keys travel with every connect call.

export interface XAppKeys {
  clientId: string;
  clientSecret: string;
  consumerKey: string;
  consumerSecret: string;
}

export interface XAccountStatus {
  id: string;
  isActive: boolean;
  xchatEnabled: boolean;
  hasAppKeys: boolean;
  /** ISO time of the last complete poll (manual sync or stream gap repair). */
  lastSyncedAt: string | null;
}

/** The exact URL the customer must add to their X app's callback URLs. */
export async function getXCallbackUrl(): Promise<string> {
  const response = await apiInstance.get<{ callbackUrl: string }>(
    '/integrations/social-media/x/oauth/callback-url',
  );
  return response.data.callbackUrl;
}

/** Validates the app keys, then returns X's authorization URL for a new X desk. */
export async function startXOAuth(input: {
  channelName: string;
  projectId: string;
  boardId?: string;
  assigneeUserGroupId?: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  platform: 'web' | 'electron';
  app: XAppKeys;
}): Promise<string> {
  const response = await apiInstance.post<{ authorizationUrl: string }>(
    '/integrations/social-media/x/oauth/start',
    { name: input.channelName, ...input },
  );
  return response.data.authorizationUrl;
}

/** Keys omitted ⇒ the backend reuses the app of an account already on this desk. */
export async function addXAccount(
  channelId: string,
  platform: 'web' | 'electron',
  app?: XAppKeys,
): Promise<string> {
  const response = await apiInstance.post<{ authorizationUrl: string }>(
    `/integrations/social-media/${channelId}/x/add-account`,
    { platform, ...(app && { app }) },
  );
  return response.data.authorizationUrl;
}

/** Keys omitted ⇒ the stored keys are reused; pass new ones after regenerating them on X. */
export async function reconnectXAccount(
  channelId: string,
  sourceId: string,
  platform: 'web' | 'electron',
  app?: XAppKeys,
): Promise<string> {
  const response = await apiInstance.post<{ authorizationUrl: string }>(
    `/integrations/social-media/${channelId}/x/${sourceId}/reconnect`,
    { platform, ...(app && { app }) },
  );
  return response.data.authorizationUrl;
}

export async function disconnectXAccount(channelId: string, sourceId: string): Promise<void> {
  await apiInstance.post(`/integrations/social-media/${channelId}/x/${sourceId}/disconnect`);
}

export async function getXAccounts(
  channelId: string,
): Promise<{ callbackUrl: string; accounts: XAccountStatus[] }> {
  const response = await apiInstance.get<{ callbackUrl: string; accounts: XAccountStatus[] }>(
    `/integrations/social-media/${channelId}/x/accounts`,
  );
  return response.data;
}

/** Unlocks the account's XChat keys with its passcode (used once, never stored). */
export async function enableXChat(
  channelId: string,
  sourceId: string,
  passcode: string,
): Promise<void> {
  await apiInstance.post(`/integrations/social-media/${channelId}/x/${sourceId}/xchat`, {
    passcode,
  });
}

export async function disableXChat(channelId: string, sourceId: string): Promise<void> {
  await apiInstance.delete(`/integrations/social-media/${channelId}/x/${sourceId}/xchat`);
}

/** Backend error code (`code` on 4xx bodies), e.g. x_invalid_api_key. */
export function getXErrorCode(error: unknown): string | undefined {
  const code = (error as { response?: { data?: { code?: unknown } } })?.response?.data?.code;
  return typeof code === 'string' ? code : undefined;
}

/** X's remaining XChat passcode attempts from a failed enableXChat, when X reported it. */
export function getXChatGuessesRemaining(error: unknown): number | null {
  const n = (error as { response?: { data?: { guessesRemaining?: unknown } } })?.response?.data
    ?.guessesRemaining;
  return typeof n === 'number' ? n : null;
}
