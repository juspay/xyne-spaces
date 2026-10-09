import { memo, useMemo, type ReactElement } from 'react';
import { View } from 'react-native';

import { AvatarFace } from './avatar-face';
import { AvatarStack } from './avatar-stack';
import type { AvatarProps } from './avatar.types';

/** The DM row's slot. Every other size is this one scaled. */
export const DEFAULT_AVATAR_SIZE = 40;

/** The DM list draws rows straight onto the screen background. */
const DEFAULT_RING_CLASS = 'border-spaces-background';

/**
 * The Spaces avatar: one squircle for a person, two stacked for a group.
 *
 * Takes the same props as the classic avatar and resolves identities through
 * the same hooks — this is a second look at the same data, not a second source
 * of it. What it does not take is `rounded`: the new design has one shape, and
 * a circle option would be a way to draw something the design does not have.
 *
 * `userIds` is already everyone but the current user (see
 * `getDmAvatarUserIds`), so its length is what the group bubble counts.
 */
export const Avatar = memo(function Avatar({
  userIds,
  fallbackUsers = [],
  size = DEFAULT_AVATAR_SIZE,
  ringClassName = DEFAULT_RING_CLASS,
  style,
}: AvatarProps): ReactElement | null {
  const validUserIds = useMemo(
    () => userIds.filter((id): id is string => typeof id === 'string' && id.length > 0),
    [userIds],
  );

  const [first, second] = validUserIds;

  if (first === undefined) {
    return null;
  }

  if (second === undefined) {
    return (
      <View style={style}>
        <AvatarFace
          key={first}
          userId={first}
          size={size}
          fallbackUser={fallbackUsers.find(user => user.id === first)}
        />
      </View>
    );
  }

  return (
    <View style={style}>
      <AvatarStack
        key={`${first}:${second}`}
        userIds={[first, second]}
        fallbackUsers={fallbackUsers}
        memberCount={validUserIds.length}
        size={size}
        ringClassName={ringClassName}
      />
    </View>
  );
});
