import { OrgRole, WorkspaceRole } from '@xyne/shared';
import { db } from '@/database/client';
import { runAsServiceActor } from '@/database/tenant/context';
import { ServiceAccountStatus } from '../../constants';
import { ServiceAccountError } from '../../errors';
import { isActive, isOwnedBy } from '../../ownership';
import { TokenSubjectKind, type TokenSubject } from '../types';

/** A guest the service account created: must still be its user, active, and the account enabled. */
export const serviceAccountGuest: TokenSubject = {
  kind: TokenSubjectKind.SERVICE_ACCOUNT_GUEST,

  async resolve(claims) {
    const { user, member, serviceAccount } = await runAsServiceActor(claims.sub, claims.workspaceId, async () => ({
      user: await db.user.findUnique({ where: { id: claims.sub } }),
      member: await db.orgMember.findUnique({ where: { memberId: claims.memberId } }),
      serviceAccount: await db.serviceAccount.findUnique({ where: { id: claims.sa } }),
    }));

    const valid =
      user &&
      member &&
      serviceAccount &&
      user.workspaceId === claims.workspaceId &&
      user.orgMemberId === claims.memberId &&
      user.role === WorkspaceRole.GUEST &&
      serviceAccount.workspaceId === claims.workspaceId &&
      isOwnedBy(user, serviceAccount.id);
    if (!valid) {
      throw new ServiceAccountError('unauthenticated', 'The Spaces token is invalid.', { reason: 'token_invalid' });
    }
    if (!isActive(user) || member.leftAt || serviceAccount.status !== ServiceAccountStatus.ACTIVE) {
      throw new ServiceAccountError('unauthenticated', 'This user is deactivated.', { reason: 'user_deactivated' });
    }

    return {
      id: user.id,
      googleId: user.providerUserId,
      email: user.email,
      name: user.name,
      displayName: user.displayName,
      workspaceId: user.workspaceId,
      isApiKeyUser: false,
      scopes: [],
      role: user.role,
      orgRole: OrgRole.GUEST,
      memberId: member.memberId,
      authProvider: user.authProvider,
    };
  },
};
