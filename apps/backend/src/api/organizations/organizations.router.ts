import { API } from '@xyne/shared';
import { api } from '@/framework/api';
import { addMember, getOrganization, listOrganizations, removeMember, updateMemberRole } from './organizations.controller';

/** `/organizations` (login; the controllers check the caller's own membership). */
export const organizationsRouter = api.router(API.organizations, {}, (serve) => ({
  list: serve('list', { controller: ({ user }) => listOrganizations({ user }) }),
  get: serve('get', { controller: ({ params, user }) => getOrganization({ params, user }) }),
  addMember: serve('addMember', { controller: ({ params, body, user }) => addMember({ params, body, user }) }),
  updateMemberRole: serve('updateMemberRole', { controller: ({ params, body, user }) => updateMemberRole({ params, body, user }) }),
  removeMember: serve('removeMember', { controller: ({ params, user }) => removeMember({ params, user }) }),
}));
