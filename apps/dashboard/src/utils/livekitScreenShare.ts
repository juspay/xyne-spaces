import { Track, type Participant } from 'livekit-client';

export function isScreenShareActive(participant: Participant | null | undefined): boolean {
  const publication = participant?.getTrackPublication(Track.Source.ScreenShare);
  return !!publication && publication.isSubscribed && !publication.isMuted;
}

export function isParticipantScreenShareEnabled(
  participant: Participant | null | undefined,
): boolean {
  if (!participant) return false;

  const publication = participant.getTrackPublication(Track.Source.ScreenShare);
  return participant.isScreenShareEnabled && publication?.isMuted !== true;
}
