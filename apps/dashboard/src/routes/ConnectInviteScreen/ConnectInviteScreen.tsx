import { ReactElement, useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, Loader2, Link2, Hash } from 'lucide-react';
import { Button } from '../../components/ui/Button/Button';
import Input from '../../components/ui/Input/Input';
import { useAuth } from '../../hooks/useAuth';
import { apiInstance } from '../../services/clients/apiClient';
import {
  connectRequestService,
  type ConnectInviteVerifyInfo,
} from '../../services/Chat/connectRequestService';

interface WorkspaceItem {
  id: string;
  name: string;
  role: string;
  orgName: string;
}

type Visibility = 'PUBLIC' | 'PRIVATE';

type PageState =
  | { status: 'redirecting' }
  | { status: 'verifying' }
  | { status: 'ready'; info: ConnectInviteVerifyInfo }
  | { status: 'accepting'; info: ConnectInviteVerifyInfo }
  | { status: 'accepted'; info: ConnectInviteVerifyInfo }
  | { status: 'error'; message: string };

const CONNECT_INVITE_RETURN_KEY = 'pending_connect_invite_url';

export const ConnectInviteScreen = (): ReactElement => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();

  const token = searchParams.get('token');

  const [state, setState] = useState<PageState>({ status: 'verifying' });

  // Form state
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [guestWorkspaceId, setGuestWorkspaceId] = useState('');
  const [channelName, setChannelName] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('PRIVATE');

  // Gate on authentication — preserve the return URL like AcceptInvitation does.
  useEffect(() => {
    if (isAuthLoading) return;
    if (!isAuthenticated) {
      setState({ status: 'redirecting' });
      try {
        localStorage.setItem(
          CONNECT_INVITE_RETURN_KEY,
          window.location.pathname + window.location.search,
        );
      } catch {
        // ignore storage failures
      }
      void navigate('/auth');
    }
  }, [isAuthenticated, isAuthLoading, navigate]);

  // Verify the token once authenticated.
  useEffect(() => {
    if (isAuthLoading || !isAuthenticated) return;

    if (!token) {
      setState({ status: 'error', message: 'Invalid invite link. No token provided.' });
      return;
    }

    const verify = async (): Promise<void> => {
      try {
        const info = await connectRequestService.verify(token);
        setChannelName(info.channelName ?? '');
        if (info.channelVisibility === 'PUBLIC' || info.channelVisibility === 'PRIVATE') {
          setVisibility(info.channelVisibility);
        }
        setState({ status: 'ready', info });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to verify this invite link.';
        setState({ status: 'error', message });
      }
    };

    void verify();
  }, [token, isAuthenticated, isAuthLoading]);

  // Load the user's workspaces to pick a guest workspace (excluding the host workspace).
  useEffect(() => {
    if (state.status !== 'ready') return;

    const hostName = state.info.hostWorkspaceName;
    const loadWorkspaces = async (): Promise<void> => {
      try {
        const res = await apiInstance.get<{ workspaces: WorkspaceItem[] }>('/auth/workspaces');
        const available = (res.data.workspaces ?? []).filter(
          ws => !hostName || ws.name !== hostName,
        );
        setWorkspaces(available);
        if (available.length > 0 && available[0]) {
          setGuestWorkspaceId(current => current || available[0]!.id);
        }
      } catch {
        // Non-fatal — the user can still see the invite; submit will validate.
      }
    };

    void loadWorkspaces();
  }, [state]);

  const handleAccept = async (): Promise<void> => {
    if (state.status !== 'ready' || !token) return;
    if (!guestWorkspaceId) {
      setState({ status: 'error', message: 'Please select a workspace to accept the invite in.' });
      return;
    }

    const info = state.info;
    setState({ status: 'accepting', info });
    try {
      const trimmedName = channelName.trim();
      await connectRequestService.accept(token, {
        guestWorkspaceId,
        visibility,
        ...(trimmedName ? { channelName: trimmedName } : {}),
      });
      setState({ status: 'accepted', info });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to accept this invite. Please try again.';
      setState({ status: 'error', message });
    }
  };

  const handleGoHome = (): void => {
    void navigate('/');
  };

  if (state.status === 'redirecting' || state.status === 'verifying') {
    return (
      <div className='min-h-screen bg-background flex items-center justify-center'>
        <div className='text-center'>
          <Loader2 className='w-8 h-8 animate-spin mx-auto mb-4 text-foreground' />
          <p className='text-muted-foreground'>
            {state.status === 'redirecting' ? 'Redirecting to login...' : 'Verifying invite...'}
          </p>
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
          <h1 className='text-2xl font-semibold text-foreground mb-2'>Invalid Invite</h1>
          <p className='text-muted-foreground mb-6'>{state.message}</p>
          <Button onClick={handleGoHome} className='w-full'>
            Go to Home
          </Button>
        </div>
      </div>
    );
  }

  if (state.status === 'accepted') {
    return (
      <div className='min-h-screen bg-background flex items-center justify-center p-4'>
        <div className='max-w-md w-full bg-card border border-border rounded-lg p-8 text-center'>
          <div className='w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4'>
            <CheckCircle className='w-8 h-8 text-green-500' />
          </div>
          <h1 className='text-2xl font-semibold text-foreground mb-2'>Invite accepted</h1>
          <p className='text-muted-foreground mb-6'>
            Sent to your workspace admin for approval. Once they approve, the shared channel will
            appear in your workspace.
          </p>
          <Button onClick={handleGoHome} className='w-full'>
            Go to App
          </Button>
        </div>
      </div>
    );
  }

  // ready | accepting
  const { info } = state;
  const isAccepting = state.status === 'accepting';

  return (
    <div className='min-h-screen bg-background flex items-center justify-center p-4'>
      <div className='max-w-md w-full bg-card border border-border rounded-lg p-8'>
        <div className='text-center'>
          <div className='w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4'>
            <Link2 className='w-8 h-8 text-primary' />
          </div>
          <h1 className='text-2xl font-semibold text-foreground mb-2'>You&apos;re invited</h1>
          <p className='text-muted-foreground mb-6'>
            {info.hostWorkspaceName ? (
              <>
                <strong className='text-foreground'>{info.hostWorkspaceName}</strong> invited you to
                a shared channel
              </>
            ) : (
              <>You&apos;ve been invited to a shared channel</>
            )}
          </p>
        </div>

        <div className='bg-muted rounded-lg p-4 mb-6 text-left space-y-2'>
          <div className='flex items-center gap-3'>
            <CheckCircle className='w-5 h-5 text-green-500' />
            <span className='text-sm text-foreground'>Invite verified</span>
          </div>
          <p className='text-sm text-muted-foreground'>
            Email: <span className='text-foreground'>{info.inviteEmail}</span>
          </p>
          {info.channelName && (
            <p className='text-sm text-muted-foreground flex items-center gap-1'>
              Channel:{' '}
              <span className='text-foreground inline-flex items-center gap-0.5'>
                <Hash className='w-3.5 h-3.5' />
                {info.channelName}
              </span>
            </p>
          )}
          {info.channelVisibility && (
            <p className='text-sm text-muted-foreground'>
              Visibility:{' '}
              <span className='text-foreground capitalize'>
                {info.channelVisibility.toLowerCase()}
              </span>
            </p>
          )}
        </div>

        {/* Accept form */}
        <div className='space-y-4'>
          <div>
            <label
              htmlFor='connect-invite-workspace'
              className='block text-sm font-medium text-foreground mb-1.5'
            >
              Workspace
            </label>
            {workspaces.length > 0 ? (
              <select
                id='connect-invite-workspace'
                value={guestWorkspaceId}
                onChange={e => setGuestWorkspaceId(e.target.value)}
                disabled={isAccepting}
                data-track-category='CONNECT_CHANNEL'
                data-track-name='connect_invite_workspace_select'
                className='w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60'
              >
                {workspaces.map(ws => (
                  <option key={ws.id} value={ws.id}>
                    {ws.name}
                  </option>
                ))}
              </select>
            ) : (
              <p className='text-sm text-muted-foreground'>
                Loading your workspaces… If none appear, you have no eligible workspace to accept
                this invite in.
              </p>
            )}
            <p className='mt-1 text-xs text-muted-foreground'>
              The shared channel will be added to this workspace.
            </p>
          </div>

          <div>
            <label
              htmlFor='connect-invite-channel-name'
              className='block text-sm font-medium text-foreground mb-1.5'
            >
              Channel name
            </label>
            <Input
              id='connect-invite-channel-name'
              value={channelName}
              onChange={e => setChannelName(e.target.value)}
              placeholder='Channel name'
              disabled={isAccepting}
            />
          </div>

          <div>
            <label
              htmlFor='connect-invite-visibility'
              className='block text-sm font-medium text-foreground mb-1.5'
            >
              Visibility
            </label>
            <select
              id='connect-invite-visibility'
              value={visibility}
              onChange={e => setVisibility(e.target.value as Visibility)}
              disabled={isAccepting}
              data-track-category='CONNECT_CHANNEL'
              data-track-name='connect_invite_visibility_select'
              className='w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60'
            >
              <option value='PRIVATE'>Private</option>
              <option value='PUBLIC'>Public</option>
            </select>
          </div>

          <Button
            onClick={() => void handleAccept()}
            disabled={isAccepting || !guestWorkspaceId}
            loading={isAccepting}
            className='w-full'
          >
            Accept invite
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ConnectInviteScreen;
