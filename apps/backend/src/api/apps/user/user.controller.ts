import { getUserData } from '../../../apps/core/userUtils';
import { notFoundOr500 } from '../people.helpers';

/** GET /apps/user/info */
export async function userInfo(input: { query: { userId: string } }) {
  try {
    return await getUserData(input.query.userId);
  } catch (error) {
    throw notFoundOr500(error, 'Error fetching user data:');
  }
}