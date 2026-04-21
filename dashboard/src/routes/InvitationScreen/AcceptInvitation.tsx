import { ReactElement, useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { MailPlus, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { Button } from '../../components/ui/Button/Button';
import axios from 'axios';
import Cookies from 'js-cookie';
import { API_BASE_URL } from '../../config';
import { authActor, setLastActiveWorkspaceId } from '../../machines/authMachine';

interface InvitationDetails {
  id: string;
  email: string;
  role: string;
  workspaceName?: string;
  organizationName?: string;
}

interface VerificationResponse {
  valid: boolean;
  error?: string;
  invitation?: InvitationDetails;
}

interface AcceptResponse {
  success: boolean;
  workspaceId: string;
  email: string;
  name: string;
  picture?: string;
}

interface LoginWorkspaceResponse {
  user: {
    id: string;
    email: string;
    name: string;
    picture?: string;
    workspaceId?: string;
  };
  isNewUser: boolean;
}

interface ApiErrorResponse {
  error?: string;
  message?: string;
}

type PageState =
  | { status: 'redirecting' }
  | { status: 'verifying' }
  | { status: 'email_mismatch'; loggedInEmail: string; invitedEmail: string }
  | { status: 'ready'; invitation: InvitationDetails }
  | { status: 'accepting' }
  | { status: 'expired'; message: string }
  | { status: 'error'; message: string };

export const AcceptInvitation = (): ReactElement => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const invitationId = searchParams.get('invitationId');
  const loginComplete = searchParams.get('loginComplete') === 'true';
  const loggedInEmail = searchParams.get('loggedInEmail') ?? '';

  const [state, setState] = useState<PageState>(
    loginComplete ? { status: 'verifying' } : { status: 'redirecting' },
  );

  // First visit: set pending cookie, logout current session, redirect to OAuth
  useEffect(() => {
    if (loginComplete) return;

    if (!invitationId) {
      setState({ status: 'error', message: 'Invalid invitation link. No invitation ID provided.' });
      return;
    }

    document.cookie = `pending_invitation_id=${invitationId}; path=/; max-age=600; SameSite=Lax`;
    authActor.send({ type: 'LOGOUT' });
    void navigate('/auth');
  }, [loginComplete, invitationId, navigate]);

  // Post-OAuth return: verify invitation and check logged-in email matches
  useEffect(() => {
    if (!loginComplete) return;

    if (!invitationId) {
      setState({ status: 'error', message: 'Invalid invitation link. No invitation ID provided.' });
      return;
    }

    const verify = async (): Promise<void> => {
      try {
        const response = await axios.get<VerificationResponse>(
          `${API_BASE_URL}/invitations/${invitationId}/verify`,
        );

        if (response.data.valid && response.data.invitation) {
          const inv = response.data.invitation;

          // Frontend email-match guard (backend also validates this on accept)
          if (loggedInEmail && inv.email.toLowerCase() !== loggedInEmail.toLowerCase()) {
            setState({ status: 'email_mismatch', loggedInEmail, invitedEmail: inv.email });
          } else {
            setState({ status: 'ready', invitation: inv });
          }
        }
      } catch (error) {
        if (axios.isAxiosError<ApiErrorResponse>(error)) {
          if (error.response?.status === 410) {
            setState({
              status: 'expired',
              message: error.response.data?.error ?? 'This invitation has expired.',
            });
          } else {
            setState({
              status: 'error',
              message: error.response?.data?.error ?? 'Invitation not found.',
            });
          }
        } else {
          setState({ status: 'error', message: 'Failed to verify invitation. Please try again.' });
        }
      }
    };

    void verify();
  }, [loginComplete, invitationId, loggedInEmail]);

  const handleAccept = async (): Promise<void> => {
    if (!invitationId || state.status !== 'ready') return;

    setState({ status: 'accepting' });
    try {
      // Step 1: Accept invitation — creates workspace user, marks invitation accepted
      // Backend reads google_access_token cookie for identity (does NOT clear it)
      const acceptResponse = await axios.post<AcceptResponse>(
        `${API_BASE_URL}/invitations/${invitationId}/accept`,
        {},
        { withCredentials: true },
      );

      const { workspaceId } = acceptResponse.data;

      // Step 2: Login to workspace — issues JWT cookie, clears google_access_token cookie
      const loginResponse = await axios.post<LoginWorkspaceResponse>(
        `${API_BASE_URL}/auth/login-workspace`,
        { workspaceId },
        { withCredentials: true },
      );

      const { user } = loginResponse.data;

      // Step 3: Prime localStorage so authMachine's hasStoredSession guard fires on reload
      localStorage.setItem('user_id', user.id);
      if (user.email) {
        localStorage.setItem('user_email', user.email);
        // Update last active workspace so re-login also lands in the correct workspace
        setLastActiveWorkspaceId(user.email, workspaceId);
      }

      // Clear pending invitation cookie so a subsequent re-login (e.g. after workspace
      // switch) goes through the normal auth flow rather than hitting this stale invitation.
      Cookies.remove('pending_invitation_id', { path: '/' });

      // Step 4: Full page reload directly to workspace — authMachine validates JWT via cookie
      window.location.replace(`/${workspaceId}`);
    } catch (error) {
      if (axios.isAxiosError<ApiErrorResponse>(error)) {
        setState({
          status: 'error',
          message: error.response?.data?.error ?? 'Failed to accept invitation.',
        });
      } else {
        setState({ status: 'error', message: 'Failed to accept invitation. Please try again.' });
      }
    }
  };

  const handleGoHome = (): void => {
    void navigate('/');
  };

  if (
    state.status === 'redirecting' ||
    state.status === 'verifying' ||
    state.status === 'accepting'
  ) {
    return (
      <div className='min-h-screen bg-background flex items-center justify-center'>
        <div className='text-center'>
          <Loader2 className='w-8 h-8 animate-spin mx-auto mb-4 text-foreground' />
          <p className='text-muted-foreground'>
            {state.status === 'redirecting'
              ? 'Redirecting to login...'
              : state.status === 'verifying'
                ? 'Verifying invitation...'
                : 'Accepting invitation...'}
          </p>
        </div>
      </div>
    );
  }

  if (state.status === 'email_mismatch') {
    return (
      <div className='min-h-screen bg-background flex items-center justify-center p-4'>
        <div className='max-w-md w-full bg-card border border-border rounded-lg p-8 text-center'>
          <div className='w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-4'>
            <XCircle className='w-8 h-8 text-destructive' />
          </div>
          <h1 className='text-2xl font-semibold text-foreground mb-2'>
            You are not supposed to access this invitation
          </h1>
          <Button onClick={handleGoHome} className='w-full'>
            Go to Home
          </Button>
        </div>
      </div>
    );
  }

  if (state.status === 'expired') {
    return (
      <div className='min-h-screen bg-background flex items-center justify-center p-4'>
        <div className='max-w-md w-full bg-card border border-border rounded-lg p-8 text-center'>
          <div className='w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-4'>
            <XCircle className='w-8 h-8 text-destructive' />
          </div>
          <h1 className='text-2xl font-semibold text-foreground mb-2'>Invitation Expired</h1>
          <p className='text-muted-foreground mb-6'>{state.message}</p>
          <Button onClick={handleGoHome} className='w-full'>
            Go to Home
          </Button>
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className='min-h-screen bg-background flex items-center justify-center p-4'>
        <div className='max-w-md w-full bg-card border border-border rounded-lg p-8 text-center'>
          <div className='w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-4'>
            <XCircle className='w-8 h-8 text-destructive' />
          </div>
          <h1 className='text-2xl font-semibold text-foreground mb-2'>Invalid Invitation</h1>
          <p className='text-muted-foreground mb-6'>{state.message}</p>
          <Button onClick={handleGoHome} className='w-full'>
            Go to Home
          </Button>
        </div>
      </div>
    );
  }

  // state.status === 'ready'
  const { invitation } = state;

  return (
    <div className='min-h-screen bg-background flex items-center justify-center p-4'>
      <div className='max-w-md w-full bg-card border border-border rounded-lg p-8 text-center'>
        <div className='w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4'>
          <MailPlus className='w-8 h-8 text-primary' />
        </div>

        <h1 className='text-2xl font-semibold text-foreground mb-2'>You&apos;re Invited!</h1>

        <p className='text-muted-foreground mb-6'>
          You&apos;ve been invited to join{' '}
          <strong className='text-foreground'>{invitation.workspaceName || 'a workspace'}</strong>
          {invitation.organizationName && (
            <>
              {' '}
              at <strong className='text-foreground'>{invitation.organizationName}</strong>
            </>
          )}
          .
        </p>

        <div className='bg-muted rounded-lg p-4 mb-6 text-left'>
          <div className='flex items-center gap-3 mb-2'>
            <CheckCircle className='w-5 h-5 text-green-500' />
            <span className='text-sm text-foreground'>Invitation verified</span>
          </div>
          <p className='text-sm text-muted-foreground'>
            Email: <span className='text-foreground'>{invitation.email}</span>
          </p>
          <p className='text-sm text-muted-foreground'>
            Role:{' '}
            <span className='text-foreground capitalize'>{invitation.role?.toLowerCase()}</span>
          </p>
        </div>

        <Button onClick={() => void handleAccept()} className='w-full'>
          Accept Invitation
        </Button>
      </div>
    </div>
  );
};

export default AcceptInvitation;
