import { TokenSubjectKind } from '../../tokens';
import { findOwnedUser } from '../../users';
import type { LoginMethod } from '../types';

/** The partner's backend (holding the S2S key) names one of the account's own users by email. */
export const email: LoginMethod<{ email: string }> = {
  name: 'email',

  async identify(policy, input) {
    return { kind: TokenSubjectKind.SERVICE_ACCOUNT_GUEST, user: await findOwnedUser(policy, input.email) };
  },
};
