import { ConnectionState, type Room } from 'livekit-client';

export const AGENT_LEFT_CONFIRM_DELAY_MS = 2000;

export function isTranscriptionAgentIdentity(identity: string): boolean {
  return identity.startsWith('agent-');
}

/**
 * The agent sits in every call to transcribe, so its tile is just noise until someone
 * actually invokes it via the AI button. Callers pass `showAgent` = agent invoked
 * (and transcription on); otherwise the agent tile is dropped from the tile list.
 */
export function filterAgentTiles<T extends { identity: string }>(
  participants: T[],
  showAgent: boolean,
): T[] {
  return showAgent
    ? participants
    : participants.filter(p => !isTranscriptionAgentIdentity(p.identity));
}

export function shouldConfirmTranscriptionAgentLeft(room: Room): boolean {
  if (room.state !== ConnectionState.Connected) return false;

  return !Array.from(room.remoteParticipants.values()).some(participant =>
    isTranscriptionAgentIdentity(participant.identity),
  );
}
