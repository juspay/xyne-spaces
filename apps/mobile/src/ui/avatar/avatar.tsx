import { memo, useMemo, type ReactElement } from 'react';
import { View } from 'react-native';

import { AvatarFace } from './avatar-face';
import { AvatarStack } from './avatar-stack';
import type { AvatarProps } from './avatar.types';

/** The DM row's slot. Every other size is this one scaled. */
export const DEFAULT_AVATAR_SIZE = 40;

/**
 * The Spaces avatar: one squircle for a person, two stacked for a group, with
 * an optional badge cut into its bottom-right corner.
 *
 * Takes the same props as the classic avatar and resolves identities through
 * the same hooks — this is a second look at the same data, not a second source
 * of it. What it does not take is `rounded`: the new design has one shape, and
 * a circle option would be a way to draw something the design does not have.
 *
 * The bubble counts `memberCount`, falling back to `userIds.length`. The DM
 * list's `userIds` are everyone but the current user (see
 * `getDmAvatarUserIds`), so it passes the real head count itself.
 */
export const Avatar = memo(function Avatar({
  userIds,
  fallbackUsers = [],
  memberCount,
  size = DEFAULT_AVATAR_SIZE,
  cornerBadge,
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

  const hasCornerBadge = cornerBadge !== undefined && cornerBadge !== null;

  if (second === undefined && !hasCornerBadge) {
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
        key={second === undefined ? first : `${first}:${second}`}
        userIds={second === undefined ? [first] : [first, second]}
        fallbackUsers={fallbackUsers}
        memberCount={memberCount ?? validUserIds.length}
        size={size}
        cornerBadge={cornerBadge}
      />
    </View>
  );
});
