import { memo, type ReactElement } from 'react';
import { Text, View } from 'react-native';

import { AvatarFace } from './avatar-face';
import { avatarBadgeSize, avatarRadius, avatarRing, groupFaceSize } from './avatar.geometry';
import type { AvatarFallbackUser } from './avatar.types';

type AvatarStackProps = {
  /** The two faces to draw, front first. */
  userIds: readonly [string, string];
  fallbackUsers?: readonly AvatarFallbackUser[];
  /** Everyone in the conversation, which is what the bubble counts. */
  memberCount: number;
  size: number;
  ringClassName: string;
};

/**
 * Two people, stacked, with the group's size in a bubble.
 *
 * The back face sits at the top-left corner of the slot and the front one at
 * the bottom-right, so the back shows as an L-shaped sliver. The front face
 * carries a border in the surface color, which reads as the front shape having
 * been cut out of the one behind it. Same trick for the bubble.
 *
 * Both faces are `faceRatio` of the slot and every offset falls out of that,
 * so nothing here can overflow the box the row reserved for it.
 */
export const AvatarStack = memo(function AvatarStack({
  userIds,
  fallbackUsers = [],
  memberCount,
  size,
  ringClassName,
}: AvatarStackProps): ReactElement {
  const [frontUserId, backUserId] = userIds;
  const faceSize = groupFaceSize(size);
  const ring = avatarRing(size);
  const offset = size - faceSize;
  const badgeSize = avatarBadgeSize(size);

  const frontFallback = fallbackUsers.find(user => user.id === frontUserId);
  const backFallback = fallbackUsers.find(user => user.id === backUserId);

  return (
    <View style={{ width: size, height: size }}>
      <View style={{ position: 'absolute', top: 0, left: 0 }}>
        <AvatarFace userId={backUserId} size={faceSize} fallbackUser={backFallback} />
      </View>

      {/*
        The ring is drawn inside this box, so the face is `faceSize` across
        including it. That keeps the front face within the slot while still
        separating it from the one behind.
      */}
      <View
        className={ringClassName}
        style={{
          position: 'absolute',
          top: 0,
          left: offset,
          width: faceSize,
          height: faceSize,
          borderWidth: ring,
          borderRadius: avatarRadius(faceSize) + ring,
        }}
      >
        <AvatarFace
          userId={frontUserId}
          size={faceSize - ring * 2}
          radius={avatarRadius(faceSize)}
          fallbackUser={frontFallback}
        />
      </View>

      <View
        className={ringClassName}
        style={{
          position: 'absolute',
          right: 0,
          bottom: 0,
          width: badgeSize,
          height: badgeSize,
          borderWidth: ring,
          borderRadius: badgeSize / 2,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View className='flex-1 w-full items-center justify-center rounded-full bg-spaces-surface'>
          <Text
            className='text-spaces-foreground'
            style={{ fontSize: Math.max(9, Math.round(size * 0.26)), fontWeight: '600' }}
          >
            {memberCount}
          </Text>
        </View>
      </View>
    </View>
  );
});
