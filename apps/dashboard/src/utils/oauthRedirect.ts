/**
 * Social desk OAuth runs in the system browser on Electron (so the provider's session is the
 * user's real one) and in the same tab on the web.
 */
export const oauthPlatform = (): 'web' | 'electron' =>
  typeof window.electronAPI?.openExternal === 'function' ? 'electron' : 'web';

export function openOAuthUrl(authUrl: string): void {
  if (window.electronAPI?.openExternal) {
    window.electronAPI.openExternal(authUrl);
  } else {
    window.location.href = authUrl;
  }
}
