import { WorkspaceRole } from '@xyne/shared';
import { db } from '@/database/client';
import { ServiceAccountStatus } from '../../constants';
import { ServiceAccountError } from '../../errors';
import { TokenSubjectKind } from '../../tokens';
import type { LoginMethod } from '../types';

/**
 * A workspace member who has proved who they are to Spaces (e.g. by approving an SSO request)
 * signs in through the service account's app. Called by that flow, never with a caller-chosen user.
 */
export const member: LoginMethod<{ userId: string }> = {
  name: 'member',

  async identify(policy, { userId }) {
    if (policy.account.status !== ServiceAccountStatus.ACTIVE) {
      throw new ServiceAccountError('forbidden', 'This service account is disabled.', { reason: 'account_disabled' });
    }
    const user = await db.user.findFirst({ where: { id: userId, workspaceId: policy.workspaceId } });
    if (!user || user.role === WorkspaceRole.GUEST) {
      throw new ServiceAccountError('not_found', 'No member with that id in this workspace.');
    }
    return { kind: TokenSubjectKind.MEMBER, user };
  },
};
