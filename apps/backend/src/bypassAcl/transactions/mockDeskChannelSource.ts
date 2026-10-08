import { transaction } from '../base';
import { db } from '@/database/client';

export interface MockDeskChannelSourceInput {
  name: string;
  workspaceId: string;
  userId: string;
  channelId: string;
  boardId: string;
  email: string;
  sourceType: string;
  /** Already-encrypted mock credentials string. */
  credentials: string;
}

/**
 * Test-only (DESK_MOCK): binds a mock mailbox ExternalSource to a Desk channel
 * and points the channel's email preference at a ticket board.
 */
export function upsertMockDeskChannelSourceTx(input: MockDeskChannelSourceInput) {
  const { name, workspaceId, userId, channelId, boardId, email, sourceType, credentials } = input;
  return transaction(['EmailChannelPreference', 'ExternalSource'], 'upsertMockDeskChannelSource: channel board preference and mock external source must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    // Upsert (not updateMany): a channel without an existing preference row
    // used to leave updateMany a silent 0-row no-op, producing a mock source
    // pointed at a channel with no ticket board. Upsert guarantees the
    // preference exists and targets the resolved board.
    await tx.emailChannelPreference.upsert({
      where: { channelId },
      create: { channelId, workspaceId, boardId },
      update: { boardId },
    });

    return tx.externalSource.upsert({
      where: { name },
      create: {
        name,
        workspaceId,
        sourceType,
        displayName: email,
        channelId,
        ownerUserId: userId,
        credentials,
        isActive: true,
      },
      update: {
        sourceType,
        displayName: email,
        channelId,
        ownerUserId: userId,
        credentials,
        isActive: true,
      },
    });
  });
}
