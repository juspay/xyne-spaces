import crypto from 'crypto';
import { ExternalSourcePlatform } from '@/integrations/core/types';

export function buildAppStoreSourceName(workspaceId: string, bundleId: string): string {
  return [
    ExternalSourcePlatform.APP_STORE,
    crypto.createHash('sha256').update(`${workspaceId}:${bundleId}`).digest('hex').slice(0, 20),
  ].join('-');
}

export function buildAppStoreSourceRecords(params: {
  workspaceId: string;
  channelId: string;
  boardId: string;
  ownerUserId: string;
  encryptedCredentials: string;
  applications: Array<{
    bundleId: string;
    displayName: string;
  }>;
}) {
  const connectedAt = new Date().toISOString();
  return params.applications.map((application) => ({
    name: buildAppStoreSourceName(params.workspaceId, application.bundleId),
    sourceType: ExternalSourcePlatform.APP_STORE,
    displayName: application.displayName,
    channelId: params.channelId,
    // The bundle id, not Apple's numeric app id: it is the identifier users type and read, and the
    // numeric one is re-resolved from it on demand.
    externalIdentifier: application.bundleId,
    workspaceId: params.workspaceId,
    boardId: params.boardId,
    ownerUserId: params.ownerUserId,
    credentials: params.encryptedCredentials,
    lastSyncCursor: connectedAt,
  }));
}
