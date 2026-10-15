import type { ViewStyle } from 'react-native';

export type AvatarFallbackUser = {
  id: string;
  name?: string;
  displayName?: string;
  picture?: string | null;
};

export type AvatarProps = {
  /** User ids to render. Empty array renders nothing. */
  userIds: readonly string[];
  /** Cold-start fallback identity while the global users list is still hydrating. */
  fallbackUsers?: readonly AvatarFallbackUser[];
  /** Outer avatar size in px. Default: 48 (chat list size). */
  size?: number;
  style?: ViewStyle;
  rounded?: boolean;
};
