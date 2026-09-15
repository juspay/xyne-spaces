import type { ParticipantInfo } from '../../../machines/roomMachine';

/**
 * 3-tier comparator for human participant tiles.
 *
 * Full ordering (top-left → bottom-right):
 *   mic on + camera on + earliest joined
 *   mic on + camera on + later joined
 *   mic on + camera off + earliest joined
 *   mic on + camera off + later joined
 *   mic off + camera on + earliest joined
 *   ...
 *   mic off + camera off + latest joined
 *
 * Re-sorts automatically whenever the participants array changes — which the
 * room machine does on: join/leave, TrackMuted, TrackUnmuted, TrackSubscribed, TrackUnsubscribed.
 */
export function compareParticipants(a: ParticipantInfo, b: ParticipantInfo): number {
  // Tier 1: mic on first
  const aMic = a.isMicrophoneEnabled ? 0 : 1;
  const bMic = b.isMicrophoneEnabled ? 0 : 1;
  if (aMic !== bMic) return aMic - bMic;

  // Tier 2: camera on first
  const aCam = a.isCameraEnabled ? 0 : 1;
  const bCam = b.isCameraEnabled ? 0 : 1;
  if (aCam !== bCam) return aCam - bCam;

  // Tier 3: earlier joinedAt first (participants without joinedAt sort last)
  const aJoined = a.participant?.joinedAt?.getTime() ?? Infinity;
  const bJoined = b.participant?.joinedAt?.getTime() ?? Infinity;
  return aJoined - bJoined;
}

/**
 * Returns a sorted copy of the participants array.
 *
 * @param participants - source list (not mutated)
 * @param isAIEnabled  - when false, agent-* participants are exempted from
 *                       sorting and always appended at the end in their
 *                       original relative order. When true they participate
 *                       in the normal 3-tier sort alongside everyone else.
 */
/**
 * Returns the first non-local, non-agent participant for presentation mode.
 * Relies on the caller passing a pre-sorted array (sortParticipants output) so
 * that .find() lands on the most-active caller (mic→camera→joinedAt order).
 * MVP limitation: does not switch to active speaker dynamically.
 */
/**
 * The participant to feature on screen: a remote human if there is one, falling
 * back to ourselves when nobody else has joined.
 *
 * Named for what it returns rather than "remote presenter" — it can hand back the
 * local participant, and a name promising otherwise would mislead future callers.
 * The fallback exists for presentation mode: a telepresence wall alone in a room
 * should show itself rather than an empty "waiting for remote participant" screen,
 * which is its normal resting state rather than an error.
 */
export function findPresentationParticipant(
  participants: ParticipantInfo[],
  localParticipantId: string | null,
): ParticipantInfo | undefined {
  return (
    participants.find(p => p.identity !== localParticipantId && !p.identity.startsWith('agent-')) ??
    participants.find(p => p.identity === localParticipantId)
  );
}

export function sortParticipants(
  participants: ParticipantInfo[],
  isAIEnabled: boolean,
): ParticipantInfo[] {
  if (isAIEnabled) {
    return [...participants].sort(compareParticipants);
  }
  // Separate AI agents so they don't bubble up / down with the sort
  const agents: ParticipantInfo[] = [];
  const humans: ParticipantInfo[] = [];
  for (const p of participants) {
    if (p.identity.startsWith('agent-')) {
      agents.push(p);
    } else {
      humans.push(p);
    }
  }
  return [...humans.sort(compareParticipants), ...agents];
}
