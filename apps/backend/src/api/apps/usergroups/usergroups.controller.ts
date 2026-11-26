import { getAllUserGroups } from '../../../apps/core/userGroupUtils';
import { notFoundOr500 } from '../people.helpers';

/** GET /apps/usergroups/list */
export async function listUserGroups() {
  try {
    return await getAllUserGroups();
  } catch (error) {
    throw notFoundOr500(error, 'Error fetching user groups:');
  }
}