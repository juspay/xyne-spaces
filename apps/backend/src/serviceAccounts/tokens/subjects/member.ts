import { WorkspaceRole } from '@xyne/shared';
import { loadSpacesTokenRows } from '@/bypassAcl/serviceAccountServices';
import { ServiceAccountStatus } from '../../constants';
import { ServiceAccountError } from '../../errors';
import { isKeyUsable } from '../../keys';
import { isActive } from '../../ownership';
import { TokenSubjectKind, type TokenSubject } from '../types';

/** A workspace member signed in through a service account's app: acts with their own rights. */
export const member: TokenSubject = {
  kind: TokenSubjectKind.MEMBER,
  ttlSeconds: 24 * 60 * 60,

  async resolve(claims) {
    const { user, orgMember, serviceAccount, key } = await loadSpacesTokenRows(claims);

    const valid =
      user &&
      orgMember &&
      serviceAccount &&
      user.workspaceId === claims.workspaceId &&
      user.orgMemberId === claims.memberId &&
      user.role !== WorkspaceRole.GUEST &&
      serviceAccount.workspaceId === claims.workspaceId;
    if (!valid) {
      throw new ServiceAccountError('unauthenticated', 'The Spaces token is invalid.', { reason: 'token_invalid' });
    }
    if (!isKeyUsable(key, serviceAccount.id)) {
      throw new ServiceAccountError('unauthenticated', 'The key this token was issued with is no longer valid.', {
        reason: 'key_revoked',
      });
    }
    if (!isActive(user) || orgMember.leftAt || serviceAccount.status !== ServiceAccountStatus.ACTIVE) {
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
      orgRole: orgMember.role,
      memberId: orgMember.memberId,
      authProvider: user.authProvider,
    };
  },
};
