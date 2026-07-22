import type { MentionResult } from '../types/mention.js';

interface UserLike {
  id: string;
  name?: string | null;
  email?: string | null;
  displayName?: string | null;
  picture?: string | null;
}

export function getMentionDisplayName(user: UserLike | undefined | null): string {
  if (!user) return 'Unknown';
  return user.displayName || user.name || user.email || 'Unknown';
}

export function getUserPicture(name: string, picture: string | null | undefined): string {
  if (picture) return picture;
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0ea5e9&color=fff`;
}

/**
 * Map a user to the MentionResult shape used by the @-mention pickers.
 * `isChannelMember` is omitted when undefined so the UI can distinguish
 * "not a member" from "membership not yet known".
 */
export function userToMentionResult(
  u: UserLike,
  isCurrentUser: boolean,
  isChannelMember?: boolean,
): MentionResult {
  const displayName = getMentionDisplayName(u);
  return {
    id: u.id,
    name: isCurrentUser ? `${displayName} (you)` : displayName,
    username: displayName,
    type: 'user' as const,
    email: u.email ?? undefined,
    picture: getUserPicture(displayName, u.picture),
    avatar: displayName.charAt(0).toUpperCase(),
    ...(isChannelMember !== undefined && { isChannelMember }),
  };
}
