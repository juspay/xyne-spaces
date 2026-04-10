import { isStatusExpired } from './statusUtils';

/**
 * Get the display name for a user.
 * Priority: displayName > name > email
 */
export function getUserDisplayName(
  user:
    | {
        id?: string | undefined;
        name?: string | null | undefined;
        email?: string | null | undefined;
        displayName?: string | null | undefined;
        presenceStatus?:
          | {
              statusEmoji?: string | null | undefined;
              statusContent?: string | null | undefined;
              statusExpiryAt?: number | null | undefined;
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
  let baseName = 'Unknown';
  if (user.displayName) {
    baseName = user.displayName;
  } else if (user.name) {
    baseName = user.name;
  } else if (user.email) {
    baseName = user.email;
  }

  if (includeStatus && user.presenceStatus) {
    const { statusEmoji, statusExpiryAt } = user.presenceStatus;
    const hasValidStatus = statusEmoji && (!statusExpiryAt || !isStatusExpired(statusExpiryAt));
    if (hasValidStatus) {
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
        id?: string | undefined;
        name?: string | null | undefined;
        email?: string | null | undefined;
        displayName?: string | null | undefined;
      }
    | undefined
    | null,
): string {
  return user?.displayName || user?.name || user?.email || 'Unknown User';
}
