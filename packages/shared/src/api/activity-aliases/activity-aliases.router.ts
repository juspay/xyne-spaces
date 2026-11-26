import { defineRouter } from '../../enc-contracts/api-route.js';
import { activityAliasesCreate, activityAliasesDelete, activityAliasesList, activityAliasesUpdate } from './activity-aliases.contracts.js';

/** `/activity-aliases`: activity aliases. Key order is the mount order. */
export const activityAliasesRouter = defineRouter('/activity-aliases', {
  list: activityAliasesList,
  create: activityAliasesCreate,
  update: activityAliasesUpdate,
  delete: activityAliasesDelete,
});
