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
   * The surface the avatar sits on, as a Uniwind border class.
   *
   * The stack separates its two faces with a ring in this color, so it has to
   * match what is actually behind the avatar. Defaults to the screen
   * background, which is where the DM list puts it.
   */
  ringClassName?: string;
  style?: ViewStyle;
};
