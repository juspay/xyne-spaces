import { isStatusExpired } from './statusUtils';
import { UserStatus } from '@xyne/shared';
import type { User } from '../machines/stateMachine';
import type { MentionResult } from '../components/ui/Selectors';

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
