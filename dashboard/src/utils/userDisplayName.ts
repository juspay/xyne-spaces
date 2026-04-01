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
      }
    | undefined
    | null,
): string {
  if (!user) {
    return 'Unknown';
  }
  if (user.displayName) {
    return user.displayName;
  }
  if (user.name) {
    return user.name;
  }
  if (user.email) {
    return user.email;
  }
  return 'Unknown';
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
