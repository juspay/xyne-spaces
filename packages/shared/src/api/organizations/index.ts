import { route } from '../../enc-contracts/api-route.js';
import { z } from 'zod';

// ─── Organizations (/organizations/...): dashboard login. Org membership and roles. ───────
// Access is by the caller's own membership (checked in the handler), as the controller did.

const orgId = z.object({ orgId: z.string().min(1) });
const memberParams = z.object({ orgId: z.string().min(1), userId: z.string().min(1) });
/** The roles an owner or admin may hand out (VIEWER and COMMUNITY_MEMBER are not assignable here). */
const role = z.enum(['OWNER', 'ADMIN', 'MEMBER', 'GUEST']);
const dateish = z.union([z.date(), z.string()]);
const orgRole = z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER', 'COMMUNITY_MEMBER', 'GUEST']);
const memberAnswer = z.object({ message: z.string(), orgId: z.string(), userId: z.string(), role: role.optional() });

/** `/organizations`: org membership. Key order is the mount order. */
export const organizations = route('/organizations', {
  list: {
    method: 'GET',
    path: '',
    response: z.object({
      organizations: z.array(
        z.object({
          orgId: z.string(),
          name: z.string(),
          description: z.string().nullable(),
          createdAt: dateish,
          userRole: orgRole,
          joinedAt: dateish,
        }),
      ),
      total: z.number(),
    }),
  },
  get: {
    method: 'GET',
    path: '/:orgId',
    params: orgId,
    response: z.object({
      orgId: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      createdBy: z.string(),
      createdAt: dateish,
      userRole: orgRole,
      memberCount: z.number(),
      members: z.array(
        z.object({
          userId: z.string(),
          role: orgRole,
          joinedAt: dateish,
          invitedBy: z.string().optional(),
          user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
        }),
      ),
    }),
  },
  addMember: {
    method: 'POST',
    path: '/:orgId/members',
    params: orgId,
    body: z.object({ userId: z.string().min(1), role }),
    response: memberAnswer,
  },
  updateMemberRole: {
    method: 'PUT',
    path: '/:orgId/members/:userId',
    params: memberParams,
    body: z.object({ role }),
    response: memberAnswer,
  },
  removeMember: {
    method: 'DELETE',
    path: '/:orgId/members/:userId',
    params: memberParams,
    response: memberAnswer,
  },
});
