/**
 * Query Builder Field Mappings
 *
 * Detects and maps relationship/reference fields to dynamic dropdowns.
 * Follows the DB naming convention: field names ending with 'Id' or known field names.
 */

/**
 * Detect field type based on name
 * Uses exact database field names from schema.prisma (case-sensitive)
 * Works for multiple models: Ticket, UserWorkloadMapping, UserExpertiseMapping, etc.
 *
 * Ticket model user/relationship fields:
 * - createdBy, updatedBy, assignedTo, closedBy → 'user'
 * - userGroupId → 'userGroup'
 * - projectId → 'project'
 * - boardId → 'board'
 *
 * UserWorkloadMapping model user/relationship fields:
 * - userId, createdBy → 'user'
 * - userGroupId → 'userGroup'
 * - boardId → 'board'
 *
 * UserExpertiseMapping model user/relationship fields:
 * - userId, createdBy → 'user'
 * - userGroupId → 'userGroup'
 * - boardId → 'board'
 */
export function detectFieldType(
  fieldName: string,
): 'userGroup' | 'user' | 'project' | 'board' | 'channel' | null {
  if (!fieldName) return null;

  // Exact field names from database schema

  // User-related fields (Foreign keys to User model)
  // Found in: Ticket, UserWorkloadMapping, UserExpertiseMapping, SubTicket, etc.
  if (
    fieldName === 'userId' || // UserWorkloadMapping, UserExpertiseMapping, etc.
    fieldName === 'createdBy' || // Ticket, UserWorkloadMapping, UserExpertiseMapping, SubTicket
    fieldName === 'updatedBy' || // Ticket, SubTicket
    fieldName === 'assignedTo' || // Ticket, SubTicket
    fieldName === 'closedBy' // Ticket
  ) {
    return 'user';
  }

  // UserGroup-related fields
  // Found in: Ticket, UserWorkloadMapping, UserExpertiseMapping, etc.
  if (fieldName === 'userGroupId') {
    return 'userGroup';
  }

  // Project-related fields
  // Found in: Ticket
  if (fieldName === 'projectId') {
    return 'project';
  }

  // Board-related fields
  // Found in: Ticket, UserWorkloadMapping, UserExpertiseMapping, SubTicket, etc.
  if (fieldName === 'boardId') {
    return 'board';
  }

  // Channel-related fields
  // Found in: Ticket, EmailThread, ExternalMessage, etc.
  if (fieldName === 'channelId') {
    return 'channel';
  }

  return null;
}

/**
 * Convert user group data to dropdown options
 */
export function userGroupsToOptions(userGroups: Array<{ id: string; name: string }> | undefined) {
  if (!userGroups || userGroups.length === 0) return [];
  return userGroups.map(ug => ({
    name: ug.id,
    label: ug.name || ug.id,
  }));
}

/**
 * Convert users data to dropdown options
 */
export function usersToOptions(
  users: Array<{ id: string; name?: string; email?: string }> | undefined,
) {
  if (!users || users.length === 0) return [];
  return users.map(u => ({
    name: u.id,
    label: u.name || u.email || u.id,
  }));
}

/**
 * Get label for an option value
 */
export function getOptionLabel(
  optionValue: string,
  optionsList: Array<{ name: string; label: string }> | undefined,
): string {
  if (!optionsList) return optionValue;
  return optionsList.find(opt => opt.name === optionValue)?.label || optionValue;
}
