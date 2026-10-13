import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useUserPreference } from '../../../machines/userPreferencesMachine';
import { listImportBrowsers } from '../../../utils/browserSessions';

const AUTH_HOST_PATTERNS = [
  /^accounts\.google\.com$/,
  /^login\.microsoftonline\.com$/,
  /^login\.live\.com$/,
  /^.*\.okta\.com$/,
  /^id\.atlassian\.com$/,
  /^auth\.atlassian\.com$/,
  /^github\.com$/,
  /^www\.notion\.so$/,
  /^www\.figma\.com$/,
];

const AUTH_PATH_PATTERNS = [/\/login/i, /\/signin/i, /\/sign-in/i, /\/oauth/i, /\/authorize/i];

export function looksLikeSignIn(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (AUTH_HOST_PATTERNS.some(pattern => pattern.test(host))) return true;
  return AUTH_PATH_PATTERNS.some(pattern => pattern.test(parsed.pathname));
}

/**
 * Offered on a sign-in page: the reader's own browsers may already be signed in
 * there. Which browser to bring sign-ins from is chosen in Preferences → Browser,
 * where every one on this computer is listed.
 */
export function SignInImportBar({ onImported }: { onImported: () => void }): ReactElement | null {
  const [available, setAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    void listImportBrowsers().then(found => setAvailable(found.browsers.length > 0));
  }, []);

  // An import made from Preferences while this page waits: it can load signed in now.
  const imports = useUserPreference('browserImports');
  const seenRef = useRef(imports);
  const onImportedRef = useRef(onImported);
  onImportedRef.current = onImported;
  useEffect(() => {
    if (imports === seenRef.current) return;
    seenRef.current = imports;
    if (Object.keys(imports).length > 0) onImportedRef.current();
  }, [imports]);

  if (!available || dismissed) return null;

  return (
    <div className='flex items-center gap-3 border-b border-border bg-secondary/40 px-3 py-2 text-xs text-foreground'>
      <span className='min-w-0 flex-1 truncate'>
        Signed out here. Bring your sign-ins from another browser?
      </span>
      <button
        type='button'
        onClick={() =>
          window.dispatchEvent(
            new CustomEvent('xyne-open-preferences', { detail: { section: 'browser' } }),
          )
        }
        className='flex-shrink-0 rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground transition-opacity hover:opacity-90'
        data-track-category='AskAI'
        data-track-name='workspace-import-chrome-sessions'
      >
        Import sign-ins…
      </button>
      <button
        type='button'
        onClick={() => setDismissed(true)}
        data-track-category='AskAI'
        data-track-name='workspace-import-dismiss'
        className='flex-shrink-0 rounded-md px-2 py-1 text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
      >
        Not now
      </button>
    </div>
  );
}
