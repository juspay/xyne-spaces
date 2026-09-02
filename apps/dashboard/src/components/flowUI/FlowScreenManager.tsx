import React, { useState, useCallback, useEffect, useRef } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X, ChevronLeft } from 'lucide-react';
import { FlowRenderer } from './FlowRenderer';
import type { FlowDefinition, AppActionResponse, FlowState } from '@xyne/shared';
import { toast } from 'sonner';
import type { FlowMessageContext } from './FlowContext';
import { useAuthContextValues } from '../../hooks/useAuth';
import { isApprovalHiddenFromViewer } from './approvalVisibility';
import { RestrictedApprovalPlaceholder } from './RestrictedApprovalPlaceholder';

interface FlowScreenManagerProps {
  /** Initial screen — rendered inline inside the message bubble */
  flow: FlowDefinition;
  messageId: string;
  conversationId: string;
  /** Called when the flow is fully closed (close_screen with empty stack) */
  onClose?: (finalMessage?: string) => void;
  messageContext?: FlowMessageContext;
}

/**
 * Manages a stack of FlowDefinition screens.
 *
 * - screenStack[0]  → rendered inline inside the message bubble
 * - screenStack[1+] → rendered in a centered popup overlay
 *
 * Navigation:
 * - open_screen:        push new screen (opens popup)
 * - next_screen:        replace top screen
 * - close_screen:       pop; returns to inline when stack reaches 1
 * - update_screen_data: merge data into current screen
 */
