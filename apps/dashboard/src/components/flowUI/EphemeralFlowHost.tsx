import React, { useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { Dialog } from '../ui/Dialog';
import { FlowScreenManager } from './FlowScreenManager';
import { RenderMessageWithHTML } from '../Chat/RenderMessageWithHTML/RenderMessageWithHTML';
import {
  useEphemeralMessageBridge,
  useEphemeralOpenScreen,
  dismissEphemeralMessage,
} from '@/hooks/useEphemeralMessages';

/**
 * Channel currently on screen, read from the URL (`/chat/<section>/<channelId>`)
 * the same way useRouteContext parses it.
 *
 * Taken from the route rather than from a channel component because this host is
 * mounted once for the session: ConversationPanelV2 renders in the search side
 * panel as well as the main view, so hanging the popup off it could show two at
 * once — or none, on a route that has no panel.
 */
function useActiveChannelId(): string | undefined {
  const { pathname } = useLocation();
  return useMemo(() => {
    const segments = pathname.split('/');
    const chatIndex = segments.indexOf('chat');
    if (chatIndex === -1) return undefined;
    return segments[chatIndex + 2] || undefined;
  }, [pathname]);
}

/**
 * Renders OPENSCREEN cards delivered by chat.postEphemeral.
 *
 * Mounted once for the session, beside NotificationHandler, and also owns the
 * socket subscription for both delivery modes (see useEphemeralMessageBridge) —
 * so it stays mounted and returns null rather than being conditionally rendered.
 *
 * EPHEMERAL cards are not handled here at all. They render inline in the channel
 * or thread they were addressed to, through ChatListV4 and ThreadPannel.
 */
export const EphemeralFlowHost: React.FC = () => {
  useEphemeralMessageBridge();

  const activeChannelId = useActiveChannelId();
  const current = useEphemeralOpenScreen(activeChannelId);

  const handleClose = useCallback((): void => {
    if (current) dismissEphemeralMessage(current.messageId);
  }, [current]);

  if (!current) return null;

  const flowJSON = current.flowJSON;
  return (
    <Dialog
      open
      onOpenChange={open => !open && handleClose()}
      title={flowJSON?.title ?? 'Message'}
      description='Ephemeral message — visible only to you, and gone when you reload'
      className='max-w-lg p-4 max-h-[85vh] overflow-hidden'
    >
      {flowJSON ? (
        // Rendered from the flow object the server sent, not by re-parsing the
        // escaped copy embedded in `content`. `onClose` fires when the app answers
        // a submit with close_screen, which is how an app dismisses its own card;
        // `ack` deliberately leaves it open.
        <FlowScreenManager
          key={current.messageId}
          flow={flowJSON}
          messageId={current.messageId}
          conversationId={current.conversationId}
          onClose={handleClose}
          // This is a popup, so the first screen is a popup screen: bounded, with
          // its action bar in a footer. Without this the Dialog scrolls the whole
          // screen and the buttons sit below the fold.
          compact
        />
      ) : (
        <RenderMessageWithHTML
          message={current.content}
          messageId={current.messageId}
          conversationId={current.conversationId}
        />
      )}
    </Dialog>
  );
};
