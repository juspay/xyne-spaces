import { OrgRole, WorkspaceRole } from '@xyne/shared';
import { loadSpacesTokenRows } from '@/bypassAcl/serviceAccountServices';
import { ServiceAccountStatus } from '../../constants';
import { ServiceAccountError } from '../../errors';
import { isKeyUsable } from '../../keys';
import { isActive, isOwnedBy } from '../../ownership';
import { TokenSubjectKind, type TokenSubject } from '../types';

/** A guest the service account created: must still be its user, active, and the account enabled. */
export const serviceAccountGuest: TokenSubject = {
  kind: TokenSubjectKind.SERVICE_ACCOUNT_GUEST,
  ttlSeconds: 60 * 60,

  async resolve(claims) {
    const { user, orgMember: member, serviceAccount, key } = await loadSpacesTokenRows(claims);

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
    if (!isKeyUsable(key, serviceAccount.id)) {
      throw new ServiceAccountError('unauthenticated', 'The key this token was issued with is no longer valid.', {
        reason: 'key_revoked',
      });
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