export const FlowScreenManager: React.FC<FlowScreenManagerProps> = ({
  flow,
  messageId,
  conversationId,
  onClose,
  messageContext,
}) => {
  const [screenStack, setScreenStack] = useState<FlowDefinition[]>([flow]);

  // Visibility gate: some approval cards (HITL write, skill-update, clone,
  // mcp-configure) are addressed to a SINGLE user — the server rejects any
  // other clicker with a 403. Hide the actionable card from everyone except
  // that intended approver so the rest of the thread isn't shown buttons they
  // cannot use. Fails open: if the intended user can't be determined, or this
  // isn't an approval card, the flow renders unchanged.
  const { userID } = useAuthContextValues();
  const hiddenFromViewer = isApprovalHiddenFromViewer(flow, userID);

  // Live re-sync of the inline (base) screen when the agent UPDATES this
  // message's flow in place — e.g. a plan/todo card advancing
  // proposed → executing → done, or being greyed out as superseded. Zero
  // replicates the messages.content UPDATE and RenderMessageWithHTML passes a
  // fresh `flow` prop, but the React key (screenId) is STABLE across an in-place
  // update, so this component re-renders WITHOUT remounting — meaning the
  // one-time `useState([flow])` seed above would otherwise stay frozen and the
  // card would only refresh after a thread close/reopen (the reported "have to
  // reopen to see progress" bug). `flow` is a new object every render (parsed
  // fresh from data-flow-json), so key the effect on a stable serialization to
  // avoid an update loop. Only the inline base [0] is replaced; any open popup
  // stack (screenStack[1+]) is preserved. FlowRenderer reseeds its own
  // validated flow from the new prop (same screenId ⇒ user form values kept).
  const flowKey = JSON.stringify(flow);
  const flowRef = useRef(flow);
  flowRef.current = flow;
  useEffect(() => {
    setScreenStack(prev =>
      prev.length <= 1 ? [flowRef.current] : [flowRef.current, ...prev.slice(1)],
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowKey]);

  const inlineScreen = screenStack[0]!;
  const popupScreen = screenStack.length > 1 ? screenStack[screenStack.length - 1] : null;
  const popupOpen = screenStack.length > 1;

  const handleAppAction = useCallback(
    (response: AppActionResponse) => {
      switch (response.type) {
        case 'open_screen':
          setScreenStack(prev => [...prev, response.flowJSON]);
          break;

        case 'next_screen':
          setScreenStack(prev => {
            if (prev.length <= 1) return [...prev, response.flowJSON];
            return [...prev.slice(0, -1), response.flowJSON];
          });
          break;

        case 'close_screen':
          setScreenStack(prev => {
            if (prev.length <= 1) {
              onClose?.(response.finalMessage);
            }
            // Always collapse the entire popup back to inline
            return [prev[0]!];
          });
          break;

        case 'update_screen_data': {
          setScreenStack(prev => {
            if (prev.length === 0) return prev;
            const current = prev[prev.length - 1]!;
            const mergedData = { ...(current.data ?? {}), ...response.data };

            let components = current.components;
            if (response.componentUpdates && Object.keys(response.componentUpdates).length > 0) {
              components = patchComponents(current.components, response.componentUpdates);
            }

            const updated: FlowDefinition = { ...current, data: mergedData, components };
            return [...prev.slice(0, -1), updated];
          });
          break;
        }

        case 'ack':
          // `ack` carries an optional message; only show a toast when one is set,
          // so a handler can acknowledge silently.
          if (response.message) toast.success(response.message);
          break;

        case 'error':
          toast.error(response.message);
          break;
      }
    },
    [onClose],
  );

  const closePopup = useCallback(() => {
    setScreenStack(prev => (prev.length > 1 ? [prev[0]!] : prev));
  }, []);

  const goBack = useCallback(() => {
    setScreenStack(prev => (prev.length > 2 ? prev.slice(0, -1) : prev));
  }, []);

  // True when there are 2+ popup screens stacked (stack length > 2 means inline + 2+ popups)
  const hasMultiplePopups = screenStack.length > 2;

  // Persist form state back into the current top-of-stack FlowDefinition so that
  // navigating back restores whatever the user had already filled in.
  const handlePopupStateChange = useCallback((newState: FlowState) => {
    setScreenStack(prev => {
      if (prev.length <= 1) return prev;
      const last = prev[prev.length - 1]!;
      // Always reset submitting so the screen isn't frozen when navigating back to it
      const cleanState: FlowState = { ...newState, submitting: false };
      return [...prev.slice(0, -1), { ...last, state: cleanState }];
    });
  }, []);

  if (hiddenFromViewer) {
    return <RestrictedApprovalPlaceholder />;
  }

  return (
    <>
      {/* ── Inline screen (original postMessage flow) ── */}
      <FlowRenderer
        key={inlineScreen.screenId}
        flow={inlineScreen}
        messageId={messageId}
        conversationId={conversationId}
        {...(messageContext && { messageContext })}
        onAppAction={handleAppAction}
        compact={false}
      />

      {/* ── Popup for action-response screens ── */}
      <DialogPrimitive.Root open={popupOpen} onOpenChange={open => !open && closePopup()}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className='fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0' />

          <DialogPrimitive.Content
            className='fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm focus:outline-none
              data-[state=open]:animate-in data-[state=closed]:animate-out
              data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0
              data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95
              data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]
              data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]
              duration-200'
          >
            <DialogPrimitive.Title className='sr-only'>
              {popupScreen?.title ?? 'Flow action'}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className='sr-only'>
              App flow action screen
            </DialogPrimitive.Description>

            <div className='rounded-xl border border-border bg-popover text-popover-foreground shadow-xl overflow-hidden'>
              {/* Header */}
              <div className='flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted'>
                <div className='flex items-center gap-1'>
                  {hasMultiplePopups && (
                    <button
                      onClick={goBack}
                      className='rounded-md p-0.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors mr-1'
                      aria-label='Back'
                      data-track-category='flow'
                      data-track-name='back-popup'
                    >
                      <ChevronLeft className='size-3.5' />
                    </button>
                  )}
                  <span className='text-xs font-semibold text-foreground uppercase tracking-wide'>
                    {popupScreen?.title ?? 'Action'}
                  </span>
                </div>
                <button
                  onClick={closePopup}
                  className='rounded-md p-0.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors'
                  aria-label='Close'
                  data-track-category='flow'
                  data-track-name='close-popup'
                >
                  <X className='size-3.5' />
                </button>
              </div>

              {/* Content */}
              <div className='p-3'>
                {popupScreen && (
                  <FlowRenderer
                    key={popupScreen.screenId}
                    flow={popupScreen}
                    messageId={messageId}
                    conversationId={conversationId}
                    {...(messageContext && { messageContext })}
                    onAppAction={handleAppAction}
                    onStateChange={handlePopupStateChange}
                    compact={true}
                  />
                )}
              </div>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
};

// ── Helpers ──────────────────────────────────────────────────────────────────

import type { FlowComponent } from '@xyne/shared';

function patchComponents(
  components: FlowComponent[],
  updates: Record<string, Partial<Pick<FlowComponent, 'props' | 'hidden' | 'disabled'>>>,
): FlowComponent[] {
  return components.map(c => {
    const patch = updates[c.id];
    const patched: FlowComponent = patch
      ? {
          ...c,
          ...(patch.hidden !== undefined && { hidden: patch.hidden }),
          ...(patch.disabled !== undefined && { disabled: patch.disabled }),
          ...(patch.props !== undefined && { props: { ...(c.props ?? {}), ...patch.props } }),
        }
      : c;
    if (patched.children?.length) {
      return { ...patched, children: patchComponents(patched.children, updates) };
    }
    return patched;
  });
}
