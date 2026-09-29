import { db } from '@/database/client';
import { ServiceAccountResourceType } from './constants';

/** A channel a member created through the service account's app becomes one the account may use. */
export async function connectCreatedChannel(args: {
  serviceAccountId: string;
  workspaceId: string;
  channelId: string;
  createdBy: string;
}): Promise<void> {
  await db.serviceAccountResource.createMany({
    data: [
      {
        serviceAccountId: args.serviceAccountId,
        workspaceId: args.workspaceId,
        resourceType: ServiceAccountResourceType.CHANNEL,
        resourceId: args.channelId,
        addedBy: args.createdBy,
      },
    ],
    skipDuplicates: true,
  });
}
