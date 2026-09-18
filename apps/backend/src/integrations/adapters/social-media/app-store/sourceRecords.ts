import crypto from 'crypto';
import { ExternalSourcePlatform } from '@/integrations/core/types';

export function buildAppStoreSourceName(workspaceId: string, appId: string): string {
  return [
    ExternalSourcePlatform.APP_STORE,
    crypto.createHash('sha256').update(`${workspaceId}:${appId}`).digest('hex').slice(0, 20),
  ].join('-');
}

export function buildAppStoreSourceRecords(params: {
  workspaceId: string;
  channelId: string;
  boardId: string;
  ownerUserId: string;
  encryptedCredentials: string;
  applications: Array<{
    appId: string;
    displayName: string;
  }>;
}) {
  const connectedAt = new Date().toISOString();
  return params.applications.map((application) => ({
    name: buildAppStoreSourceName(params.workspaceId, application.appId),
    sourceType: ExternalSourcePlatform.APP_STORE,
    displayName: application.displayName,
    channelId: params.channelId,
    // Apple's numeric app id: the only identifier the reviews endpoint accepts.
    externalIdentifier: application.appId,
    workspaceId: params.workspaceId,
    boardId: params.boardId,
    ownerUserId: params.ownerUserId,
    credentials: params.encryptedCredentials,
    lastSyncCursor: connectedAt,
  }));
}
