import { api } from '@xyne/shared';
import { appPermission } from '@/apps/access';
import { controller } from '@/framework/api';
import { getUserData } from '../../../apps/core/userUtils';
import { notFoundOr500 } from '../people.helpers';

/** GET /apps/user/info */
export const userInfo = controller(api.apps.user.info, { checks: { permission: appPermission('users:read') } }, async (input) => {
  try {
    return await getUserData(input.query.userId);
  } catch (error) {
    throw notFoundOr500(error, 'Error fetching user data:');
  }
});