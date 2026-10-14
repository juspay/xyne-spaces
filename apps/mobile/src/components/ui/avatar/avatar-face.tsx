import { Image } from 'expo-image';
import { memo, useCallback, useState } from 'react';
import { Text, View, type ViewStyle } from 'react-native';

import { getAvatarAccentColor, getInitials, useUserSnapshot } from './avatar.utils';
import { useProfilePictureUri } from '@/src/hooks/useProfilePictureUri';
import type { AvatarFallbackUser } from './avatar.types';

type AvatarFaceProps = {
  userId: string;
  size: number;
  rounded?: boolean;
  style?: ViewStyle;
  fallbackUser?: AvatarFallbackUser;
};

export const AvatarFace = memo(function AvatarFace({
  userId,
  size,
  rounded = true,
  style,
  fallbackUser,
}: AvatarFaceProps) {
  const user = useUserSnapshot(userId);
  const displayName =
    user?.displayName || user?.name || fallbackUser?.displayName || fallbackUser?.name || '';
  const picture = user ? user.picture : fallbackUser?.picture;
  const pictureUri = useProfilePictureUri(userId, picture);
  const imageKey = `${userId}:${picture ?? 'none'}`;
  const [failedImageKey, setFailedImageKey] = useState<string | null>(null);

  const hasDisplayName = displayName.trim().length > 0;
  const initials = getInitials(displayName);
  const accentColor = getAvatarAccentColor(userId);
  const borderRadius = rounded ? size / 2 : 8;
  const showImage = !!pictureUri && failedImageKey !== imageKey;

  const onError = useCallback(() => {
    setFailedImageKey(imageKey);
  }, [imageKey]);

  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius,
          overflow: 'hidden',
          backgroundColor: accentColor,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      {showImage ? (
        <Image
          key={imageKey}
          allowDownscaling={false}
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
            fontSize: Math.max(11, Math.round(size * 0.6)),
            fontWeight: '500',
          }}
        >
          {initials}
        </Text>
      ) : null}
    </View>
  );
});
