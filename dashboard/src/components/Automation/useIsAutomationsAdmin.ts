import { usePermissions } from '../../hooks/usePermissions';

const RESOURCE_NAME = 'AUTOMATIONS';

function hasAccess(
  permissions: ReturnType<typeof usePermissions>,
  minLevel: 'READ' | 'WRITE' | 'ADMIN',
): boolean {
  return permissions.some(p => {
    if (p.resourceName !== RESOURCE_NAME) return false;
    if (p.accessType === 'ADMIN') return true;
    if (minLevel === 'WRITE' && p.accessType === 'WRITE') return true;
    if (minLevel === 'READ' && (p.accessType === 'WRITE' || p.accessType === 'READ')) return true;
    return false;
  });
}

export function useCanReadAutomations(): boolean {
  return hasAccess(usePermissions(), 'READ');
}

export function useCanWriteAutomations(): boolean {
  return hasAccess(usePermissions(), 'WRITE');
}

export function useIsAutomationsAdmin(): boolean {
  return hasAccess(usePermissions(), 'ADMIN');
}
