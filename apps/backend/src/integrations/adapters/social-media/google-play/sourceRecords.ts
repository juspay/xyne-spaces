import crypto from 'crypto';
import { SOCIAL_MEDIA_SOURCE_TYPES } from '@/integrations/social-media/constants';

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
  return params.applications.map((application) => ({
    name: [
      SOCIAL_MEDIA_SOURCE_TYPES.GOOGLE_PLAY,
      crypto
        .createHash('sha256')
        .update(`${params.workspaceId}:${application.packageName}`)
        .digest('hex')
        .slice(0, 20),
    ].join('-'),
    sourceType: SOCIAL_MEDIA_SOURCE_TYPES.GOOGLE_PLAY,
    displayName: application.displayName,
    channelId: params.channelId,
    externalIdentifier: application.packageName,
    workspaceId: params.workspaceId,
    boardId: params.boardId,
    ownerUserId: params.ownerUserId,
    credentials: params.encryptedCredentials,
  }));
}
