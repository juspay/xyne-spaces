import { defineRouter } from '../../../enc-contracts/api-route.js';
import { appsUserGroupsList } from './usergroups.contracts.js';

/** `/apps/usergroups`: user groups, for bots. Key order is the mount order. */
export const usergroupsRouter = defineRouter('/usergroups', {
  list: appsUserGroupsList,
});
