import { usePermissions } from '../../hooks/usePermissions';
import { AccessType } from '@xyne/shared';

const RESOURCE_NAME = 'AUTOMATIONS';

function hasAccess(
  permissions: ReturnType<typeof usePermissions>,
  minLevel: 'READ' | 'WRITE' | 'ADMIN',
): boolean {
  return permissions.some(p => {
    if (p.resourceName !== RESOURCE_NAME) return false;
    if (p.accessType === AccessType.ADMIN) return true;
    if (minLevel === 'WRITE' && p.accessType === AccessType.WRITE) return true;
    if (
      minLevel === 'READ' &&
      (p.accessType === AccessType.WRITE || p.accessType === AccessType.READ)
    )
      return true;
    return false;
  });
}

export function useIsAutomationsAdmin(): boolean {
  return hasAccess(usePermissions(), 'ADMIN');
}
