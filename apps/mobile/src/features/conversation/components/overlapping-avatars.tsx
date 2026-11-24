import { memo, type ReactElement } from 'react';
import { View } from 'react-native';

import { AVATAR_GEOMETRY, AvatarFace } from '@/src/ui/avatar';

import type { SelfFace } from '../hooks/use-self-face';
import { SenderFace } from './message-avatar';

const RING = 1.5;

type OverlappingAvatarsProps = {
  userIds: readonly string[];
  size: number;
  overlap: number;
  /** The ring's colour class, to match what the faces sit on; the screen background by default. */
  ringClassName?: string;
  /** When given, this user is drawn as the room draws you (initials on the identity colour). */
  self?: SelfFace | null | undefined;
};

/**
 * A row of faces, each overlapping the last and cut out of it by a ring in the
 * surface colour. The ring takes no layout space, so faces start `size - overlap` apart.
 */
export const OverlappingAvatars = memo(function OverlappingAvatars({
  userIds,
  size,
  overlap,
  ringClassName = 'border-spaces-background',
  self,
}: OverlappingAvatarsProps): ReactElement {
  const faceRadius = size / AVATAR_GEOMETRY.radiusDivisor;

  return (
    <View className='flex-row'>
      {userIds.map((userId, index) => (
        <View
          key={userId}
          className={ringClassName}
          style={{
            marginLeft: (index === 0 ? 0 : -overlap) - RING,
            marginRight: -RING,
            borderWidth: RING,
            borderRadius: faceRadius + RING,
            marginVertical: -RING,
          }}
        >
          {self && userId === self.id ? (
            <SenderFace userId={userId} displayName={self.name} isSelf size={size} />
          ) : (
            <AvatarFace userId={userId} size={size} />
          )}
        </View>
      ))}
    </View>
  );
});
