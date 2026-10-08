/**
 * Client mirror of the REST write gate (`isFormAccessibleToUser` in formController): the
 * creator, an org/workspace OWNER or ADMIN, or a FORMS resource WRITE/ADMIN grant may edit.
 * A form with no known creator is never locked client-side — the server stays authoritative.
 */
export const computeFormEditLock = ({
  createdBy,
  currentUserId,
  isAdmin,
}: {
  createdBy: string | null | undefined;
  currentUserId: string | null | undefined;
  isAdmin: boolean;
}): boolean => Boolean(createdBy) && createdBy !== currentUserId && !isAdmin;
