import crypto from 'crypto';
import { ExternalSourcePlatform } from '@/integrations/core/types';

export function buildGooglePlaySourceRecords(params: {
  workspaceId: string;
  channelId: string;
  boardId: string;
  ownerUserId: string;
  encryptedCredentials: string;
  applications: Array<{
    packageName: string;
    displayName: string;
  }>;
}) {
  const connectedAt = new Date().toISOString();
  return params.applications.map((application) => ({
    name: [
      ExternalSourcePlatform.GOOGLE_PLAY,
      crypto
        .createHash('sha256')
        .update(`${params.workspaceId}:${application.packageName}`)
        .digest('hex')
        .slice(0, 20),
    ].join('-'),
    sourceType: ExternalSourcePlatform.GOOGLE_PLAY,
    displayName: application.displayName,
    channelId: params.channelId,
    externalIdentifier: application.packageName,
    workspaceId: params.workspaceId,
    boardId: params.boardId,
    ownerUserId: params.ownerUserId,
    credentials: params.encryptedCredentials,
    lastSyncCursor: connectedAt,
  }));
}
