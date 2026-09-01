import { ReactElement, useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, Loader2, FileText, Hash, Folder, Users } from 'lucide-react';
import { Button } from '../../components/ui/Button/Button';
import axios from 'axios';
import Cookies from 'js-cookie';
import { API_BASE_URL } from '../../config';
import {
  authActor,
  PENDING_WORKSPACE_ID_KEY,
  PENDING_WORKSPACE_NAME_KEY,
  setLastActiveWorkspaceId,
} from '../../machines/authMachine';

interface InvitationDetails {
  id: string;
  email: string;
  role: string;
  workspaceName?: string;
  organizationName?: string;
  entityType?: string;
  entityId?: string;
  entityTitle?: string | null;
  inviteExperience?: string;
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
  redirectPath?: string | null;
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
  | {
      status: 'accepted';
      workspaceId: string;
      invitation: InvitationDetails;
      redirectPath: string | null | undefined;
    }
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
    // ALSO store in localStorage so it survives navigation
    localStorage.setItem('pending_invitation_id', invitationId);
    localStorage.removeItem(PENDING_WORKSPACE_ID_KEY);
    localStorage.removeItem(PENDING_WORKSPACE_NAME_KEY);
    authActor.send({ type: 'LOGOUT' });
    void navigate(`/auth?invitationId=${invitationId}`);
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

      const { workspaceId, redirectPath } = acceptResponse.data;

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

      // Clear pending invitation cookie + localStorage so a subsequent re-login (e.g. after
      // workspace switch) goes through the normal auth flow rather than hitting this stale invitation.
      Cookies.remove('pending_invitation_id', { path: '/' });
      localStorage.removeItem('pending_invitation_id');

      // Show "Open in App" screen instead of redirecting immediately
      // Include invitation data so we can show the success screen
      if (state.status === 'ready') {
        setState({ status: 'accepted', workspaceId, invitation: state.invitation, redirectPath });
      } else {
        setState({
          status: 'accepted',
          workspaceId,
          invitation: {} as InvitationDetails,
          redirectPath,
        });
      }
    } catch (error) {
      Cookies.remove('pending_invitation_id', { path: '/' });
      localStorage.removeItem('pending_invitation_id');
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
    Cookies.remove('pending_invitation_id', { path: '/' });
    localStorage.removeItem('pending_invitation_id');
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
          <Button
            onClick={handleGoHome}
            data-track-category='Invitations'
            data-track-name='GO_HOME_FROM_INVITE'
            className='w-full'
          >
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
          <Button
            onClick={handleGoHome}
            data-track-category='Invitations'
            data-track-name='GO_HOME_FROM_INVITE'
            className='w-full'
          >
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
          <Button
            onClick={handleGoHome}
            data-track-category='Invitations'
            data-track-name='GO_HOME_FROM_INVITE'
            className='w-full'
          >
            Go to Home
          </Button>
        </div>
      </div>
    );
  }

  // state.status === 'accepted'
  if (state.status === 'accepted') {
    const isInElectron = typeof window.electronAPI?.openExternal === 'function';
    // New users must land on the workspace index so HomeScreen can redirect them
    // to the onboarding questionnaire; deep-link redirectPath is only for
    // returning users who have already completed onboarding.
    const isNewUser = Cookies.get('is_new_user') === 'true';
    let targetPath = state.redirectPath || `/${state.workspaceId}`;
    if (isNewUser || !targetPath.startsWith('/') || targetPath.startsWith('//')) {
      targetPath = `/${state.workspaceId}`;
    }

    if (isInElectron || state.invitation.inviteExperience === 'BROWSER') {
      // In Electron: JWT cookies are already set in session — go directly to the workspace.
      // authMachine will run validateSession (user_id is in localStorage) and land authenticated.
      // Browser-mode workspaces: same thing — skip the /launch deep-link entirely.
      window.location.href = targetPath;
    } else {
      // In browser, desktop-mode workspace: open Electron app via /launch deep-link so the user lands in the desktop app.
      const launchPath = targetPath.replace(/^\//, '');
      window.location.href = `/launch?path=${encodeURIComponent(launchPath)}`;
    }
    return <></>;
  }

  // state.status === 'ready'
  const { invitation } = state;

  // Entity-specific icon
  const getEntityIcon = (): ReactElement => {
    switch (invitation.entityType) {
      case 'CANVAS':
        return <FileText className='w-8 h-8 text-primary' />;
      case 'CHANNEL':
        return <Hash className='w-8 h-8 text-primary' />;
      case 'PROJECT':
        return <Folder className='w-8 h-8 text-primary' />;
      default:
        return <Users className='w-8 h-8 text-primary' />;
    }
  };

  // Entity-specific invite message
  const getInviteMessage = (): ReactElement => {
    if (invitation.entityType === 'CANVAS' && invitation.entityTitle) {
      return (
        <>
          You&apos;ve been invited to collaborate on{' '}
          <strong className='text-foreground'>&quot;{invitation.entityTitle}&quot;</strong>
        </>
      );
    }
    if (invitation.entityType === 'CHANNEL' && invitation.entityTitle) {
      return (
        <>
          You&apos;ve been invited to join{' '}
          <strong className='text-foreground'>#{invitation.entityTitle}</strong>
        </>
      );
    }
    if (invitation.entityType === 'PROJECT' && invitation.entityTitle) {
      return (
        <>
          You&apos;ve been invited to join{' '}
          <strong className='text-foreground'>{invitation.entityTitle}</strong>
        </>
      );
    }
    return (
      <>
        You&apos;ve been invited to join{' '}
        <strong className='text-foreground'>{invitation.workspaceName || 'a workspace'}</strong>
      </>
    );
  };

  return (
    <div className='min-h-screen bg-background flex items-center justify-center p-4'>
      <div className='max-w-md w-full bg-card border border-border rounded-lg p-8 text-center'>
        <div className='w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4'>
          {getEntityIcon()}
        </div>

        <h1 className='text-2xl font-semibold text-foreground mb-2'>You&apos;re Invited!</h1>

        <p className='text-muted-foreground mb-6'>{getInviteMessage()}</p>

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
          {invitation.entityType && (
            <p className='text-sm text-muted-foreground'>
              Access:{' '}
              <span className='text-foreground capitalize'>
                {invitation.entityType.toLowerCase()}
                {invitation.entityTitle ? `: ${invitation.entityTitle}` : ''}
              </span>
            </p>
          )}
        </div>

        <Button
          onClick={() => void handleAccept()}
          data-track-category='Invitations'
          data-track-name='ACCEPT_INVITATION'
          className='w-full'
        >
          Accept Invitation
        </Button>
      </div>
    </div>
  );
};

export default AcceptInvitation;
