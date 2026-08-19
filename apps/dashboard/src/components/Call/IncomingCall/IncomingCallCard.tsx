import * as DialogPrimitive from '@radix-ui/react-dialog';
import { AlertTriangle } from 'lucide-react';
import type { ReactElement } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useOverlayEffect } from '../../../machines/stateMachine';
import { cn } from '../../../utils/classNames';
import { IncomingCallActions } from './IncomingCallActions';
import { IncomingCallContextLine } from './IncomingCallContextLine';
import { IncomingCallIdentity } from './IncomingCallIdentity';
import type { IncomingCallViewModel } from './IncomingCallCard.types';

export interface IncomingCallCardProps {
  vm: IncomingCallViewModel;
  onAccept: () => void;
  onReject: () => void;
}

/**
 * The ringing card.
 *
 * Composed from Radix primitives rather than the shared `Dialog` for reasons
 * that a prop could not fix: that component swaps to a bottom-sheet Drawer
 * below 600px, which a fixed 400x520 card cannot live in, and its baked-in
 * zoom/slide entry classes survive `twMerge` and would fight this one's.
 *
 * Everything it renders comes from `vm` — no Zero, no XState, no router — which
 * is what lets `IncomingCallCard.dev.tsx` render every state from fixtures.
 */
export function IncomingCallCard({ vm, onAccept, onReject }: IncomingCallCardProps): ReactElement {
  const prefersReducedMotion = useReducedMotion();

  // The shared Dialog does this for us; done by hand here because other
  // features read the global overlay stack to decide whether they are covered.
  useOverlayEffect(true);

  return (
    <DialogPrimitive.Root open modal>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-[var(--call-modal-overlay)]',
            !prefersReducedMotion && 'animate-call-overlay-in',
          )}
        />

        <DialogPrimitive.Content
          data-testid='incoming-call-modal'
          // A ringing call is answered or declined deliberately. Dismissing the
          // card by pressing Escape or clicking away used to hang up on the
          // caller, which is far too easy to do by accident.
          onEscapeKeyDown={event => event.preventDefault()}
          onPointerDownOutside={event => event.preventDefault()}
          onInteractOutside={event => event.preventDefault()}
          className={cn(
            'incoming-call-card fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'flex w-[400px] max-w-[calc(100vw-32px)] flex-col rounded-[18px]',
            // Fixed height so back-to-back calls never resize the card, but it
            // must still fit a short viewport rather than run off the screen.
            'min-h-[520px] max-h-[calc(100vh-32px)] overflow-y-auto px-7 pb-6 pt-[26px]',
            'bg-popover text-popover-foreground ring-1 ring-border',
            'shadow-[var(--call-modal-shadow)] outline-none focus:outline-none',
            prefersReducedMotion ? 'animate-call-overlay-in' : 'animate-call-card-in',
          )}
        >
          <DialogPrimitive.Title className='hidden'>Incoming call</DialogPrimitive.Title>

          <IncomingCallContextLine context={vm.context} />

          {/* Takes the slack, so states with a shorter context line or no
              subtitle redistribute as whitespace instead of leaving a hole. */}
          <div className='flex flex-1 flex-col items-center justify-center py-5'>
            <IncomingCallIdentity identity={vm.identity} />

            <div className='mt-4 text-center text-lg font-semibold tracking-[-0.2px] text-foreground'>
              {vm.name}
            </div>

            {vm.subtitle && (
              <div className='mt-[5px] line-clamp-2 max-h-10 max-w-[340px] text-center text-sm leading-[1.4] text-muted-foreground [text-wrap:pretty]'>
                {vm.subtitle}
              </div>
            )}
          </div>

          {vm.isInActiveCall && (
            <div className='mb-4 flex items-start gap-2 rounded-[9px] bg-muted px-3 py-[9px] ring-1 ring-border'>
              <AlertTriangle className='mt-px h-3.5 w-3.5 shrink-0 text-[var(--call-notice-icon)]' />
              <span className='text-[12.5px] leading-[1.45] text-muted-foreground'>
                Accepting will end your current call
              </span>
            </div>
          )}

          <IncomingCallActions
            callId={vm.callId}
            isInActiveCall={vm.isInActiveCall}
            onAccept={onAccept}
            onReject={onReject}
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
