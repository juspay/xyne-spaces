import { defineRouter } from '../../enc-contracts/api-route.js';
import { organizationsAddMember, organizationsGet, organizationsList, organizationsRemoveMember, organizationsUpdateMemberRole } from './organizations.contracts.js';

/** `/organizations`: org membership. Key order is the mount order. */
export const organizationsRouter = defineRouter('/organizations', {
  list: organizationsList,
  get: organizationsGet,
  addMember: organizationsAddMember,
  updateMemberRole: organizationsUpdateMemberRole,
  removeMember: organizationsRemoveMember,
});
