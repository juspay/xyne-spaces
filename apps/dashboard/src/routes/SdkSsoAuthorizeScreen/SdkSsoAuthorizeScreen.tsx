import { ReactElement, useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox/Checkbox';
import { apiInstance } from '../../services/clients/apiClient';
import { logger, Event } from '../../utils/logger';
import { storePendingSdkSso } from '../../utils/pendingSdkSso';

interface AuthRequestInfo {
  status: string;
  user_code: string;
  created_at: number;
  session_expires_in: number;
  requested_from: { ip: string | null; user_agent: string | null };
}

type ScreenState = 'loading' | 'consent' | 'success' | 'denied' | 'expired' | 'error';

/** "24 hours", "7 days", "90 minutes" — how long an approved session lasts. */
function formatDuration(seconds: number): string {
  const units: [number, string][] = [
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
  ];
  for (const [size, name] of units) {
    if (seconds >= size && seconds % size === 0) {
      const count = seconds / size;
      return `${count} ${name}${count === 1 ? '' : 's'}`;
    }
  }
  const hours = Math.round(seconds / 3600);
  return hours >= 1
    ? `${hours} hour${hours === 1 ? '' : 's'}`
    : `${Math.round(seconds / 60)} minutes`;
}

export default function SdkSsoAuthorizeScreen(): ReactElement {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading, user } = useAuth();

  const [screenState, setScreenState] = useState<ScreenState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sessionExpiresIn, setSessionExpiresIn] = useState<number | null>(null);
  const [requestInfo, setRequestInfo] = useState<AuthRequestInfo | null>(null);
  // The one check that stops a phished link: the approver confirms the code
  // on this page is the one their own terminal is showing.
  const [codeConfirmed, setCodeConfirmed] = useState(false);

  const userCode = searchParams.get('user_code');

  // Handle authentication redirect
  useEffect(() => {
    if (authLoading) return;

    if (!userCode) {
      setScreenState('error');
      setError('No authorization code provided');
      return;
    }

    if (!isAuthenticated) {
      // Store user_code in localStorage before OAuth redirect (OAuth loses URL params)
      storePendingSdkSso(userCode);
      void navigate('/auth', { replace: true });
      return;
    }

    // User is authenticated, fetch the auth request info
    void fetchAuthInfo(userCode);
  }, [authLoading, isAuthenticated, userCode, navigate]);

  const fetchAuthInfo = async (code: string): Promise<void> => {
    try {
      const response = await apiInstance.get<AuthRequestInfo>('/sdk/auth/sso/status', {
        params: { userCode: code },
      });
      setSessionExpiresIn(response.data.session_expires_in);
      setRequestInfo(response.data);
      if (response.data.status === 'pending') {
        setScreenState('consent');
      } else if (response.data.status === 'approved') {
        setScreenState('success');
      } else if (response.data.status === 'denied') {
        setScreenState('denied');
      } else {
        setScreenState('expired');
      }
    } catch (err: unknown) {
      // Check if it's a 404 (not found) vs other errors
      const axiosError = err as { response?: { status?: number; data?: { message?: string } } };
      if (axiosError.response?.status === 404) {
        setScreenState('expired');
      } else {
        setScreenState('error');
        setError(axiosError.response?.data?.message || 'Failed to fetch authorization status');
      }
    }
  };

  const handleDecision = async (approved: boolean): Promise<void> => {
    if (!userCode) return;

    setIsSubmitting(true);
    try {
      await apiInstance.post('/sdk/auth/sso/approve', {
        userCode,
        approved,
      });

      setScreenState(approved ? 'success' : 'denied');
    } catch (err) {
      setError('Failed to process your decision. Please try again.');
      logger.error(Event.SDK_SSO_AUTH_ERROR, { error: err });
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderContent = (): ReactElement => {
    switch (screenState) {
      case 'loading':
        return (
          <div className='flex flex-col items-center gap-4'>
            <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-primary'></div>
            <p className='text-muted-foreground'>Loading...</p>
          </div>
        );

      case 'consent':
        return (
          <div className='flex flex-col items-center gap-6 max-w-md'>
            <div className='w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center'>
              <svg
                className='w-8 h-8 text-primary'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z'
                />
              </svg>
            </div>

            <div className='text-center'>
              <h1 className='text-2xl font-semibold mb-2'>Authorize SDK Access</h1>
              <p className='text-muted-foreground'>
                A sign-in was started from a terminal or app and is asking for access to your Xyne
                Spaces account.
              </p>
            </div>

            <div className='w-full p-4 rounded-lg border border-border text-center space-y-2'>
              <p className='text-sm text-muted-foreground'>
                Check that your terminal shows this exact code
              </p>
              <p className='font-mono text-3xl font-semibold tracking-widest'>
                {requestInfo?.user_code ?? userCode}
              </p>
            </div>

            <div className='w-full p-4 rounded-lg bg-muted/50 space-y-2'>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>Signed in as</span>
                <span className='font-medium'>{user?.name || user?.email}</span>
              </div>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>Session validity</span>
                <span className='font-medium'>
                  {sessionExpiresIn ? formatDuration(sessionExpiresIn) : '—'}
                </span>
              </div>
              <div className='flex justify-between gap-4'>
                <span className='text-muted-foreground shrink-0'>Requested from</span>
                <span className='font-medium text-right break-all'>
                  {requestInfo?.requested_from.ip ?? 'Unknown'}
                </span>
              </div>
              <div className='flex justify-between gap-4'>
                <span className='text-muted-foreground shrink-0'>App</span>
                <span className='text-sm text-right break-all'>
                  {requestInfo?.requested_from.user_agent ?? 'Unknown'}
                </span>
              </div>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>Started</span>
                <span className='font-medium'>
                  {requestInfo ? new Date(requestInfo.created_at).toLocaleTimeString() : '—'}
                </span>
              </div>
            </div>

            <div className='w-full p-4 rounded-lg border border-amber-500/30 bg-amber-500/10'>
              <p className='text-sm text-amber-700 dark:text-amber-300'>
                Approving gives whoever started this sign-in full access to your account. Only
                approve a sign-in you started yourself, just now, from your own terminal. If someone
                sent you this link, or the code does not match your terminal, click Deny.
              </p>
            </div>

            <div className='w-full'>
              <Checkbox
                checked={codeConfirmed}
                onChange={setCodeConfirmed}
                label='This code matches my terminal, and I started this sign-in'
                disabled={isSubmitting}
              />
            </div>

            {error && (
              <div className='w-full p-3 rounded-lg bg-destructive/10 text-destructive text-sm'>
                {error}
              </div>
            )}

            <div className='flex gap-3 w-full'>
              <Button
                variant='outline'
                className='flex-1'
                onClick={() => void handleDecision(false)}
                disabled={isSubmitting}
              >
                Deny
              </Button>
              <Button
                className='flex-1'
                onClick={() => void handleDecision(true)}
                disabled={isSubmitting || !codeConfirmed}
              >
                {isSubmitting ? 'Processing...' : 'Approve'}
              </Button>
            </div>
          </div>
        );

      case 'success':
        return (
          <div className='flex flex-col items-center gap-4 max-w-md text-center'>
            <div className='w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center'>
              <svg
                className='w-8 h-8 text-green-500'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M5 13l4 4L19 7'
                />
              </svg>
            </div>
            <h1 className='text-2xl font-semibold'>Authorization Successful</h1>
            <p className='text-muted-foreground'>
              The SDK has been authorized. You can close this window and return to your terminal.
            </p>
          </div>
        );

      case 'denied':
        return (
          <div className='flex flex-col items-center gap-4 max-w-md text-center'>
            <div className='w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center'>
              <svg
                className='w-8 h-8 text-amber-500'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M6 18L18 6M6 6l12 12'
                />
              </svg>
            </div>
            <h1 className='text-2xl font-semibold'>Authorization Denied</h1>
            <p className='text-muted-foreground'>
              You have denied the authorization request. You can close this window.
            </p>
          </div>
        );

      case 'expired':
        return (
          <div className='flex flex-col items-center gap-4 max-w-md text-center'>
            <div className='w-16 h-16 rounded-full bg-muted flex items-center justify-center'>
              <svg
                className='w-8 h-8 text-muted-foreground'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z'
                />
              </svg>
            </div>
            <h1 className='text-2xl font-semibold'>Request Expired</h1>
            <p className='text-muted-foreground'>
              This authorization request has expired or was already processed. Please start a new
              authorization flow.
            </p>
          </div>
        );

      case 'error':
        return (
          <div className='flex flex-col items-center gap-4 max-w-md text-center'>
            <div className='w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center'>
              <svg
                className='w-8 h-8 text-destructive'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z'
                />
              </svg>
            </div>
            <h1 className='text-2xl font-semibold'>Error</h1>
            <p className='text-muted-foreground'>{error || 'An unexpected error occurred.'}</p>
          </div>
        );
    }
  };

  return (
    <div className='min-h-screen flex items-center justify-center bg-background p-4'>
      <div className='w-full max-w-lg'>{renderContent()}</div>
    </div>
  );
}
