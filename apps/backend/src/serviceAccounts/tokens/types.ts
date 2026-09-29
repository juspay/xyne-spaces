import type { AuthenticatedUser } from '@/types/express';

/** Who a Spaces token acts as. A new kind is one TokenSubject, registered in ./index.ts. */
export enum TokenSubjectKind {
  SERVICE_ACCOUNT_GUEST = 'sa_guest',
  MEMBER = 'member',
}

export interface SpacesTokenClaims {
  kind: TokenSubjectKind;
  sub: string;
  workspaceId: string;
  memberId: string;
  sa: string;
  kid: string;
}

export interface TokenSubject {
  kind: TokenSubjectKind;
  ttlSeconds: number;
  resolve(claims: SpacesTokenClaims): Promise<AuthenticatedUser>;
}
