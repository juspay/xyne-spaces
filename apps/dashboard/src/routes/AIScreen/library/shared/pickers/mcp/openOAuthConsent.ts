import { isElectronApp } from '@/utils/electronApp';
import { openLink } from '@/utils/openLink';

export function openOAuthConsent(authUrl: string): void {
  if (isElectronApp()) {
    openLink(authUrl, null, { force: 'external' });
    return;
  }
  window.location.href = authUrl;
}
