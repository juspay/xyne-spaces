import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';

import { callColors } from '../callTheme';
import { getAvatarColors } from '../callStage.utils';

/**
 * `stage`: behind the whole call (and the ringing / connecting screens).
 * `tile`: behind one camera-off participant tile — a little stronger, on the lighter surface.
 */
type BackdropVariant = 'stage' | 'tile';

const VARIANTS: Record<
  BackdropVariant,
  {
    base: string;
    blurRadius: number;
    picture: { opacity: number; transform: { scale: number }[] };
    /** Gradient stops for a given tint colour, top to bottom. */
    gradient: (tint: string) => [string, string, ...string[]];
    locations: [number, number, ...number[]];
  }
> = {
  stage: {
    base: callColors.stage,
    blurRadius: 48,
    picture: { opacity: 0.55, transform: [{ scale: 1.25 }] },
    gradient: tint => [`${tint}E6`, `${tint}66`, `${callColors.stage}F2`],
    locations: [0, 0.45, 1],
  },
  tile: {
    base: callColors.surface,
    blurRadius: 36,
    picture: { opacity: 0.6, transform: [{ scale: 1.5 }] },
    gradient: tint => [`${tint}CC`, `${callColors.surface}F0`],
    locations: [0, 1],
  },
};

interface CallBackdropProps {
  /** Identity whose colour tints the backdrop (usually the person you're talking to). */
  tintIdentity?: string | undefined;
  /** Their photo, blurred behind everything — the WhatsApp voice-call look. */
  pictureUri?: string | null | undefined;
  variant?: BackdropVariant;
}

/**
 * Full-bleed backdrop: a deep base, a tint of the person's colour, and (when there is one) their
 * blurred photo, so voice layouts feel warm instead of flat black. Video covers it entirely.
 */
export const CallBackdrop = memo(function CallBackdrop({
  tintIdentity,
  pictureUri,
  variant = 'stage',
}: CallBackdropProps): React.ReactElement {
  const look = VARIANTS[variant];
  const tint = tintIdentity ? getAvatarColors(tintIdentity).background : '#1a2233';

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents='none'>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: look.base }]} />
      {pictureUri ? (
        <Image
          source={{ uri: pictureUri }}
          style={[StyleSheet.absoluteFill, look.picture]}
          contentFit='cover'
          blurRadius={look.blurRadius}
          cachePolicy='memory-disk'
        />
      ) : null}
      <LinearGradient
        colors={look.gradient(tint)}
        locations={look.locations}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
});
