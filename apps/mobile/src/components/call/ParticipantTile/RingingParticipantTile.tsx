import React, { memo } from 'react';

import { useParticipantPicture } from '../hooks/useParticipantPicture';
import type { RingingInvitee } from '../callRoster.utils';
import type { StageInsets, TileVariant } from '../callStage.utils';
import { ParticipantTileView } from './ParticipantTileView';

interface RingingParticipantTileProps {
  invitee: RingingInvitee;
  variant: TileVariant;
  width: number;
  height: number;
  insets?: StageInsets;
}

/**
 * Placeholder for an invitee who is being rung (1:1 DM calls only): their avatar plus the ring
 * label the backend reports — Calling… / Ringing… / On another call.
 */
export const RingingParticipantTile = memo(function RingingParticipantTile({
  invitee,
  variant,
  width,
  height,
  insets,
}: RingingParticipantTileProps): React.ReactElement {
  const pictureUri = useParticipantPicture(invitee.userId);
  return (
    <ParticipantTileView
      variant={variant}
      width={width}
      height={height}
      identity={invitee.userId}
      name={invitee.name}
      isLocal={false}
      isAgent={false}
      pictureUri={pictureUri}
      isMicMuted={false}
      isSpeaking={false}
      ringStatus={invitee.ringStatus}
      {...(insets ? { insets } : {})}
    />
  );
});
