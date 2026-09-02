import { isStatusExpired } from './statusUtils';
import { UserStatus } from '@xyne/shared';
import { matchesAllTokens } from '@xyne/shared/utils';
import type { User } from '../machines/stateMachine';
import type { MentionResult } from '@xyne/shared';

/**
 * Check if a user is deactivated (status is INACTIVE)
 */
export function isUserDeactivated(
  user:
    | {
        status?: UserStatus | string | null;
      }
    | undefined
    | null,
): boolean {
  if (!user) return false;
  return user.status === UserStatus.INACTIVE;
}

/**
 * Get the display name for a user.
 * Priority: displayName > name > email
 */
export function getUserDisplayName(
  user:
    | {
        id?: string;
        name?: string | null;
        email?: string | null;
        displayName?: string | null;
        presenceStatus?:
          | {
              statusEmoji?: string | null;
              statusExpiryAt?: number | null;
            }
          | null
          | undefined;
      }
    | undefined
    | null,
  includeStatus: boolean = false,
): string {
  if (!user) {
    return 'Unknown';
  }

  const baseName = user.displayName || user.name || user.email || 'Unknown';

  if (includeStatus && user.presenceStatus) {
    const { statusEmoji, statusExpiryAt } = user.presenceStatus;
    const hasValidStatus = statusEmoji && (!statusExpiryAt || !isStatusExpired(statusExpiryAt));
    if (hasValidStatus && !statusEmoji.startsWith('custom:')) {
      return `${baseName} ${statusEmoji}`;
    }
  }

  return baseName;
}

/**
 * Shared predicate for filtering users by a typed query — the standard the cmd+K / DM matchers use.
 * Matches BOTH `displayName` AND raw `name` (so a full-name query still hits a user whose displayName
 * is a short nickname), with `matchesAllTokens` for out-of-order / partial tokens; email stays a
 * whole-query substring match. Empty query matches everyone.
 */
export function matchesUserQuery(
  user: { name?: string | null; displayName?: string | null; email?: string | null },
  query: string,
): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;
  // Match displayName OR raw name independently — all tokens must appear within one of them, so a
  // nickname displayName and the full name are each searchable. Only run the displayName pass when
  // it's non-empty and distinct from name. Email is a whole-query substring.
  const name = user.name ?? '';
  return (
    matchesAllTokens(name, trimmed) ||
    (!!user.displayName &&
      user.displayName !== name &&
      matchesAllTokens(user.displayName, trimmed)) ||
    (user.email?.toLowerCase().includes(trimmed.toLowerCase()) ?? false)
  );
}

/**
 * Append a "(You)" marker to a label when it belongs to the current user.
 * Used by assignee pickers to surface and pin the logged-in user.
 *
 * The result carries a presentation suffix, so any downstream search/match
 * should run against the raw name/email, not this returned string.
 */
export function withYouLabel(label: string, isCurrentUser: boolean): string {
  return isCurrentUser ? `${label} (You)` : label;
}

/**
 * Get display name for a user by ID from a list of users
 */
export function getUserDisplayNameById(
  users: Array<{
    id: string;
    name?: string | null;
    email?: string | null;
    displayName?: string | null;
  }>,
  userId: string,
): string {
  const user = users.find(u => u.id === userId);
  if (!user) {
    return 'Unknown';
  }
  return getUserDisplayName(user);
}

/**
 * Get display name for labels in dropdowns/selects
 * Returns the display name, with email as secondary fallback
 * @param user - User object
 * @returns displayName, name, email, or 'Unknown User'
 */
export function getUserLabel(
  user:
    | {
        id?: string;
        name?: string | null;
        email?: string | null;
        displayName?: string | null;
      }
    | undefined
    | null,
): string {
  return user?.displayName || user?.name || user?.email || 'Unknown User';
}

/**
 * Resolve a user's avatar URL, falling back to a generated ui-avatars image.
 */
export function getUserPicture(name: string, picture: string | null): string {
  if (picture) return picture;
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0ea5e9&color=fff`;
}

/**
 * Map a User to the MentionResult shape used by the @-mention pickers.
 * `isChannelMember` is omitted when undefined so the UI can distinguish
 * "not a member" from "membership not yet known".
 */
export function userToMentionResult(
  u: User,
  isCurrentUser: boolean,
  isChannelMember?: boolean,
): MentionResult {
  const displayName = getUserDisplayName(u);
  return {
    id: u.id,
    name: isCurrentUser ? `${displayName} (you)` : displayName,
    username: displayName,
    type: 'user' as const,
    email: u.email,
    picture: getUserPicture(displayName, u.picture),
    avatar: displayName.charAt(0).toUpperCase(),
    ...(isChannelMember !== undefined && { isChannelMember }),
  };
}
