export const PLUG_AND_PLAY_ONBOARDING_TYPE = 'plug-and-play-onboarding';

export const ONBOARDING_SAMPLE_SLUG = 'onboarding-sample-slack';
export const ONBOARDING_SAMPLE_CHANNEL_NAME = 'sample-onboarding';

export const ONBOARDING_ROLES = [
  { key: 'role_builder', label: 'I build and ship' },
  { key: 'role_ops', label: 'I run ops/support' },
  { key: 'role_lead', label: 'I lead a team' },
  { key: 'role_other', label: 'Something else' },
] as const;

export const ONBOARDING_DOMAINS = [
  { key: 'domain_software', label: 'Software/internet' },
  { key: 'domain_finance', label: 'Finance/payments' },
  { key: 'domain_healthcare', label: 'Healthcare' },
  { key: 'domain_other', label: 'Other' },
] as const;

export const ONBOARDING_TRY_FIRST = [
  { key: 'try_recap', label: 'Catch up on what I missed' },
  { key: 'try_chat', label: 'Talk to my team' },
  { key: 'try_support', label: 'Track work' },
  { key: 'try_search', label: 'Find something' },
  { key: 'try_ai', label: 'Ask AI' },
] as const;

export const PROTOTYPE_CONNECTORS = [
  { key: 'slack', label: 'Slack' },
  { key: 'teams', label: 'Microsoft Teams' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'discord', label: 'Discord' },
  { key: 'google_chat', label: 'Google Chat' },
] as const;

export type OnboardingRole = (typeof ONBOARDING_ROLES)[number]['key'];
export type OnboardingDomain = (typeof ONBOARDING_DOMAINS)[number]['key'];
export type OnboardingTryFirst = (typeof ONBOARDING_TRY_FIRST)[number]['key'];
export type PrototypeConnectKey = (typeof PROTOTYPE_CONNECTORS)[number]['key'];
export type OnboardingTap = 1 | 2 | 3 | 4;

export const TRY_FIRST_ROUTES: Record<OnboardingTryFirst, string> = {
  try_recap: '/chat/dir/recap',
  try_chat: '/chat/dir',
  try_support: '/support',
  try_search: '/search',
  try_ai: '/ai',
};

export const PROTOTYPE_CONNECT_KEYS: readonly PrototypeConnectKey[] = PROTOTYPE_CONNECTORS.map(
  connector => connector.key,
);

export interface OnboardingPayload {
  onboardingRole?: OnboardingRole;
  onboardingDomain?: OnboardingDomain;
  onboardingTryFirst?: OnboardingTryFirst;
  onboardingPrototypeConnectKeys?: PrototypeConnectKey[];
  onboardingCompletedAt?: string;
}

const ROLE_KEYS = new Set<string>(ONBOARDING_ROLES.map(option => option.key));
const DOMAIN_KEYS = new Set<string>(ONBOARDING_DOMAINS.map(option => option.key));
const TRY_FIRST_KEYS = new Set<string>(ONBOARDING_TRY_FIRST.map(option => option.key));
const CONNECT_KEYS = new Set<string>(PROTOTYPE_CONNECT_KEYS);

export function isOnboardingRole(value: unknown): value is OnboardingRole {
  return typeof value === 'string' && ROLE_KEYS.has(value);
}

export function isOnboardingDomain(value: unknown): value is OnboardingDomain {
  return typeof value === 'string' && DOMAIN_KEYS.has(value);
}

export function isOnboardingTryFirst(value: unknown): value is OnboardingTryFirst {
  return typeof value === 'string' && TRY_FIRST_KEYS.has(value);
}

export function isPrototypeConnectKey(value: unknown): value is PrototypeConnectKey {
  return typeof value === 'string' && CONNECT_KEYS.has(value);
}

export function parseOnboardingPayload(raw: unknown): OnboardingPayload {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  const record = raw as Record<string, unknown>;
  const payload: OnboardingPayload = {};

  if (isOnboardingRole(record['onboardingRole'])) {
    payload.onboardingRole = record['onboardingRole'];
  }
  if (isOnboardingDomain(record['onboardingDomain'])) {
    payload.onboardingDomain = record['onboardingDomain'];
  }
  if (isOnboardingTryFirst(record['onboardingTryFirst'])) {
    payload.onboardingTryFirst = record['onboardingTryFirst'];
  }
  if (Array.isArray(record['onboardingPrototypeConnectKeys'])) {
    payload.onboardingPrototypeConnectKeys =
      record['onboardingPrototypeConnectKeys'].filter(isPrototypeConnectKey);
  }
  if (typeof record['onboardingCompletedAt'] === 'string' && record['onboardingCompletedAt']) {
    payload.onboardingCompletedAt = record['onboardingCompletedAt'];
  }

  return payload;
}

export function resolveResumeTap(payload: OnboardingPayload): OnboardingTap | 'complete' {
  if (payload.onboardingCompletedAt) {
    return 'complete';
  }
  if (!payload.onboardingRole) {
    return 1;
  }
  if (!payload.onboardingDomain) {
    return 2;
  }
  if (!payload.onboardingTryFirst) {
    return 3;
  }
  return 4;
}

/** Direct visits to /onboarding always show the wizard, including after complete. */
export function wizardOpeningTap(payload: OnboardingPayload): OnboardingTap {
  const resume = resolveResumeTap(payload);
  return resume === 'complete' ? 1 : resume;
}

export function tryFirstLandingPath(workspaceId: string, tryFirst: OnboardingTryFirst): string {
  return `/${workspaceId}${TRY_FIRST_ROUTES[tryFirst]}`;
}

export function addPrototypeConnectKey(
  current: readonly PrototypeConnectKey[],
  key: PrototypeConnectKey,
): PrototypeConnectKey[] {
  if (current.includes(key)) {
    return [...current];
  }
  return [...current, key];
}

export function tap4FooterAction(checkedCount: number): 'skip' | 'continue' {
  return checkedCount === 0 ? 'skip' : 'continue';
}

export function buildCompletePayload(
  payload: OnboardingPayload,
  checkedKeys: readonly PrototypeConnectKey[],
  completedAt: string,
): OnboardingPayload {
  return {
    ...payload,
    onboardingPrototypeConnectKeys: [...checkedKeys],
    onboardingCompletedAt: completedAt,
  };
}

export function canCompleteOnboarding(payload: OnboardingPayload): boolean {
  return Boolean(payload.onboardingRole && payload.onboardingDomain && payload.onboardingTryFirst);
}

/** Prototype Connect never starts OAuth or adapter install. */
export const PROTOTYPE_CONNECT_STARTS_OAUTH = false;
