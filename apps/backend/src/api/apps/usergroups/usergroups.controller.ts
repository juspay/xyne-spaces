import { api } from '@xyne/shared';
import { appPermission } from '@/apps/access';
import { controller } from '@/framework/api';
import { getAllUserGroups } from '../../../apps/core/userGroupUtils';
import { notFoundOr500 } from '../people.helpers';

/** GET /apps/usergroups/list */
export const listUserGroups = controller(api.apps.usergroups.list, { checks: { permission: appPermission('usergroups:read') } }, async () => {
  try {
    return await getAllUserGroups();
  } catch (error) {
    throw notFoundOr500(error, 'Error fetching user groups:');
  }
});