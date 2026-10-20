import { memo, type ReactElement } from 'react';
import { Text, View } from 'react-native';

import { AvatarCutout } from './avatar-cutout';
import { AvatarFace } from './avatar-face';
import { avatarLayout } from './avatar.geometry';
import type { AvatarFallbackUser } from './avatar.types';

type AvatarStackProps = {
  /** The two faces to draw, front first. */
  userIds: readonly [string, string];
  fallbackUsers?: readonly AvatarFallbackUser[];
  /** Everyone in the conversation, which is what the bubble counts. */
  memberCount: number;
  size: number;
};

/**
 * Two people, stacked, with the group's size in a bubble.
 *
 * The back face sits at the left of the slot and the front one at the right,
 * so the back shows as a sliver. The front face is cut out of the back one,
 * and the count bubble — at the front face's top-right corner — out of both,
 * each with a clear gap, so the shapes stay apart on any background.
 */
export const AvatarStack = memo(function AvatarStack({
  userIds,
  fallbackUsers = [],
  memberCount,
  size,
}: AvatarStackProps): ReactElement {
  const [frontUserId, backUserId] = userIds;
  const { faces, countBubble } = avatarLayout(size, { isGroup: true });
  const faceUserIds = [backUserId, frontUserId];

  return (
    <View style={{ width: size, height: size }}>
      {faces.map(({ rect, holes }, index) => {
        const userId = faceUserIds[index] ?? frontUserId;
        return (
          <View key={userId} style={{ position: 'absolute', left: rect.x, top: rect.y }}>
            <AvatarCutout width={rect.width} height={rect.height} holes={holes}>
              <AvatarFace
                userId={userId}
                size={rect.width}
                radius={rect.radius}
                fallbackUser={fallbackUsers.find(user => user.id === userId)}
              />
            </AvatarCutout>
          </View>
        );
      })}

      {countBubble ? (
        <View
          className='items-center justify-center rounded-full bg-spaces-surface'
          style={{
            position: 'absolute',
            left: countBubble.x,
            top: countBubble.y,
            width: countBubble.width,
            height: countBubble.height,
          }}
        >
          <Text
            className='text-spaces-foreground'
            style={{ fontSize: Math.max(9, Math.round(size * 0.26)), fontWeight: '600' }}
          >
            {memberCount}
          </Text>
        </View>
      ) : null}
    </View>
  );
});
