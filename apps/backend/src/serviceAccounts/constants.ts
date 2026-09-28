export enum ServiceAccountStatus {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
}

export enum ServiceAccountKeyStatus {
  ACTIVE = 'ACTIVE',
  REVOKED = 'REVOKED',
}

export enum ServiceAccountResourceType {
  CHANNEL = 'CHANNEL',
}

export const KEY_MAX_TTL_DAYS = 365;

export const SPACES_TOKEN_TTL_SECONDS = 60 * 60;
