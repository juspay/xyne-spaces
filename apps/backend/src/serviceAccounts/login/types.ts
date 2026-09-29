import type { User } from '@prisma/client';
import type { ServiceAccountPolicy } from '../policy';
import type { TokenSubjectKind } from '../tokens';

/** One way a service account's user can log in. A new way is one of these, registered in ./index.ts. */
export interface LoginMethod<Input> {
  name: string;
  identify(policy: ServiceAccountPolicy, input: Input): Promise<{ kind: TokenSubjectKind; user: User }>;
}
