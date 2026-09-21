import { ReactElement, useEffect, useState, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { DEEP_LINK_PROTOCOL } from '../../utils/deepLink';

const LaunchScreen = (): ReactElement => {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState('Launching...');
  const navigate = useNavigate();

  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const path = searchParams.get('path'); // e.g. /chat/channel/123 or invite?workspaceId=xxx&invitationId=yyy
  const invitationIdParam = searchParams.get('invitationId');

  // Parse invitationId from path if embedded (e.g., "invite?workspaceId=xxx&invitationId=yyy")
  // The path might be URL-encoded, so we need to decode it first
  let invitationId = invitationIdParam;
  if (path) {
    const decodedPath = decodeURIComponent(path);
    if (decodedPath.includes('invitationId=')) {
      const pathParams = new URLSearchParams(decodedPath.split('?')[1] || '');
      const pathInvitationId = pathParams.get('invitationId');
      if (pathInvitationId) {
        invitationId = pathInvitationId;
      }
    }
  }

  // Construct the deep link URL
  let deepLink = `${DEEP_LINK_PROTOCOL}://`;
  let targetPath = '';

  if (code && state) {
    deepLink += `auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
    if (invitationId) {
      deepLink += `&invitationId=${encodeURIComponent(invitationId)}`;
    }
  } else if (path) {
    // Remove leading slash if present to avoid double slashes if protocol already has //
    // But xyne-spaces:// + /chat is xyne-spaces:///chat which is valid,
    // though often xyne-spaces://chat is preferred.
    // Let's ensure cleanly formed URL.
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    deepLink += cleanPath;
    targetPath = path.startsWith('/') ? path : `/${path}`;
  }

  // Track if the window lost focus (implies app opened or dialog shown)
  const hasLostFocus = useRef(false);

  useEffect(() => {
    const handleBlur = () => {
      hasLostFocus.current = true;
    };
    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, []);

  useEffect(() => {
    // 1. Attempt to open the custom scheme
    window.location.href = deepLink;

    // 2. Setup a fallback timeout
    const fallbackTimer = setTimeout(() => {
      // If window lost focus, we assume the app opened (or at least the user is interacting with the OS prompt)
      // So we cancel the auto-redirect to avoid opening the web app on top of the native app.
      if (hasLostFocus.current || (typeof document.hidden !== 'undefined' && document.hidden)) {
        setStatus('Launched in App!');
        return;
      }

      // If generic path, redirect to web version
      if (targetPath) {
        setStatus('Opening in Web...');
        void navigate(targetPath, { replace: true });
      } else if (!code) {
        void navigate('/', { replace: true });
      } else {
        setStatus('Could not open desktop app. Please try again.');
      }
    }, 3500); // Increased to 3.5s to give user time to click "Open" on the prompt

    return () => clearTimeout(fallbackTimer);
  }, [deepLink, targetPath, navigate, code]);

  return (
    <div className='flex min-h-screen flex-col items-center justify-center bg-background p-4 text-center'>
      <div className='mb-8'>
        <img src='/svgs/xyne.svg' alt='Xyne Logo' loading='eager' decoding='async' />
      </div>

      <h1 className='mb-4 text-xl font-semibold tracking-tight'>Launching Xyne Spaces</h1>

      <p className='mb-4 text-muted-foreground max-w-md'>Attempting to open the application...</p>

      <div className='flex flex-col gap-4 items-center'>
        <div className='h-8'>
          <span className='animate-pulse text-sm text-muted-foreground'>{status}</span>
        </div>

        <div className='flex flex-col gap-2'>
          <span className='text-slate-600 text-sm'>
            If nothing happens, you can{' '}
            <a href={deepLink} className='text-blue-600 hover:underline'>
              launch manually
            </a>
          </span>

          {targetPath && (
            <span className='text-slate-600 text-sm'>
              or{' '}
              <button
                onClick={() => {
                  void navigate(targetPath, { replace: true });
                }}
                className='text-blue-600 hover:underline bg-transparent border-none cursor-pointer p-0'
                data-track-category='NAVIGATION'
                data-track-name='ContinueInBrowser'
              >
                continue in browser
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default LaunchScreen;
