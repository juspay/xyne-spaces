import { db } from '@/database/client';
import { ServiceAccountError } from '../errors';
import { isActive } from '../ownership';
import type { ServiceAccount } from '@prisma/client';
import { ServiceAccountPolicy } from '../policy';
import { signSpacesToken } from '../tokens';
import { email } from './methods/email';
import { member } from './methods/member';
import type { LoginMethod } from './types';

interface LoginInputs {
  email: { email: string };
  member: { userId: string };
}

export type LoginMethodName = keyof LoginInputs;

const METHODS: { [N in LoginMethodName]: LoginMethod<LoginInputs[N]> } = {
  email,
  member,
};

/** Every login method ends here: the user must be active, then gets a Spaces token. */
export async function issueSpacesToken<N extends LoginMethodName>(
  account: ServiceAccount,
  keyId: string,
  method: N,
  input: LoginInputs[N],
): Promise<{ accessToken: string; expiresAt: string; userId: string }> {
  const policy = new ServiceAccountPolicy(account);
  const { kind, user } = await (METHODS[method] as LoginMethod<LoginInputs[N]>).identify(policy, input);

  const member = await db.orgMember.findUnique({ where: { memberId: user.orgMemberId }, select: { leftAt: true } });
  if (!isActive(user) || !member || member.leftAt) {
    throw new ServiceAccountError('forbidden', 'This user is deactivated.', { reason: 'user_deactivated' });
  }

  const { token, expiresAt } = signSpacesToken({
    kind,
    sub: user.id,
    workspaceId: user.workspaceId,
    memberId: user.orgMemberId,
    sa: account.id,
    kid: keyId,
  });
  return { accessToken: token, expiresAt: expiresAt.toISOString(), userId: user.id };
}

export type { LoginMethod } from './types';
