import type { AuthenticatedUser } from '@/types/express';

/** Who a Spaces token acts as. A new kind is one TokenSubject, registered in ./index.ts. */
export enum TokenSubjectKind {
  SERVICE_ACCOUNT_GUEST = 'sa_guest',
}

export interface SpacesTokenClaims {
  kind: TokenSubjectKind;
  sub: string;
  workspaceId: string;
  memberId: string;
  sa: string;
}

export interface TokenSubject {
  kind: TokenSubjectKind;
  resolve(claims: SpacesTokenClaims): Promise<AuthenticatedUser>;
}
