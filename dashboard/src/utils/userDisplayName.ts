import { isStatusExpired } from './statusUtils';

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
