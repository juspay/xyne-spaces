import { ONBOARDING_SAMPLE_CHANNEL_NAME, ONBOARDING_SAMPLE_SLUG } from './onboardingFlow';

const SAMPLE_STORAGE_PREFIX = 'xyne-onboarding-sample:';

export function onboardingSampleStorageKey(workspaceId: string): string {
  return `${SAMPLE_STORAGE_PREFIX}${workspaceId}`;
}

export function markOnboardingSampleVisible(workspaceId: string): void {
  if (!workspaceId) {
    return;
  }
  localStorage.setItem(onboardingSampleStorageKey(workspaceId), '1');
}

export function isOnboardingSampleVisible(workspaceId: string | undefined | null): boolean {
  if (!workspaceId) {
    return false;
  }
  return localStorage.getItem(onboardingSampleStorageKey(workspaceId)) === '1';
}

export const ONBOARDING_SAMPLE_THREAD = {
  slug: ONBOARDING_SAMPLE_SLUG,
  channelName: ONBOARDING_SAMPLE_CHANNEL_NAME,
  label: 'Sample',
  recapBlurb:
    'The team aligned on shipping recap first so people can catch up without scrolling the whole channel.',
  messages: [
    {
      id: 'sample-msg-1',
      author: 'Alex',
      body: 'Can we get recap on the channels we already live in?',
    },
    {
      id: 'sample-msg-2',
      author: 'Priya',
      body: "That's the idea — bring Slack, Teams, WhatsApp, Discord, or Google Chat into Spaces.",
    },
  ],
} as const;

export function onboardingSamplePath(workspaceId: string): string {
  return `/${workspaceId}/chat/dir/${ONBOARDING_SAMPLE_SLUG}`;
}
