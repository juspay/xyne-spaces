export const PLUG_AND_PLAY_ONBOARDING_TYPE = 'plug-and-play-onboarding';

const ROLE_KEYS = new Set(['role_builder', 'role_ops', 'role_lead', 'role_other']);
const DOMAIN_KEYS = new Set([
  'domain_software',
  'domain_finance',
  'domain_healthcare',
  'domain_other',
]);
const TRY_FIRST_KEYS = new Set(['try_recap', 'try_chat', 'try_support', 'try_search', 'try_ai']);
const CONNECT_KEYS = new Set(['slack', 'teams', 'whatsapp', 'discord', 'google_chat']);

export type PlugAndPlayPayload = Record<string, unknown>;

function asObject(value: unknown): PlugAndPlayPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as PlugAndPlayPayload;
}

function sanitizeConnectKeys(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((key): key is string => typeof key === 'string' && CONNECT_KEYS.has(key));
}

export function sanitizePlugAndPlayPayload(raw: unknown): PlugAndPlayPayload {
  const record = asObject(raw) ?? {};
  const payload: PlugAndPlayPayload = {};

  if (typeof record.onboardingRole === 'string' && ROLE_KEYS.has(record.onboardingRole)) {
    payload.onboardingRole = record.onboardingRole;
  }
  if (typeof record.onboardingDomain === 'string' && DOMAIN_KEYS.has(record.onboardingDomain)) {
    payload.onboardingDomain = record.onboardingDomain;
  }
  if (
    typeof record.onboardingTryFirst === 'string' &&
    TRY_FIRST_KEYS.has(record.onboardingTryFirst)
  ) {
    payload.onboardingTryFirst = record.onboardingTryFirst;
  }
  if ('onboardingPrototypeConnectKeys' in record) {
    payload.onboardingPrototypeConnectKeys = sanitizeConnectKeys(
      record.onboardingPrototypeConnectKeys
    );
  }
  if (typeof record.onboardingCompletedAt === 'string' && record.onboardingCompletedAt.trim()) {
    payload.onboardingCompletedAt = record.onboardingCompletedAt;
  }

  return payload;
}

export function mergePlugAndPlayPayload(existing: unknown, incoming: unknown): PlugAndPlayPayload {
  return {
    ...sanitizePlugAndPlayPayload(existing),
    ...sanitizePlugAndPlayPayload(incoming),
  };
}

export function assertCompletePlugAndPlayPayload(payload: PlugAndPlayPayload): string | null {
  if (typeof payload.onboardingCompletedAt !== 'string' || !payload.onboardingCompletedAt) {
    return null;
  }
  if (
    typeof payload.onboardingRole !== 'string' ||
    typeof payload.onboardingDomain !== 'string' ||
    typeof payload.onboardingTryFirst !== 'string'
  ) {
    return 'onboardingRole, onboardingDomain, and onboardingTryFirst are required to complete onboarding';
  }
  return null;
}
