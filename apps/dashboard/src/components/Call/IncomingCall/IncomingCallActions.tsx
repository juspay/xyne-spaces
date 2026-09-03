import { Phone, X } from 'lucide-react';
import type { ReactElement } from 'react';

interface IncomingCallActionsProps {
  callId: string;
  /** Accept becomes a labelled pill, because it ends the call you are on. */
  isInActiveCall: boolean;
  onAccept: () => void;
  onReject: () => void;
}

const CIRCLE =
  'flex h-14 w-14 items-center justify-center rounded-full border-none p-0 ' +
  'cursor-pointer transition-colors duration-[120ms] ease-out ' +
  // Colour only on hover — the design system forbids transform on these.
  'focus-visible:outline-none';

const DECLINE_COLORS =
  'bg-[var(--call-decline-bg)] text-[var(--call-decline-fg)] ' +
  'hover:bg-[var(--call-decline-bg-hover)] active:bg-[var(--call-decline-bg-active)] ' +
  'focus-visible:shadow-[0_0_0_2px_hsl(var(--popover)),0_0_0_5px_rgb(224_30_30/0.5)]';

const ACCEPT_COLORS =
  'bg-[var(--call-accept-bg)] text-[var(--call-accept-fg)] ' +
  'hover:bg-[var(--call-accept-bg-hover)] active:bg-[var(--call-accept-bg-active)] ' +
  'focus-visible:shadow-[0_0_0_2px_hsl(var(--popover)),0_0_0_5px_rgb(from_var(--call-accept-bg)_r_g_b/0.5)]';

const LABEL = 'mt-2 text-xs font-medium text-muted-foreground';

/**
 * The one action pair, identical for every call — there is no audio/video
 * distinction to express.
 *
 * The `data-track-name` attributes sit on the buttons themselves because the
 * calls e2e suite clicks them by that selector; moving them to a wrapper would
 * make Playwright click a non-interactive node.
 */
export function IncomingCallActions({
  callId,
  isInActiveCall,
  onAccept,
  onReject,
}: IncomingCallActionsProps): ReactElement {
  const trackMetadata = JSON.stringify({ isInActiveCall, callId });

  return (
    <div className='flex items-start justify-center gap-6'>
      <div className='flex flex-col items-center'>
        <button
          type='button'
          onClick={onReject}
          aria-label='Decline call'
          className={`${CIRCLE} ${DECLINE_COLORS}`}
          data-track-category='CALLS_NOTIFICATIONS'
          data-track-name='REJECT_INCOMING_CALL'
          data-track-metadata={trackMetadata}
        >
          <X className='h-[22px] w-[22px]' strokeWidth={2} />
        </button>
        {/* The Switch-call pill carries its label inline, so a lone caption
            under the circle beside it reads as a stray. The button keeps its
            aria-label either way. */}
        {!isInActiveCall && <span className={LABEL}>Decline</span>}
      </div>

      {isInActiveCall ? (
        <button
          type='button'
          onClick={onAccept}
          className={
            'flex h-14 cursor-pointer items-center gap-[9px] rounded-full border-none ' +
            'px-[26px] text-sm font-semibold transition-colors duration-[120ms] ease-out ' +
            `focus-visible:outline-none ${ACCEPT_COLORS}`
          }
          data-track-category='CALLS_NOTIFICATIONS'
          data-track-name='ACCEPT_INCOMING_CALL'
          data-track-metadata={trackMetadata}
        >
          <Phone className='h-[22px] w-[22px]' strokeWidth={2} />
          <span>Switch call</span>
        </button>
      ) : (
        <div className='flex flex-col items-center'>
          <button
            type='button'
            onClick={onAccept}
            aria-label='Accept call'
            className={`${CIRCLE} ${ACCEPT_COLORS}`}
            data-track-category='CALLS_NOTIFICATIONS'
            data-track-name='ACCEPT_INCOMING_CALL'
            data-track-metadata={trackMetadata}
          >
            <Phone className='h-[22px] w-[22px]' strokeWidth={2} />
          </button>
          <span className={LABEL}>Accept</span>
        </div>
      )}
    </div>
  );
}
