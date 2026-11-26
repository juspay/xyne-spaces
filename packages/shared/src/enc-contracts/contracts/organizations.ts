import { z } from 'zod';
import { defineRoute } from '../api-route.js';

// ─── Organizations (/organizations/...): dashboard login. Org membership and roles. ───────
// Access is by the caller's own membership (checked in the handler), as the controller did.

const orgId = z.object({ orgId: z.string().min(1) });
const memberParams = z.object({ orgId: z.string().min(1), userId: z.string().min(1) });
/** The roles an owner or admin may hand out (VIEWER and COMMUNITY_MEMBER are not assignable here). */
const role = z.enum(['OWNER', 'ADMIN', 'MEMBER', 'GUEST']);
const dateish = z.union([z.date(), z.string()]);
const orgRole = z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER', 'COMMUNITY_MEMBER', 'GUEST']);
const memberAnswer = z.object({ message: z.string(), orgId: z.string(), userId: z.string(), role: role.optional() });

export const organizationsList = defineRoute({
  method: 'GET',
  path: '/organizations',
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
});

export const organizationsGet = defineRoute({
  method: 'GET',
  path: '/organizations/:orgId',
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
});

export const organizationsAddMember = defineRoute({
  method: 'POST',
  path: '/organizations/:orgId/members',
  params: orgId,
  body: z.object({ userId: z.string().min(1), role }),
  response: memberAnswer,
});

export const organizationsUpdateMemberRole = defineRoute({
  method: 'PUT',
  path: '/organizations/:orgId/members/:userId',
  params: memberParams,
  body: z.object({ role }),
  response: memberAnswer,
});

export const organizationsRemoveMember = defineRoute({
  method: 'DELETE',
  path: '/organizations/:orgId/members/:userId',
  params: memberParams,
  response: memberAnswer,
});
