import { useState } from 'react';
import type { ReactElement } from 'react';
import { IncomingCallCard } from './IncomingCallCard';
import { INCOMING_CALL_FIXTURES } from './IncomingCallCard.fixtures';

/**
 * Dev-only viewer for every incoming-call state.
 *
 * Most of these states cannot be produced on demand — some need a second
 * account and a booked meeting, three cannot ring at all — so this is the only
 * practical way to look at them. Open any page with `?devIncomingCall=1`.
 *
 * Combine with the theme picker and DevTools' "Emulate prefers-reduced-motion"
 * to cover every render the card has.
 */
const noop = (): void => {};

export function IncomingCallDevHarness(): ReactElement | null {
  const initial = Number(new URLSearchParams(window.location.search).get('devIncomingCall'));
  const [selected, setSelected] = useState(Number.isFinite(initial) && initial > 0 ? initial : 1);

  const fixture = INCOMING_CALL_FIXTURES.find(f => f.n === selected) ?? INCOMING_CALL_FIXTURES[0];
  if (!fixture) return null;

  return (
    <>
      {/* The card is inert here — this harness is for looking, not for
          exercising the accept/reject flow, which needs the real container. */}
      <IncomingCallCard vm={fixture.vm} onAccept={noop} onReject={noop} />

      <div className='fixed bottom-4 left-1/2 z-[60] flex max-w-[calc(100vw-32px)] -translate-x-1/2 flex-col gap-2 rounded-xl bg-popover p-3 text-popover-foreground shadow-lg ring-1 ring-border'>
        <div className='flex flex-wrap justify-center gap-1'>
          {INCOMING_CALL_FIXTURES.map(f => (
            <button
              key={f.n}
              type='button'
              onClick={() => setSelected(f.n)}
              title={f.label}
              data-track-category='DEV'
              data-track-name='INCOMING_CALL_FIXTURE_SELECT'
              className={`h-7 w-7 rounded-md text-xs font-medium ${
                f.n === selected
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground hover:bg-accent'
              }`}
            >
              {f.n}
            </button>
          ))}
        </div>
        <div className='max-w-[420px] text-center text-xs text-muted-foreground'>
          <span className='font-medium text-foreground'>{fixture.label}</span>
          {fixture.blocked && <div className='mt-1 italic'>Blocked today — {fixture.blocked}</div>}
        </div>
      </div>
    </>
  );
}
