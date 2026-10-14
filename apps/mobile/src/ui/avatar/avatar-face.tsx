import { Image } from 'expo-image';
import { memo, useCallback, useState, type ReactElement } from 'react';
import { Platform, Text, View, type ViewStyle } from 'react-native';

import { getAvatarAccentColor, useUserSnapshot } from '@/src/components/ui/avatar/avatar.utils';
import { forgetProfilePictureUri, useProfilePictureUri } from '@/src/hooks/useProfilePictureUri';

import { avatarRadius } from './avatar.geometry';
import type { AvatarFallbackUser } from './avatar.types';

/**
 * Up to two letters, from the first two words of the name.
 *
 * Not the classic `getInitials`, which returns one. The new design draws two
 * ("RS", "KS"), and one letter in a 32px squircle reads as a placeholder
 * rather than a person.
 */
function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map(word => Array.from(word)[0] ?? '');
  const initials = letters.join('').toUpperCase();
  return initials.length > 0 ? initials : '?';
}

type AvatarFaceProps = {
  userId: string;
  size: number;
  /** Overrides the squircle corner. The stack passes its own inset radius. */
  radius?: number;
  style?: ViewStyle;
  fallbackUser?: AvatarFallbackUser | undefined;
};

/**
 * One person, as a squircle.
 *
 * Identity resolution, the picture cache and the accent color are the classic
 * avatar's — shared on purpose, because none of them is a design decision. The
 * only thing this file owns is the shape.
 */
export const AvatarFace = memo(function AvatarFace({
  userId,
  size,
  radius,
  style,
  fallbackUser,
}: AvatarFaceProps): ReactElement {
  const user = useUserSnapshot(userId);
  const displayName =
    user?.displayName || user?.name || fallbackUser?.displayName || fallbackUser?.name || '';
  const picture = user ? user.picture : fallbackUser?.picture;
  const pictureUri = useProfilePictureUri(userId, picture);
  const imageKey = `${userId}:${picture ?? 'none'}`;
  const [failedImageKey, setFailedImageKey] = useState<string | null>(null);

  /**
   * A URI that no longer loads is a cached location whose file has gone — the
   * resolver hands those out without checking, so this is where that is found
   * out. Dropping the entry makes the next mount re-resolve instead of showing
   * initials for the rest of the install.
   */
  const onError = useCallback(() => {
    setFailedImageKey(imageKey);
    forgetProfilePictureUri(userId, picture);
  }, [imageKey, picture, userId]);

  const showImage = !!pictureUri && failedImageKey !== imageKey;
  const hasDisplayName = displayName.trim().length > 0;

  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: radius ?? avatarRadius(size),
          overflow: 'hidden',
          backgroundColor: getAvatarAccentColor(userId),
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      {showImage ? (
        <Image
          key={imageKey}
          allowDownscaling={Platform.OS === 'ios' ? false : true}
          cachePolicy='memory-disk'
          contentFit='cover'
          recyclingKey={imageKey}
          source={{ uri: pictureUri }}
          style={{ width: size, height: size }}
          transition={0}
          onError={onError}
        />
      ) : hasDisplayName ? (
        <Text
          style={{
            color: '#ffffff',
            fontSize: Math.max(10, Math.round(size * 0.36)),
            fontWeight: '600',
            letterSpacing: 0.2,
          }}
        >
          {initialsFor(displayName)}
        </Text>
      ) : null}
    </View>
  );
});
