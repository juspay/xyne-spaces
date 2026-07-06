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
