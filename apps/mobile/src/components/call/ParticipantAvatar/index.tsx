import React, { memo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';

import XyneAILogo from '../../../../assets/images/Xyne_Spaces-Default-1024x1024.png';
import { CircleRing } from '../CircleRing';
import { callColors } from '../callTheme';
import { getInitials } from '../../ui/avatar/avatar.utils';
import { getAvatarColors } from '../callStage.utils';
import { SpeakingBadge } from './SpeakingBadge';
import { RingPulse } from './RingPulse';

interface ParticipantAvatarProps {
  /** Stable id (LiveKit identity / user id) — picks the fallback colour. */
  identity: string;
  name: string;
  pictureUri?: string | null | undefined;
  isAgent?: boolean;
  size: number;
  /** Pulses rings behind the avatar (an invitee being called, the incoming-call screen). */
  ringing?: boolean;
  /** Ring colour; defaults to the neutral call tone. */
  ringColor?: string;
  /** Shows the small audio-bars badge. */
  speaking?: boolean;
}

/** Faint edge so a dark photo doesn't melt into the dark stage. */
const RING_COLOR = 'rgba(255,255,255,0.18)';

/** Circular participant avatar: photo, coloured initial, or the Xyne AI mark for the agent. */
export const ParticipantAvatar = memo(function ParticipantAvatar({
  identity,
  name,
  pictureUri,
  isAgent = false,
  size,
  ringing = false,
  ringColor = callColors.textSecondary,
  speaking = false,
}: ParticipantAvatarProps): React.ReactElement {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const colors = getAvatarColors(identity);
  const showPicture = !!pictureUri && failedUri !== pictureUri;

  return (
    <View style={{ width: size, height: size }}>
      {ringing ? (
        <View pointerEvents='none' style={styles.rippleLayer}>
          <RingPulse size={size} color={ringColor} />
        </View>
      ) : null}
      <View
        style={[
          styles.circle,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: isAgent ? callColors.surface : colors.avatar,
          },
        ]}
      >
        {isAgent ? (
          <Image source={XyneAILogo} style={StyleSheet.absoluteFill} contentFit='cover' />
        ) : showPicture ? (
          <Image
            source={{ uri: pictureUri! }}
            style={StyleSheet.absoluteFill}
            contentFit='cover'
            cachePolicy='memory-disk'
            onError={() => setFailedUri(pictureUri!)}
          />
        ) : (
          <Text style={[styles.initial, { fontSize: Math.round(size * 0.42) }]}>
            {getInitials(name)}
          </Text>
        )}
      </View>
      <CircleRing size={size} color={RING_COLOR} />
      {speaking ? (
        <View pointerEvents='none' style={styles.speakingBadgeLayer}>
          <SpeakingBadge size={Math.max(18, Math.round(size * 0.28))} />
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  rippleLayer: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speakingBadgeLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -10,
    alignItems: 'center',
  },
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initial: {
    color: callColors.onColor,
    fontWeight: '700',
  },
});
