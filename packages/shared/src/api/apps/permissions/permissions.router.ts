import { defineRouter } from '../../../enc-contracts/api-route.js';
import { appsPermissions, appsPermissionsGet, appsPermissionsSet } from './permissions.contracts.js';

/** `/apps/permissions`: the permission registry and an app's permissions (dashboard). Key order is the mount order. */
export const permissionsRouter = defineRouter('/permissions', {
  list: appsPermissions,
  get: appsPermissionsGet,
  set: appsPermissionsSet,
});
