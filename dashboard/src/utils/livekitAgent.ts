import { ConnectionState, type Room } from 'livekit-client';

export const AGENT_LEFT_CONFIRM_DELAY_MS = 2000;

export function isTranscriptionAgentIdentity(identity: string): boolean {
  return identity.startsWith('agent-');
}

export function shouldConfirmTranscriptionAgentLeft(room: Room): boolean {
  if (room.state !== ConnectionState.Connected) return false;

  return !Array.from(room.remoteParticipants.values()).some(participant =>
    isTranscriptionAgentIdentity(participant.identity),
  );
}
