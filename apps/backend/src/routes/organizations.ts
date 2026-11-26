import { Router } from 'express';
import { API } from '@xyne/shared';
import { api } from '@/framework/api';
import { addMember, getOrganization, listOrganizations, removeMember, updateMemberRole } from '@/handlers/organizations';

// Typed routes (API.organizations), served by the API router behind the contract gate: dashboard
// login, then the handler checks the caller's own membership.
api.routes(API.organizations, (serve) => ({
  list: serve('list', { handle: ({ user }) => listOrganizations({ user }) }),
  get: serve('get', { handle: ({ params, user }) => getOrganization({ params, user }) }),
  addMember: serve('addMember', { handle: ({ params, body, user }) => addMember({ params, body, user }) }),
  updateMemberRole: serve('updateMemberRole', { handle: ({ params, body, user }) => updateMemberRole({ params, body, user }) }),
  removeMember: serve('removeMember', { handle: ({ params, user }) => removeMember({ params, user }) }),
}));

// Nothing untyped left under /api/organizations.
const router = Router();
export default router;
