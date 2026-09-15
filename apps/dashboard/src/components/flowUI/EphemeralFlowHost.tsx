import React, { useCallback, useMemo } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
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
  const title = flowJSON?.title ?? 'Message';

  return (
    <DialogPrimitive.Root open onOpenChange={open => !open && handleClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className='fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0' />

        <DialogPrimitive.Content
          className='fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm focus:outline-none
            data-[state=open]:animate-in data-[state=closed]:animate-out
            data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0
            data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95
            duration-200'
        >
          <DialogPrimitive.Title className='sr-only'>{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className='sr-only'>
            Ephemeral message — visible only to you, and gone when you reload
          </DialogPrimitive.Description>

          <div className='rounded-xl border border-border bg-popover text-popover-foreground shadow-xl overflow-hidden'>
            <div className='flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted'>
              <span className='text-xs font-semibold text-foreground uppercase tracking-wide'>
                {title}
              </span>
              <button
                onClick={handleClose}
                className='rounded-md p-0.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors'
                aria-label='Close'
                data-track-category='flow'
                data-track-name='close-ephemeral'
              >
                <X className='size-3.5' />
              </button>
            </div>

            <div className='px-4 py-3 max-h-[70vh] overflow-y-auto'>
              {flowJSON ? (
                // Rendered from the flow object the server sent, not by re-parsing
                // the escaped copy embedded in `content`. `onClose` fires when the
                // app answers a submit with close_screen, which is how an app
                // dismisses its own card; `ack` deliberately leaves it open.
                <FlowScreenManager
                  key={current.messageId}
                  flow={flowJSON}
                  messageId={current.messageId}
                  conversationId={current.conversationId}
                  onClose={handleClose}
                />
              ) : (
                <RenderMessageWithHTML
                  message={current.content}
                  messageId={current.messageId}
                  conversationId={current.conversationId}
                />
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
