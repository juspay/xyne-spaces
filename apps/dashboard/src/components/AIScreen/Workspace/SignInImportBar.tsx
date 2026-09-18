import { useEffect, useState, type ReactElement } from 'react';
import { isElectronApp } from '../../../utils/electronApp';

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

export function SignInImportBar({ onImported }: { onImported: () => void }): ReactElement | null {
  const [available, setAvailable] = useState(false);
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'failed'>('idle');
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isElectronApp() || !window.electronAPI?.browserImportAvailable) return;
    void window.electronAPI
      .browserImportAvailable()
      .then(res => setAvailable(Boolean(res?.available)))
      .catch(() => setAvailable(false));
  }, []);

  if (!available || dismissed) return null;

  const runImport = async (): Promise<void> => {
    if (!window.electronAPI?.importChromeCookies) return;
    setState('running');
    try {
      const res = await window.electronAPI.importChromeCookies();
      if (res?.success) {
        setState('done');
        onImported();
      } else {
        setState('failed');
      }
    } catch {
      setState('failed');
    }
  };

  return (
    <div className='flex items-center gap-3 border-b border-border bg-secondary/40 px-3 py-2 text-xs text-foreground'>
      <span className='min-w-0 flex-1 truncate'>
        {state === 'failed'
          ? 'Could not import from Chrome. Sign in here instead.'
          : 'Signed out here. Bring your Chrome sign-ins into this browser?'}
      </span>
      <button
        type='button'
        onClick={() => {
          void runImport();
        }}
        disabled={state === 'running'}
        className='flex-shrink-0 rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60'
        data-track-category='AskAI'
        data-track-name='workspace-import-chrome-sessions'
      >
        {state === 'running' ? 'Importing…' : 'Import from Chrome'}
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
