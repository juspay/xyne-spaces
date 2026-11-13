/**
 * Pieces every preview shares: the phone the app runs on, the small signs of
 * life (typing dots, a caret, read ticks), and the empty state.
 *
 * Colours are each product's own, written literally rather than taken from the
 * host's tokens: an iMessage bubble is iOS blue in anyone's theme.
 */
import type { ReactNode } from 'react';
import { cn } from '../../../shared/cn.js';

/** A phone: bezel, status bar, screen, home indicator. Fills the space it is given. */
export function PhoneFrame({
  children,
  statusClass,
  indicatorClass,
}: {
  children: ReactNode;
  statusClass: string;
  indicatorClass: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 items-stretch justify-center px-4 pb-4 pt-3">
      <div
        className="flex min-h-0 w-full max-w-[380px] flex-col overflow-hidden rounded-[34px] border-[7px] border-[#111214] bg-white"
        style={{ boxShadow: '0 20px 44px -22px rgba(15,23,42,0.5), 0 2px 6px rgba(15,23,42,0.1)' }}
      >
        <div className={cn('flex shrink-0 items-center justify-between px-5 pb-0.5 pt-1.5 text-[10.5px] font-semibold', statusClass)}>
          <span className="tabular-nums">9:41</span>
          <span className="flex items-center gap-1" aria-hidden>
            <Bars />
            <Wifi />
            <Battery />
          </span>
        </div>
        {children}
        <div className="flex shrink-0 justify-center bg-inherit py-1.5">
          <span className={cn('h-[3px] w-24 rounded-full', indicatorClass)} aria-hidden />
        </div>
      </div>
    </div>
  );
}

const Bars = () => (
  <svg width="15" height="10" viewBox="0 0 15 10" fill="currentColor" aria-hidden>
    {[0, 1, 2, 3].map((i) => (
      <rect key={i} x={i * 4} y={7 - i * 2.2} width="2.6" height={3 + i * 2.2} rx="0.8" opacity={i === 3 ? 0.35 : 1} />
    ))}
  </svg>
);

const Wifi = () => (
  <svg width="13" height="10" viewBox="0 0 13 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden>
    <path d="M1 3.6a8 8 0 0 1 11 0M3.3 5.9a5 5 0 0 1 6.4 0" />
    <circle cx="6.5" cy="8.4" r="0.8" fill="currentColor" stroke="none" />
  </svg>
);

const Battery = () => (
  <svg width="22" height="10" viewBox="0 0 22 10" fill="none" aria-hidden>
    <rect x="0.6" y="0.6" width="17" height="8.8" rx="2.4" stroke="currentColor" strokeOpacity="0.45" />
    <rect x="2.1" y="2.1" width="12" height="5.8" rx="1.4" fill="currentColor" />
    <path d="M19.4 3.6v2.8a1.7 1.7 0 0 0 0-2.8Z" fill="currentColor" fillOpacity="0.5" />
  </svg>
);

/** Three dots: the other side is writing. */
export function Dots({ className }: { className: string }) {
  return (
    <span className="flex items-center gap-[3px] py-0.5" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn('h-[6px] w-[6px] rounded-full opacity-40', className)}
          style={{ animation: 'wui-bounce 1.2s ease-in-out infinite', animationDelay: `${String(i * 160)}ms` }}
        />
      ))}
    </span>
  );
}

/** A caret while an agent's answer is still arriving. */
export function Caret({ className }: { className: string }) {
  return <span className={cn('ml-0.5 inline-block h-[14px] w-[2px] animate-pulse align-middle', className)} aria-hidden />;
}

export function Empty({ className }: { className: string }) {
  return (
    <p className={cn('mx-auto mt-20 max-w-[220px] text-center text-[12.5px] leading-relaxed', className)}>
      Start a test conversation to talk to the flow the way they would.
    </p>
  );
}

const CLOCK = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/** One clock for the whole preview, so bubbles don't disagree by a minute. */
export function useClock(): string {
  return CLOCK.format(new Date());
}

/** Sent · delivered · read. */
export const Ticks = () => (
  <svg width="15" height="10" viewBox="0 0 16 11" fill="none" stroke="#53bdeb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M1 6.2 3.6 8.8 9 3.2" />
    <path d="M6.4 6.2 9 8.8 14.4 3.2" />
  </svg>
);
