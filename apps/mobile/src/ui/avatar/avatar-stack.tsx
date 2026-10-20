import { memo, type ReactElement, type ReactNode } from 'react';
import { Text, View } from 'react-native';

import { AvatarCutout } from './avatar-cutout';
import { AvatarFace } from './avatar-face';
import { avatarLayout } from './avatar.geometry';
import type { AvatarFallbackUser } from './avatar.types';

type AvatarStackProps = {
  /** The faces to draw, front first: one person, or two for a group. */
  userIds: readonly [string] | readonly [string, string];
  fallbackUsers?: readonly AvatarFallbackUser[];
  /** Everyone in the conversation, which a group's bubble counts. */
  memberCount: number;
  size: number;
  /** Drawn centred in a cut-out at the front face's bottom-right corner. */
  cornerBadge?: ReactNode;
};

/**
 * The avatar's faces and what sits on them, each cut out of what lies below.
 *
 * A group stacks two people: the back face at the left of the slot and the
 * front one at the right, so the back shows as a sliver, with the group's size
 * in a bubble at the front face's top-right corner. A corner badge sits at the
 * front face's bottom-right. Every shape is cut out of the ones beneath it with
 * a clear gap, so they stay apart on any background.
 */
export const AvatarStack = memo(function AvatarStack({
  userIds,
  fallbackUsers = [],
  memberCount,
  size,
  cornerBadge,
}: AvatarStackProps): ReactElement {
  const [frontUserId, backUserId] = userIds;
  const hasCornerBadge = cornerBadge !== undefined && cornerBadge !== null;
  const layout = avatarLayout(size, { isGroup: backUserId !== undefined, hasCornerBadge });
  const { faces, countBubble } = layout;
  // Faces paint back to front.
  const faceUserIds = backUserId === undefined ? [frontUserId] : [backUserId, frontUserId];

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

      {layout.cornerBadge ? (
        <View
          pointerEvents='none'
          className='items-center justify-center'
          style={{
            position: 'absolute',
            left: layout.cornerBadge.x,
            top: layout.cornerBadge.y,
            width: layout.cornerBadge.width,
            height: layout.cornerBadge.height,
          }}
        >
          {cornerBadge}
        </View>
      ) : null}
    </View>
  );
});
