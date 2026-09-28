import type { Participant } from 'livekit-client';

export interface JoinedExternalParticipant {
  readonly isExternal?: boolean | null | undefined;
  readonly joinedAt: number | null;
}

export function hasJoinedExternalParticipant(
  participants: readonly JoinedExternalParticipant[] | null | undefined,
): boolean {
  return (participants || []).some(
    participant => participant.isExternal === true && participant.joinedAt !== null,
  );
}

/** Profile-picture path the backend stamps into a LiveKit participant's metadata. */
export function getParticipantPicturePath(participant: Participant | undefined): string | null {
  const metadata = participant?.metadata;
  if (!metadata) return null;
  try {
    return (JSON.parse(metadata) as { picture?: string }).picture ?? null;
  } catch {
    return null;
  }
}
