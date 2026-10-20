import { memo, type ReactElement } from 'react';
import { View } from 'react-native';

import { AVATAR_GEOMETRY, AvatarFace } from '@/src/ui/avatar';

const RING = 2;

type OverlappingAvatarsProps = {
  userIds: readonly string[];
  size: number;
  overlap: number;
};

/** A row of faces, each overlapping the last and cut out of it by a ring in the surface colour. */
export const OverlappingAvatars = memo(function OverlappingAvatars({
  userIds,
  size,
  overlap,
}: OverlappingAvatarsProps): ReactElement {
  const faceRadius = size / AVATAR_GEOMETRY.radiusDivisor;

  return (
    <View className='flex-row'>
      {userIds.map((userId, index) => (
        <View
          key={userId}
          className='border-spaces-background'
          style={{
            marginLeft: index === 0 ? 0 : -overlap,
            borderWidth: RING,
            borderRadius: faceRadius + RING,
            marginVertical: -RING,
          }}
        >
          <AvatarFace userId={userId} size={size} />
        </View>
      ))}
    </View>
  );
});
