import type { Prisma } from '@prisma/client';

export type CallParticipantPreviewRow = {
  id: string;
  userId: string;
  isExternal: boolean;
  invitedAt: Date;
  respondedAt: Date | null;
  joinedAt: Date | null;
};

export type CallParticipantPreviewEntry = {
  userId: string;
  hasJoined: boolean;
};

const CALL_PARTICIPANT_PREVIEW_LIMIT = 4;

function timestamp(value: Date | null | undefined): number {
  return value?.getTime() ?? Number.POSITIVE_INFINITY;
}

function comparePreviewParticipants(
  left: CallParticipantPreviewRow,
  right: CallParticipantPreviewRow,
): number {
  const leftJoined = left.joinedAt !== null;
  const rightJoined = right.joinedAt !== null;

  if (leftJoined !== rightJoined) {
    return leftJoined ? -1 : 1;
  }

  if (leftJoined && rightJoined) {
    return (
      timestamp(left.joinedAt) - timestamp(right.joinedAt) ||
      timestamp(left.respondedAt) - timestamp(right.respondedAt) ||
      timestamp(left.invitedAt) - timestamp(right.invitedAt) ||
      left.id.localeCompare(right.id)
    );
  }

  return (
    timestamp(left.respondedAt) - timestamp(right.respondedAt) ||
    timestamp(left.invitedAt) - timestamp(right.invitedAt) ||
    left.id.localeCompare(right.id)
  );
}

export async function buildCallParticipantPreviewUserIds(
  tx: Prisma.TransactionClient,
  callId: string,
): Promise<string> {
  const participants = await tx.callParticipant.findMany({
    where: { callId },
    select: {
      id: true,
      userId: true,
      isExternal: true,
      invitedAt: true,
      respondedAt: true,
      joinedAt: true,
    },
  });

  return buildCallParticipantPreviewUserIdsFromRows(participants);
}

export function buildCallParticipantPreviewUserIdsFromRows(
  participants: readonly CallParticipantPreviewRow[],
): string {
  const sortedParticipants = [...participants].sort(comparePreviewParticipants);
  const previewEntries: CallParticipantPreviewEntry[] = sortedParticipants
    .filter(participant => !participant.isExternal)
    .slice(0, CALL_PARTICIPANT_PREVIEW_LIMIT)
    .map(participant => ({
      userId: participant.userId,
      hasJoined: participant.joinedAt !== null,
    }));

  return JSON.stringify(previewEntries);
}

export async function refreshCallParticipantPreview(
  tx: Prisma.TransactionClient,
  callId: string,
): Promise<void> {
  const participants = await tx.callParticipant.findMany({
    where: { callId },
    select: {
      id: true,
      userId: true,
      isExternal: true,
      invitedAt: true,
      respondedAt: true,
      joinedAt: true,
    },
  });
  const participantPreviewUserIds = buildCallParticipantPreviewUserIdsFromRows(participants);
  await tx.call.update({
    where: { id: callId },
    data: {
      participantCount: participants.length,
      participantPreviewUserIds,
    },
  });
}
