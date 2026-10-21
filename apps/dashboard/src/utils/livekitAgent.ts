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

export type TranscriptionDisplayStatus = 'transcribing' | 'connecting' | 'off';

/**
 * The indicator combines the host's on/off intent with whether the agent is actually
 * present. `connecting` covers "meant to be on but the agent isn't here yet" (never joined,
 * or dropped and being redispatched) — it self-heals once the agent (re)joins.
 */
export function deriveTranscriptionDisplayStatus(args: {
  isTranscriptionEnabled: boolean;
  agentPresent: boolean;
}): TranscriptionDisplayStatus {
  if (!args.isTranscriptionEnabled) return 'off';
  return args.agentPresent ? 'transcribing' : 'connecting';
}
