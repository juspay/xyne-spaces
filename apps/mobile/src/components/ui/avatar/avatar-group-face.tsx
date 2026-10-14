import { memo } from 'react';
import { View } from 'react-native';

import { AvatarFace } from './avatar-face';
import type { AvatarFallbackUser } from './avatar.types';

type AvatarGroupFaceProps = {
  userIds: readonly [string, string?];
  fallbackUsers?: readonly AvatarFallbackUser[];
  size: number;
};

/**
 * Group avatar — stacked cards: back face peeking from behind with a slight
 * rotation, front face on top with a separating border.
 */
export const AvatarGroupFace = memo(function AvatarGroupFace({
  userIds,
  fallbackUsers = [],
  size,
}: AvatarGroupFaceProps) {
  const frontUserId = userIds[0];
  const backUserId = userIds[1];
  const frontFallbackUser = fallbackUsers.find(user => user.id === frontUserId);
  const backFallbackUser = backUserId
    ? fallbackUsers.find(user => user.id === backUserId)
    : undefined;

  const tileRadius = Math.round(size * 0.25);
  const stackOffset = Math.round(size * -0.075);

  return (
    <View style={{ width: size, height: size, position: 'relative' }}>
      {backUserId ? (
        <View
          style={{
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: tileRadius,
            overflow: 'hidden',
            transform: [
              { translateX: stackOffset },
              { translateY: stackOffset },
              { rotate: '-10deg' },
            ],
          }}
        >
          <AvatarFace
            key={backUserId}
            userId={backUserId}
            size={size}
            rounded={false}
            {...(backFallbackUser ? { fallbackUser: backFallbackUser } : {})}
          />
        </View>
      ) : null}

      {frontUserId ? (
        <View
          style={{
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: tileRadius,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: '#181818',
          }}
        >
          <AvatarFace
            key={frontUserId}
            userId={frontUserId}
            size={size}
            rounded={false}
            {...(frontFallbackUser ? { fallbackUser: frontFallbackUser } : {})}
          />
        </View>
      ) : null}
    </View>
  );
});
