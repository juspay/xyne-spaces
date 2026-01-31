import { useSelector } from '@xstate/react';
import { stateMachineActor } from '../machines/stateMachine';
import type { UserPermission } from '../machines/stateMachine';

export const usePermissions = (): UserPermission[] => {
  const permissions = useSelector(stateMachineActor, state => state.context.permissions);

  return permissions || [];
};

export const useHasAdminAccess = (): boolean => {
  const permissions = usePermissions();

  return permissions.some(permission => permission.accessType === 'ADMIN');
};

export const useCanCreateTicket = (): boolean => {
  const permissions = usePermissions();
  return permissions.some(
    permission =>
      permission.resourceName === 'TICKETS' &&
      (permission.accessType === 'WRITE' || permission.accessType === 'ADMIN'),
  );
};

export const useCanReadTicket = (): boolean => {
  const permissions = usePermissions();

  return permissions.some(
    permission =>
      permission.resourceName === 'TICKETS' &&
      (permission.accessType === 'READ' ||
        permission.accessType === 'WRITE' ||
        permission.accessType === 'ADMIN'),
  );
};

export const useCanViewAnalytics = (): boolean => {
  const permissions = usePermissions();
  return permissions.some(
    permission => permission.resourceName === 'ANALYTICS' && permission.accessType === 'ADMIN',
  );
};
