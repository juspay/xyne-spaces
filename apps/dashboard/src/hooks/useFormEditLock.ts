import { AccessType } from '@xyne/shared';
import { computeFormEditLock } from '../utils/form/formEditLock';
import { useAuth } from './useAuth';
import { usePermissions } from './usePermissions';

export { computeFormEditLock };

const FORMS_RESOURCE_NAME = 'FORMS';

/**
 * Pre-locks a form editor for users the server would reject, mirroring the REST write gate
 * (`isFormAccessibleToUser` in formController): creator, org/workspace OWNER or ADMIN, or a
 * FORMS resource WRITE/ADMIN grant. Permissions come from the session and are not
 * project-scoped, so the result is the same on every surface the editor is mounted on.
 */
export const useFormEditLock = (
  createdBy: string | null | undefined,
): { locked: boolean; lockedReason: string | undefined } => {
  const { user } = useAuth();
  const permissions = usePermissions();

  const isAdmin =
    user?.role === 'ADMIN' ||
    user?.role === 'OWNER' ||
    user?.orgRole === 'ADMIN' ||
    user?.orgRole === 'OWNER' ||
    permissions.some(
      permission =>
        permission.resourceName === FORMS_RESOURCE_NAME &&
        (permission.accessType === AccessType.WRITE || permission.accessType === AccessType.ADMIN),
    );

  const locked = computeFormEditLock({ createdBy, currentUserId: user?.id, isAdmin });
  return {
    locked,
    lockedReason: locked
      ? 'Only the creator of this form or a Forms admin can edit it. You can view it.'
      : undefined,
  };
};
