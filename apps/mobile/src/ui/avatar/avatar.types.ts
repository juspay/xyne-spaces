import type { ReactNode } from 'react';
import type { ViewStyle } from 'react-native';

import type { AvatarFallbackUser } from '@/src/components/ui/avatar/avatar.types';

/**
 * Re-exported rather than redeclared. The new avatar is a different look at
 * the same data, so the shape it accepts must not drift from the one every
 * caller already builds.
 */
export type { AvatarFallbackUser };

export type AvatarProps = {
  /** User ids to render. Empty renders nothing. */
  userIds: readonly string[];
  /** Cold-start identities, for while the global user list is still hydrating. */
  fallbackUsers?: readonly AvatarFallbackUser[];
  /**
   * How many people the group bubble counts, for a caller whose `userIds`
   * leaves someone out — the DM list's omits the current user, so a group of
   * three arrives as two ids. Defaults to `userIds.length`.
   */
  memberCount?: number;
  /** Outer slot size in px. Default 40, the DM row. */
  size?: number;
  /**
   * Drawn centred in a circle cut into the bottom-right corner of the front
   * face, sized by `avatarCornerBadgeSize`. The DM list's star.
   */
  cornerBadge?: ReactNode;
  style?: ViewStyle;
};
