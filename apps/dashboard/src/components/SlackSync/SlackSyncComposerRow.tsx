import { useEffect, type ReactElement } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  useIsChannelSynced,
  useRefreshSlackMirror,
  useSlackSignIn,
} from '../../hooks/useSlackMirror';
import {
  disconnectSlackSignIn,
  slackMirrorErrorMessage,
  slackSignInUrl,
} from '../../services/clients/slackMirrorApi';
import { cn } from '../../utils/classNames';
import { signInErrorText } from './SlackSync.utils';

const SIGN_IN_TOAST_ID = 'slack-mirror-sign-in';

interface SlackSyncComposerRowProps {
  channelId: string;
}

/**
 * Above the message box of a synced channel: whether messages reach Slack as the person or through
 * the app, with Connect / Disconnect like desk's composer. Renders nothing in other channels.
 */
export function SlackSyncComposerRow({
  channelId,
}: SlackSyncComposerRowProps): ReactElement | null {
  const location = useLocation();
  const synced = useIsChannelSynced(channelId);
  const { data: signIn } = useSlackSignIn(synced);
  const refresh = useRefreshSlackMirror();
  useSignInReturn(() => void refresh.signIn());

  if (!synced || !signIn) return null;

  const connect = (): void => {
    const isElectron = typeof window.electronAPI?.openExternal === 'function';
    const url = slackSignInUrl(
      `${location.pathname}${location.search}`,
      isElectron ? 'electron' : 'web',
    );
    if (isElectron && window.electronAPI?.openExternal) window.electronAPI.openExternal(url);
    else window.location.href = url;
  };

  const disconnect = async (): Promise<void> => {
    try {
      await disconnectSlackSignIn();
      await refresh.signIn();
    } catch (error) {
      toast.error(slackMirrorErrorMessage(error, "Couldn't disconnect your Slack. Try again."));
    }
  };

  return (
    <div className='mx-3 mb-1 flex items-center gap-2 text-xs text-muted-foreground'>
      <span
        className={cn(
          'inline-block size-1.5 rounded-full',
          signIn.connected ? 'bg-green-500' : 'bg-muted-foreground',
        )}
      />
      <span>
        {signIn.connected
          ? 'In Slack, your messages appear as you.'
          : 'In Slack, your messages appear through the Mirror app.'}
      </span>
      <button
        type='button'
        onClick={signIn.connected ? (): void => void disconnect() : connect}
        className={cn(
          'text-xs underline cursor-pointer',
          signIn.connected
            ? 'text-muted-foreground hover:text-foreground'
            : 'text-primary hover:text-primary/80',
        )}
        data-track-category='slack-sync'
        data-track-name={signIn.connected ? 'disconnect-slack-user' : 'connect-slack-user'}
      >
        {signIn.connected ? 'Disconnect' : 'Connect your Slack'}
      </button>
    </div>
  );
}

/**
 * Slack sends the person back here with `gatewayAuth=connected` or `gatewayAuthError=<code>`. Every
 * message box on the page sees it; the toast id keeps it to one toast.
 */
function useSignInReturn(onConnected: () => void): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const connected = searchParams.get('gatewayAuth') === 'connected';
  const errorCode = searchParams.get('gatewayAuthError');

  useEffect(() => {
    if (!connected && !errorCode) return;
    if (connected) {
      toast.success('Slack connected. Your messages now reach Slack as you.', {
        id: SIGN_IN_TOAST_ID,
      });
      onConnected();
    } else if (errorCode) {
      toast.error(signInErrorText(errorCode), { id: SIGN_IN_TOAST_ID });
    }
    const next = new URLSearchParams(searchParams);
    next.delete('gatewayAuth');
    next.delete('gatewayAuthError');
    setSearchParams(next, { replace: true });
    // Runs once per return; onConnected is a fresh closure every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, errorCode]);
}
